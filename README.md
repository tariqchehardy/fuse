# FUSE — Sovereign Workstation Dispatch Console

**https://fusedispatch.github.io/**

A static GitHub Pages console for dispatching ephemeral Windows workstations,
provisioned by GitHub Actions (Tailscale + RDP), plus Codespace-based
ephemeral Tailscale exit nodes.

## Multi-tenant by design

Every signed-in GitHub account **hosts itself**:

- The console clones the bundled workstation template into a private
  `<login>/sovereign-workstation` repository in the user's own account
  (via the [FUSE Console GitHub App](https://github.com/apps/fuse-console)).
- The user's Tailscale auth key is stored as their own `TS_AUTHKEY` repo
  secret (Actions + Codespaces), sealed client-side-to-helper with libsodium
  sealed boxes — the raw key never leaves the GitHub secret store.
- Dispatch, status, Codespaces, and cleanup run entirely against that repo
  through the browser with the user's own token — minutes and storage bill
  to the user's account.

There is no server-side tenant state: the only server-side piece is the
[oauth-helper](oauth-helper/) (Deno Deploy) doing the OAuth code exchange,
token refresh, and sealed-box sealing. Access control is the GitHub
permission model itself.

## Repo layout

- `index.html`, `fuse.css`, `fuse.js` — the console
- `template/` — the workstation template cloned into each tenant repo
  (`github/workflows/…` → `.github/workflows/…`, `devcontainer.*` → `.devcontainer/…`)
- `oauth-helper/` — the Deno Deploy helper (see its README)
- `config.json` — points at the live helper URL (edit after redeploying it)

## Workflow

The provisioning workflow (v4.4.0) runs on `windows-latest`, joins the
user's tailnet with their auth key, enables RDP, uploads a
`connection-info` artifact (reliable live status — in-progress job logs
are not), warns before expiry, auto-shuts-down, and cleans up.
