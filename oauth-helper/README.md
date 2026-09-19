# FUSE oauth-helper (Deno Deploy)

The single server-side piece of FUSE. Stateless; only env vars it needs:

- `GITHUB_OAUTH_CLIENT_ID` — the FUSE Console GitHub App client ID (`Iv…`)
- `GITHUB_OAUTH_CLIENT_SECRET` — the app's client secret

## Endpoints (JSON, CORS pinned to the FUSE origin)

- `GET` → `{ configured, client_id, redirect_uri }`
- `POST { action: "exchange", code }` → `{ access_token, refresh_token, expires_in }`
- `POST { action: "refresh", refresh_token }` → same shape (rotation)
- `POST { action: "seal", public_key, secret }` → `{ encrypted_value }`
  (libsodium sealed box for GitHub Actions/Codespaces secrets)

Legacy `{code}` / `{grant_type:"refresh_token"}` bodies still work.

## Deploy (v2 API)

```bash
# create the app once
curl -X POST https://api.deno.com/v2/apps \
  -H "Authorization: Bearer $DDO_TOKEN" -H "Content-Type: application/json" \
  -d '{"slug": "fuse-oauth-helper"}'

# set env vars
curl -X PATCH https://api.deno.com/v2/apps/fuse-oauth-helper \
  -H "Authorization: Bearer $DDO_TOKEN" -H "Content-Type: application/json" \
  -d '{"env_vars": [{"key": "GITHUB_OAUTH_CLIENT_ID", "value": "Iv..."},
                    {"key": "GITHUB_OAUTH_CLIENT_SECRET", "value": "..."}]}'

# deploy deno-deploy.ts as main.ts
curl -X POST https://api.deno.com/v2/apps/fuse-oauth-helper/deploy \
  -H "Authorization: Bearer $DDO_TOKEN" -H "Content-Type: application/json" \
  -d '{"assets": {"main.ts": {"kind": "file", "encoding": "utf-8", "content": "<deno-deploy.ts>"}}}'
```

The app answers at `https://fuse-oauth-helper.tariqchehardy.deno.net/`.
After any redeploy, confirm `config.json` in the console repo points at the
live URL (it is the single source of truth for the console).
