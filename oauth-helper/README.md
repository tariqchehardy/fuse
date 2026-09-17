# OAuth / GitHub App exchange helper (Deno Deploy)

GitHub account sign-in on FUSE needs one tiny server-side piece: the OAuth
code → token exchange (GitHub's token endpoint sends no CORS headers, and
the client secret must not ship in browser code). This is it.

## Deploy (free, ~5 minutes)

1. Sign in at https://dash.deno.com (free account, "Sign in with GitHub").
2. **New Playground** → paste the contents of `deno-deploy.ts` → Save.
3. Project **Settings → Environment Variables**, add:
   - `GITHUB_OAUTH_CLIENT_ID` = your **GitHub App client ID** (starts with `Iv…`, public by design)
   - `GITHUB_OAUTH_CLIENT_SECRET` = the GitHub App's client secret  *(GitHub → Settings → Developer settings → GitHub Apps → your app)*
4. **Save & Deploy** — note the URL, e.g. `https://fuse-oauth.deno.dev`.
5. Tell the agent the URL (or open a PR changing `OAUTH_EXCHANGE_URL` in `fuse.js`).

## Verify

```bash
curl https://<your-project>.deno.dev
# {"configured":true,"client_id":"Ov23lirxWZffC9YVcJzD","redirect_uri":"https://tariqchehardy.github.io/fuse/"}
```

## Notes

- Sign-in uses a **GitHub App** (user-to-server flow). GitHub App user tokens
  expire after 8h; this helper rotates them via refresh tokens automatically
  when FUSE asks (FUSE retries any 401 once through the helper).
- The GitHub App must have **Callback URL** set to
  `https://tariqchehardy.github.io/fuse/` (Homepage URL: same).
- Repository permissions on the app: **Actions: Read & write**,
  **Contents: Read-only**, **Codespaces: Read & write**
  (Metadata: Read-only is mandatory). Install the app on the
  `sovereign-workstation` repo.
- The helper only accepts requests from the FUSE origin (CORS is pinned).
- The secret lives only in Deno Deploy env vars — never in this repo, never in the browser.
- Free tier: 1M requests/day — far beyond anything FUSE needs.
