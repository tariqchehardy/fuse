# FUSE

**F**USE is the dispatch console for [sovereign workstations](https://github.com/tariqchehardy/sovereign-workstation): a single static page hosted on GitHub Pages that talks straight to the GitHub REST API from your browser.

**Console:** https://tariqchehardy.github.io/fuse/

## What it does

- **Login / logout** with a GitHub personal access token (stored only in your browser's localStorage, sent only to `api.github.com`).
- **Ignite a sovereign workstation** — dispatches the provisioning workflow with your chosen session duration, RDP credentials, and auto-shutdown. The Tailscale key is built in (`TS_AUTHKEY` repo secret); no pasting.
- **Create a codespace exit node** — one button. Codespaces join the tailnet automatically as dedicated **ephemeral exit nodes**.
- **Live status** — workstation runs and codespaces auto-refresh every 15 s; pull the connection info (Tailscale IP/hostname, RDP details) out of the run log.

## Token scopes

- **Classic PAT:** `repo` + `workflow`
- **Fine-grained PAT:** on the `sovereign-workstation` repository — `Actions: Read & write`, `Codespaces: Read & write`, `Contents: Read-only`

## Notes

- FUSE is a static page — there is no server, no tracking, and no backend. Your token never leaves the browser.
- It's public because GitHub Pages on the free plan requires public repos; flip the repo to private if your plan supports private Pages.
