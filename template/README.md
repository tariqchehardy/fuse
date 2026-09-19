# sovereign-workstation

Ephemeral Windows workstation, provisioned through GitHub Actions.

This repository was created automatically by [FUSE](https://fusedispatch.github.io/) —
the dispatch console. It contains:

- `.github/workflows/provision-sovereign-workstation.yml` — the provisioning
  workflow (Tailscale + RDP, auto-shutdown, v4.4.0)
- `.devcontainer/` — Codespace exit-node definition (Tailscale ephemeral
  exit node on `up --advertise-exit-node`)

## Dispatch from the console

Open **https://fusedispatch.github.io/**, sign in with GitHub, and dispatch.
The console talks directly to the GitHub API — your token never leaves your
browser, and everything runs in *this* repository under *your* account.

## Secrets

- `TS_AUTHKEY` — reusable, ephemeral Tailscale auth key
  ([admin console → Settings → Keys](https://login.tailscale.com/admin/settings/keys)).
  Set it once from the FUSE console or manually under
  **Settings → Secrets and variables → Actions** (and Codespaces secrets).

## Run it manually

Actions → **Provision sovereign workstation** → **Run workflow**.
