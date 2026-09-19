# FUSE access helper (Deno Deploy)

FUSE needs one tiny server-side piece: the OAuth code → token exchange
(GitHub's token endpoint sends no CORS headers, and the client secret must
not ship in browser code). The same helper now also powers multi-account
access: any GitHub user can sign in and request access, the owner approves
from the FUSE "Access Requests" card, and approved accounts use the console
through a **whitelisted installation-token proxy** — they never need access
to the private `sovereign-workstation` repo.

Requests and approvals are stored in **Deno KV** (free, zero config).

## Deploy (free, ~5 minutes)

1. Sign in at https://dash.deno.com (free account, "Sign in with GitHub").
2. **New Playground** → paste the contents of `deno-deploy.ts` → Save.
3. Project **Settings → Environment Variables**, add:
   - `GITHUB_OAUTH_CLIENT_ID` = your **GitHub App client ID** (starts with `Iv…`, public by design)
   - `GITHUB_OAUTH_CLIENT_SECRET` = the GitHub App's client secret
   - `GITHUB_APP_ID` = the GitHub App's numeric ID *(enables the proxy for approved users)*
   - `GITHUB_APP_PRIVATE_KEY` = the full `.pem` private key from the app's settings page *(paste all of it, header lines included)*
   - `GITHUB_INSTALLATION_ID` = optional — auto-discovered from the installation on the repo owner account if unset
   - `FUSE_OWNER_LOGIN` = optional, default `tariqchehardy`
   - `FUSE_REPO` = optional, default `tariqchehardy/sovereign-workstation`
4. **Save & Deploy** — note the URL, e.g. `https://fuse-oauth.deno.dev`.
5. Put that URL into the fuse repo's **`config.json`**:
   ```json
   { "exchange_url": "https://fuse-oauth.deno.dev" }
   ```
   That's it — FUSE picks it up on the next page load, no code change needed.

## Verify

```bash
curl https://<your-project>.deno.dev
# {"configured":true,"client_id":"Iv…","redirect_uri":"https://fusedispatch.github.io/","proxy_ready":true,"owner_login":"tariqchehardy"}
```

`proxy_ready: true` means the multi-user proxy is armed.

## The GitHub App (one-time setup)

- **Callback URL** and **Homepage URL**: `https://fusedispatch.github.io/`
- Repository permissions: **Actions: Read & write**, **Contents: Read-only**,
  **Codespaces: Read & write** (Metadata: Read-only is mandatory).
- Install the app on the `sovereign-workstation` repo.

## How access works

- **Owner** (`FUSE_OWNER_LOGIN`): full console directly, plus the Access
  Requests card.
- **Any other GitHub user**: signs in with the same "Continue with GitHub"
  flow, sees the request-access prompt, and after approval gets dispatch +
  workstations + exit nodes — all relayed through the helper's installation
  token. Only whitelisted API paths on the FUSE repo are allowed (workflow
  dispatch, runs/jobs/logs, artifacts, codespaces). Billing stays owner-only.
- User-to-server tokens expire after 8h; the helper rotates them via refresh
  tokens (FUSE retries any 401 once through the helper).
- The client secret and app private key live only in Deno Deploy env vars —
  never in this repo, never in the browser.
- CORS is pinned to the FUSE origin; request lists and approvals are
  owner-only (verified against GitHub's `/user` on every call).
- Free tier: 1M requests/day — far beyond anything FUSE needs.
