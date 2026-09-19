/**
 * FUSE access helper — deploy this on Deno Deploy (free).
 *
 * It is the one server-side piece a static GitHub Pages site cannot do:
 *  - OAuth code -> token exchange + refresh rotation for the GitHub App
 *    user-to-server flow (client secret never leaves this function)
 *  - account access system: any GitHub user can sign in and request access;
 *    the owner (tariqchehardy) approves/denies from the FUSE Access Requests
 *    card. Approved accounts get the full console WITHOUT having any access
 *    to the private sovereign-workstation repo.
 *  - a whitelisted API proxy: approved users' console actions are executed
 *    with the GitHub App installation token (server-to-server), so they can
 *    dispatch workstations, see VM status, and create codespace exit nodes
 *    without ever touching the repo directly.
 *
 * Deploy (see oauth-helper/README.md):
 *   1. https://dash.deno.com -> New Playground -> paste this file
 *   2. Project Settings -> Environment Variables:
 *        GITHUB_OAUTH_CLIENT_ID      = GitHub App client ID (Iv…)
 *        GITHUB_OAUTH_CLIENT_SECRET  = GitHub App client secret
 *        GITHUB_APP_ID               = GitHub App numeric ID      (enables the proxy)
 *        GITHUB_APP_PRIVATE_KEY       = the full PEM private key  (enables the proxy)
 *        GITHUB_INSTALLATION_ID      = optional, auto-discovered if unset
 *        FUSE_OWNER_LOGIN            = default: tariqchehardy
 *        FUSE_REPO                   = default: tariqchehardy/sovereign-workstation
 *   3. Save & Deploy, then put the URL in the fuse repo's config.json
 *
 * Endpoints (all JSON, CORS pinned to the FUSE origin):
 *   GET                                          -> { configured, client_id, redirect_uri, proxy_ready, owner_login }
 *   POST { action:"exchange", code }             -> { access_token, refresh_token?, expires_in? }
 *   POST { action:"refresh", refresh_token }     -> { access_token, refresh_token, expires_in }
 *   POST { action:"me", token }                  -> { login, id, avatar_url, role: owner|approved|pending|none }
 *   POST { action:"request_access", token, note?}-> { ok, role }
 *   POST { action:"list_requests", token }       -> owner only -> { requests:[{login,id,avatar_url,name,note,requested_at}] }
 *   POST { action:"decide", token, login, decision:"approve"|"deny" }  -> owner only -> { ok }
 *   POST { action:"proxy", token, method, path, body }  -> approved/owner only -> { status, body }
 *
 * Legacy POST shapes from the old client ({code,...} / {grant_type:"refresh_token",...})
 * still work unchanged.
 */

const FUSE_ORIGIN = "https://fusedispatch.github.io";
const REDIRECT_URI = "https://fusedispatch.github.io/";
const GH = "https://api.github.com";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const UA = "fuse-helper";

const env = (k) => (Deno.env.get(k) || "").trim();
const clientId = env("GITHUB_OAUTH_CLIENT_ID");
const clientSecret = env("GITHUB_OAUTH_CLIENT_SECRET");
const appId = env("GITHUB_APP_ID");
const appPrivateKey = env("GITHUB_APP_PRIVATE_KEY");
const installationIdCfg = env("GITHUB_INSTALLATION_ID");
const OWNER_LOGIN = env("FUSE_OWNER_LOGIN") || "tariqchehardy";
const FUSE_REPO = env("FUSE_REPO") || "tariqchehardy/sovereign-workstation";

const proxyReady = Boolean(clientId && clientSecret && appId && appPrivateKey);
const REPO_OWNER = FUSE_REPO.split("/")[0];

const cors = {
  "Access-Control-Allow-Origin": FUSE_ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
  "Content-Type": "application/json",
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: cors });

/* ---------- storage (Deno KV — free, zero config on Deno Deploy) ---------- */
let kv = null;
async function KV() {
  if (!kv) kv = await Deno.openKv();
  return kv;
}

