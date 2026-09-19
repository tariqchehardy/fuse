/**
 * FUSE helper v2 — the one server-side piece a static GitHub Pages site
 * cannot do:
 *   - OAuth code -> token exchange + refresh rotation for the GitHub App
 *     user-to-server flow (client secret never leaves this function)
 *   - libsodium sealed-box sealing of GitHub repo secrets (Tailscale auth
 *     keys) so the browser console never needs a crypto library
 *
 * The console itself is multi-tenant: every signed-in user provisions
 * workstations in THEIR OWN repository, so this helper no longer proxies
 * anything or stores any state — it is stateless and secret-less beyond the
 * OAuth client secret.
 *
 * Deploy on Deno Deploy (see oauth-helper/README.md):
 *   Project env vars:
 *     GITHUB_OAUTH_CLIENT_ID      = GitHub App client ID (Iv…)
 *     GITHUB_OAUTH_CLIENT_SECRET  = GitHub App client secret
 *
 * Endpoints (all JSON, CORS pinned to the FUSE origin):
 *   GET                                        -> { configured, client_id, redirect_uri }
 *   POST { action:"exchange", code }           -> { access_token, refresh_token?, expires_in? }
 *   POST { action:"refresh", refresh_token }    -> { access_token, refresh_token, expires_in }
 *   POST { action:"seal", public_key, secret } -> { encrypted_value }
 *
 * Legacy POST shapes ({code,...} / {grant_type:"refresh_token",...}) still work.
 */

import _sodium from "npm:libsodium-wrappers@0.7.15";

const FUSE_ORIGIN = "https://fusedispatch.github.io";
const REDIRECT_URI = "https://fusedispatch.github.io/";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const UA = "fuse-helper";

const env = (k) => (Deno.env.get(k) || "").trim();
const clientId = env("GITHUB_OAUTH_CLIENT_ID");
const clientSecret = env("GITHUB_OAUTH_CLIENT_SECRET");

const cors = {
  "Access-Control-Allow-Origin": FUSE_ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
  "Content-Type": "application/json",
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: cors });

/* ---------- libsodium sealed box (GitHub Actions/Codespaces secret format) ---------- */
let sodium = null;
async function Na() {
  if (!sodium) { await _sodium.ready; sodium = _sodium; }
  return sodium;
}
async function sealAction(body) {
  const pkB64 = String(body.public_key || "").trim();
  const secret = String(body.secret || "");
  if (!pkB64 || !secret) return json({ error: "missing_args", message: "public_key and secret are required." }, 400);
  const s = await Na();
  let sealed;
  try {
    const pk = s.from_base64(pkB64, s.base64_variants.ORIGINAL);
    sealed = s.crypto_box_seal(secret, pk);
  } catch (e) {
    return json({ error: "bad_public_key", message: "Could not seal with that public key: " + (e && e.message) }, 400);
  }
  return json({ encrypted_value: s.to_base64(sealed, s.base64_variants.ORIGINAL) });
}

/* ---------- OAuth exchange / refresh (unchanged behavior) ---------- */
async function exchange(body) {
  const payload = {
    client_id: clientId, client_secret: clientSecret,
    code: String(body.code || "").trim(),
    redirect_uri: body.redirect_uri || REDIRECT_URI,
  };
  if (!payload.code) return json({ error: "missing_code" }, 400);
  const ghRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await ghRes.json().catch(() => ({}));
  if (!data.access_token) {
    return json({
      error: data.error || "exchange_failed",
      message: data.error_description || "GitHub rejected the request (bad/expired code).",
    }, 400);
  }
  return json({
    access_token: data.access_token, refresh_token: data.refresh_token || null,
    expires_in: data.expires_in || null, scope: data.scope,
  });
}
async function refresh(body) {
  const payload = {
    client_id: clientId, client_secret: clientSecret,
    grant_type: "refresh_token", refresh_token: String(body.refresh_token || "").trim(),
  };
  if (!payload.refresh_token) return json({ error: "missing_refresh_token" }, 400);
  const ghRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await ghRes.json().catch(() => ({}));
  if (!data.access_token) {
    return json({
      error: data.error || "refresh_failed",
      message: data.error_description || "GitHub rejected the refresh token (expired or rotated).",
    }, 400);
  }
  return json({
    access_token: data.access_token, refresh_token: data.refresh_token || null,
    expires_in: data.expires_in || null, scope: data.scope,
  });
}

/* ---------- router ---------- */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  if (req.method === "GET") {
    return new Response(JSON.stringify({
      configured: Boolean(clientId && clientSecret),
      client_id: clientId || null,
      redirect_uri: REDIRECT_URI,
    }), { headers: cors });
  }

  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  let body = {};
  try { body = await req.json(); } catch { /* validated below */ }

  const action = body.action ||
    (body.grant_type === "refresh_token" ? "refresh" : body.code ? "exchange" : "");

  if (action === "seal") return sealAction(body); // works even if OAuth is not configured

  if (!clientId || !clientSecret) {
    return json({ error: "not_configured", message: "Set GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET env vars." }, 503);
  }

  try {
    switch (action) {
      case "exchange": return await exchange(body);
      case "refresh": return await refresh(body);
      default: return json({ error: "unknown_action" }, 400);
    }
  } catch (e) {
    return json({ error: "helper_error", message: String(e && e.message ? e.message : e) }, 500);
  }
});
