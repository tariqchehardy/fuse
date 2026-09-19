# FUSE

**F**USE is the dispatch console for [sovereign workstations](https://github.com/tariqchehardy/sovereign-workstation): a single static page hosted on GitHub Pages that talks straight to the GitHub REST API from your browser.

**Console:** https://fusedispatch.github.io/

## What it does

- **GitHub-only mode (default, zero hosting)** — sign-in is by GitHub token. Access requests are issues on this public repo (`Access request: <login>`); approvals are commits to `approved.json`, both done from the console. No backend exists anywhere: GitHub Pages serves the page, api.github.com is the only API FUSE talks to. GitHub's own OAuth endpoints send no CORS headers (verified), so a static site cannot do password-style account sign-in without a relay — that's what the optional helper below is for.
- **Multi-account access with approvals** — any GitHub user can sign in. Non-owner accounts land on a "request access" prompt; the owner approves or denies them from the **Access Requests** card. Approved accounts get the full console (dispatch, workstations, exit nodes) via the helper's whitelisted installation-token proxy — **no access to the private repo required or granted**. Billing stays owner-only.
- **Optional token sign-in** — a personal access token remains available as an advanced fallback (stored only in your browser's localStorage, sent only to `api.github.com`).
- **Ignite a sovereign workstation** — dispatches the provisioning workflow with your chosen session duration, RDP credentials, and auto-shutdown. The Tailscale key is built in (`TS_AUTHKEY` repo secret); no pasting.
- **Create a codespace exit node** — one button. Codespaces join the tailnet automatically as dedicated **ephemeral exit nodes**.
- **Workstations dashboard** — the running VM gets a live status card: Tailscale IP / hostname / DNS, session duration, warning window, and an RDP access block with copy buttons and a generated `.rdp` file download. Connection info comes from the workflow's `connection-info` artifact (reliable while the VM is live; workflow v4.4.0+) with job-log parsing as fallback. Dead (ended) VMs are listed separately. Auto-refreshes every 15 s.
- **Live status** — codespaces auto-refresh every 15 s.
- **Billing & usage** — month-to-date Actions minutes, Codespaces core-hours and storage from the GitHub billing usage report, with limit progression bars (usage vs included quota and balance left), a daily usage graph, month navigation, and editable limits (auto-set from your plan; stored in localStorage).

## Token scopes

- **Classic PAT:** `repo` + `workflow` (+ `user` if you want the billing section)
- **Fine-grained PAT:** on the `sovereign-workstation` repository — `Actions: Read & write`, `Contents: Read-only`; plus the account permissions `Codespaces: Read & write` and `Plans: Read` (for billing)

## Notes

- FUSE is a static page — there is no tracking. Owner tokens never leave the browser; approved users' actions run through the helper's server-side proxy with an installation token scoped to whitelisted paths on this repo only.
- Access helper setup (Deno Deploy, free, ~5 min): see `oauth-helper/README.md`, then set its URL in `config.json`.
- It's public because GitHub Pages on the free plan requires public repos; flip the repo to private if your plan supports private Pages.
