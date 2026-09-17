# FUSE

**F**USE is the dispatch console for [sovereign workstations](https://github.com/tariqchehardy/sovereign-workstation): a single static page hosted on GitHub Pages that talks straight to the GitHub REST API from your browser.

**Console:** https://tariqchehardy.github.io/fuse/

## What it does

- **GitHub account sign-in** — "Continue with GitHub" runs the OAuth web flow (login happens on github.com itself with your email + password; FUSE never sees it). One tiny serverless helper holds the OAuth client secret for the code exchange.
- **Optional token sign-in** — a personal access token remains available as an advanced fallback (stored only in your browser's localStorage, sent only to `api.github.com`).
- **Ignite a sovereign workstation** — dispatches the provisioning workflow with your chosen session duration, RDP credentials, and auto-shutdown. The Tailscale key is built in (`TS_AUTHKEY` repo secret); no pasting.
- **Create a codespace exit node** — one button. Codespaces join the tailnet automatically as dedicated **ephemeral exit nodes**.
- **Workstations dashboard** — the running VM gets a live status card: Tailscale IP / hostname / DNS, session duration, scheduled shutdown, and an RDP access block with copy buttons and a generated `.rdp` file download. Dead (ended) VMs are listed separately. Auto-refreshes every 15 s.
- **Live status** — codespaces auto-refresh every 15 s.
- **Billing & usage** — month-to-date Actions minutes, Codespaces core-hours and storage from the GitHub billing usage report, with limit progression bars (usage vs included quota and balance left), a daily usage graph, month navigation, and editable limits (auto-set from your plan; stored in localStorage).

## Token scopes

- **Classic PAT:** `repo` + `workflow` (+ `user` if you want the billing section)
- **Fine-grained PAT:** on the `sovereign-workstation` repository — `Actions: Read & write`, `Contents: Read-only`; plus the account permissions `Codespaces: Read & write` and `Plans: Read` (for billing)

## Notes

- FUSE is a static page — there is no server, no tracking, and no backend. Your token never leaves the browser.
- It's public because GitHub Pages on the free plan requires public repos; flip the repo to private if your plan supports private Pages.