/* ---------- GitHub App JWT + installation token ---------- */
function b64url(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
/* PKCS#1 ("BEGIN RSA PRIVATE KEY", what GitHub lets you download) -> PKCS#8,
   so crypto.subtle.importKey can read it. */
function derLen(n) {
  if (n < 128) return [n];
  const hex = n.toString(16);
  const bytes = (hex.length % 2 ? "0" + hex : hex).match(/../g).map((x) => parseInt(x, 16));
  return [0x80 | bytes.length, ...bytes];
}
function pkcs1ToPkcs8(der) {
  const alg = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const octet = [0x04, ...derLen(der.length), ...der];
  const body = [0x02, 0x01, 0x00, ...alg, ...octet];
  return new Uint8Array([0x30, ...derLen(body.length), ...body]);
}
let cachedKey = null;
async function appPrivateKeyObj() {
  if (cachedKey) return cachedKey;
  const isPkcs1 = /BEGIN RSA PRIVATE KEY/.test(appPrivateKey);
  const b64 = appPrivateKey.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const der = isPkcs1 ? pkcs1ToPkcs8(bin) : bin;
  cachedKey = await crypto.subtle.importKey(
    "pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  return cachedKey;
}
async function appJwt() {
  const key = await appPrivateKeyObj();
  const now = Math.floor(Date.now() / 1000);
  const h = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const p = b64url(new TextEncoder().encode(JSON.stringify({ iat: now, exp: now + 540, iss: appId })));
  const sig = b64url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${h}.${p}`)));
  return `${h}.${p}.${sig}`;
}
let instTok = { token: "", exp: 0 };
let instIdCache = 0;
async function installationId() {
  if (installationIdCfg) return installationIdCfg;
  if (instIdCache) return instIdCache;
  const r = await fetch(`${GH}/app/installations?per_page=100`, {
    headers: { Authorization: `Bearer ${await appJwt()}`, Accept: "application/vnd.github+json", "User-Agent": UA },
  });
  if (!r.ok) throw new Error(`cannot list app installations (HTTP ${r.status})`);
  const list = await r.json();
  const hit = (list || []).find((i) => i.account && i.account.login === REPO_OWNER);
  if (!hit) throw new Error(`the GitHub App is not installed on the ${REPO_OWNER} account`);
  instIdCache = hit.id;
  return hit.id;
}
async function installationToken() {
  if (instTok.token && Date.now() < instTok.exp - 120000) return instTok.token;
  const r = await fetch(`${GH}/app/installations/${await installationId()}/access_tokens`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await appJwt()}`, Accept: "application/vnd.github+json", "User-Agent": UA },
  });
  if (!r.ok) throw new Error(`installation token failed (HTTP ${r.status})`);
  const d = await r.json();
  instTok = { token: d.token, exp: Date.parse(d.expires_at) };
  return d.token;
}

/* ---------- user verification + roles ---------- */
async function verifyUser(token) {
  const t = String(token || "").trim();
  if (!t) return null;
  const r = await fetch(`${GH}/user`, {
    headers: { Authorization: `Bearer ${t}`, Accept: "application/vnd.github+json", "User-Agent": UA },
  });
  if (!r.ok) return null;
  const u = await r.json();
  return { login: u.login, id: u.id, avatar_url: u.avatar_url, name: u.name || "" };
}
async function roleOf(login) {
  if (login === OWNER_LOGIN) return "owner";
  const k = await KV();
  const a = await k.get(["approved", login]);
  if (a.value) return "approved";
  const p = await k.get(["requests", login]);
  if (p.value) return "pending";
  return "none";
}

/* ---------- access actions ---------- */
async function meAction(body) {
  const u = await verifyUser(body.token);
  if (!u) return json({ error: "bad_token", message: "Sign-in token rejected by GitHub." }, 401);
  return json({ login: u.login, id: u.id, avatar_url: u.avatar_url, role: await roleOf(u.login) });
}
async function requestAccess(body) {
  const u = await verifyUser(body.token);
  if (!u) return json({ error: "bad_token", message: "Sign-in token rejected by GitHub." }, 401);
  const role = await roleOf(u.login);
  if (role === "owner") return json({ ok: true, role: "owner" });
  if (role === "approved") return json({ ok: true, role: "approved" });
  const k = await KV();
  if (role === "pending") return json({ ok: true, role: "pending" });
  await k.set(["requests", u.login], {
    id: u.id, avatar_url: u.avatar_url, name: u.name,
    note: String(body.note || "").slice(0, 280),
    requested_at: new Date().toISOString(),
  });
  return json({ ok: true, role: "pending" });
}
async function listRequests(body) {
  const u = await verifyUser(body.token);
  if (!u) return json({ error: "bad_token" }, 401);
  if (u.login !== OWNER_LOGIN) return json({ error: "owner_only" }, 403);
  const k = await KV();
  const out = [];
  for await (const e of k.list({ prefix: ["requests"] })) {
    out.push({ login: e.key[1], ...e.value });
  }
  out.sort((a, b) => String(a.requested_at).localeCompare(String(b.requested_at)));
  return json({ requests: out });
}
async function decide(body) {
  const u = await verifyUser(body.token);
  if (!u) return json({ error: "bad_token" }, 401);
  if (u.login !== OWNER_LOGIN) return json({ error: "owner_only" }, 403);
  const login = String(body.login || "").trim();
  if (!login) return json({ error: "missing_login" }, 400);
  const decision = body.decision === "approve" ? "approve" : "deny";
  const k = await KV();
  const req = await k.get(["requests", login]);
  if (!req.value) return json({ error: "no_request", message: "No pending request for that account." }, 404);
  if (decision === "approve") {
    await k.set(["approved", login], {
      id: req.value.id, avatar_url: req.value.avatar_url, approved_at: new Date().toISOString(),
    });
  }
  await k.delete(["requests", login]);
  return json({ ok: true, decision, login });
}

