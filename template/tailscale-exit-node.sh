#!/usr/bin/env bash
# ---------------------------------------------------------------------------
#  Sovereign Workstation -- Tailscale exit-node bring-up (Codespaces)
#
#  Runs as postStartCommand on every codespace start. Each codespace is a
#  DEDICATED EPHEMERAL EXIT NODE for the deployed sovereign workstations:
#    1. waits for tailscaled (started by the ghcr.io/tailscale/codespace
#       feature entrypoint) to expose its socket;
#    2. waits for the node to authenticate (the entrypoint runs
#       'tailscale up' using the TS_AUTH_KEY Codespaces secret);
#    3. if authenticated, applies 'tailscale set --advertise-exit-node';
#    4. if not authenticated, retries a direct bring-up with the auth key:
#       ephemeral + exit node first, falling back to exit node only if the
#       key is not flagged ephemeral;
#    5. otherwise prints interactive (browser) auth instructions.
#
#  This script never blocks or fails the codespace start.
# ---------------------------------------------------------------------------
set -uo pipefail

log() { echo "[tailscale-exit-node] $*"; }

command -v tailscale >/dev/null 2>&1 || {
  log "tailscale CLI not found -- is the Tailscale devcontainer feature installed?"
  exit 0
}

# 1. Wait for tailscaled to expose its socket (started by the feature entrypoint).
for _ in $(seq 1 30); do
  [ -S /var/run/tailscale/tailscaled.sock ] && break
  sleep 1
done
if [ ! -S /var/run/tailscale/tailscaled.sock ]; then
  log "tailscaled socket never appeared. Ensure devcontainer.json runArgs includes --device=/dev/net/tun."
  exit 0
fi

# 2. Wait for authentication (the feature entrypoint authenticates with TS_AUTH_KEY).
log "waiting for the node to authenticate (up to 60s)..."
authenticated=0
for _ in $(seq 1 60); do
  if tailscale ip -4 >/dev/null 2>&1; then authenticated=1; break; fi
  sleep 1
done

if [ "$authenticated" = 1 ]; then
  # 3. Advertise as an exit node (idempotent; safe on every start/restart).
  if tailscale set --advertise-exit-node 2>&1; then
    log "this codespace is advertising as a dedicated Tailscale exit node."
  else
    log "tailscale set --advertise-exit-node failed -- check 'tailscale status'."
  fi
else
  # 4. Not authenticated. Retry a direct bring-up if an auth key is available.
  if [ -n "${TS_AUTH_KEY:-}" ]; then
    host_arg=""
    [ -n "${CODESPACE_NAME:-}" ] && host_arg="--hostname=${CODESPACE_NAME}"
    log "not authenticated yet -- bringing the node up with the TS_AUTH_KEY secret..."
    if tailscale up --accept-routes --advertise-exit-node --ephemeral --authkey="$TS_AUTH_KEY" $host_arg 2>&1; then
      log "this codespace is up as an EPHEMERAL dedicated exit node."
    else
      log "--ephemeral rejected (key may not be flagged ephemeral) -- retrying without it..."
      if tailscale up --accept-routes --advertise-exit-node --authkey="$TS_AUTH_KEY" $host_arg 2>&1; then
        log "this codespace is up as a dedicated exit node (non-ephemeral; flag the key ephemeral in the Tailscale admin console for auto-cleanup)."
      else
        log "tailscale up failed (key may be single-use, expired, or already consumed)."
        log "authenticate interactively with:  tailscale set --accept-routes --advertise-exit-node"
      fi
    fi
  else
    log "not authenticated and no TS_AUTH_KEY secret is set."
    log "add a reusable + ephemeral Tailscale auth key as the Codespaces secret 'TS_AUTHKEY'"
    log "(repo Settings > Codespaces > Secrets), or authenticate interactively with:"
    log "  tailscale set --accept-routes --advertise-exit-node"
  fi
fi

# 5. Show final state.
echo ""
log "tailscale status:"
tailscale status || true
log "NOTE: if the exit node does not appear in your client's exit-node list,"
log "enable it once in the Tailscale admin console (Machines > ... > Edit route settings)"
log "or add an autoApprovers.exitNode policy."