/* ---------- whitelisted repo proxy (approved users only) ---------- */
const PROXY_RULES = [
  ["POST", new RegExp(`^/repos/${FUSE_REPO.replace(/\//g, "\\/")}/actions/workflows/[^/]+/dispatches$`)],
  ["GET", new RegExp(`^/repos/${FUSE_REPO.replace(/\//g, "\\/")}/actions/workflows/[^/]+/runs`)],
  ["GET", new RegExp(`^/repos/${FUSE_REPO.replace(/\//g, "\\/")}/actions/runs/\\d+/jobs$`)],
  ["GET", new RegExp(`^/repos/${FUSE_REPO.replace(/\//g, "\\/")}/actions/jobs/\\d+/logs$`)],
  ["GET", new RegExp(`^/repos/${FUSE_REPO.replace(/\//g, "\\/")}/actions/artifacts$`)],
  ["GET", new RegExp(`^/repos/${FUSE_REPO.replace(/\//g, "\\/")}/actions/artifacts/\\d+/zip$`)],
  ["GET", new RegExp(`^/repos/${FUSE_REPO.replace(/\//g, "\\/")}/codespaces$`)],
  ["POST", new RegExp(`^/repos/${FUSE_REPO.replace(/\//g, "\\/")}/codespaces$`)],
  ["DELETE", new RegExp(`^/repos/${FUSE_REPO.replace(/\//g, "\\/")}/codespaces/[^/]+$`)],
];
function b64FromBytes(bytes) {
  let s = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s);
}
async function doProxy(body) {
  const u = await verifyUser(body.token);
  if (!u) return json({ error: "bad_token" }, 401);
  const role = await roleOf(u.login);
  if (role !== "owner" && role !== "approved") {
    return json({ error: "not_approved", message: "This account is not approved to use FUSE." }, 403);
  }
  if (!proxyReady) {
    return json({ error: "proxy_not_configured", message: "The proxy is not configured on the helper (needs GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY)." }, 503);
  }
  const method = String(body.method || "GET").toUpperCase();
  const [p, q] = String(body.path || "").split("?");
  if (!PROXY_RULES.some(([m, re]) => m === method && re.test(p))) {
    return json({ error: "forbidden_path", message: "That API path is not allowed through the proxy." }, 403);
  }
  const res = await fetch(`${GH}${p}${q ? "?" + q : ""}`, {
    method,
    headers: {
      Authorization: `Bearer ${await installationToken()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": UA,
      ...(body.body ? { "Content-Type": "application/json" } : {}),
    },
    body: body.body ? JSON.stringify(body.body) : undefined,
  });
  if (/\/zip$/.test(p)) {
    const buf = new Uint8Array(await res.arrayBuffer());
    return json({ status: res.status, body_b64: b64FromBytes(buf) });
  }
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* not JSON */ }
  return json({ status: res.status, body: parsed !== null ? parsed : text });
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
      proxy_ready: proxyReady,
      owner_login: OWNER_LOGIN,
    }), { headers: cors });
  }

  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  if (!clientId || !clientSecret) {
    return json({ error: "not_configured", message: "Set GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET env vars." }, 503);
  }

  let body = {};
  try { body = await req.json(); } catch { /* validated below */ }

  // new-style explicit action, with legacy fallbacks for the old client
  const action = body.action ||
    (body.grant_type === "refresh_token" ? "refresh" : body.code ? "exchange" : "");

  try {
    switch (action) {
      case "exchange": return await exchange(body);
      case "refresh": return await refresh(body);
      case "me": return await meAction(body);
      case "request_access": return await requestAccess(body);
      case "list_requests": return await listRequests(body);
      case "decide": return await decide(body);
      case "proxy": return await doProxy(body);
      default: return json({ error: "unknown_action" }, 400);
    }
  } catch (e) {
    return json({ error: "helper_error", message: String(e && e.message ? e.message : e) }, 500);
  }
});
