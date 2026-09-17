/**
 * FUSE OAuth exchange helper — deploy this on Deno Deploy (free).
 * It is the one server-side piece a static GitHub Pages site cannot do:
 * exchanging the GitHub OAuth authorization code for an access token.
 * The client secret never leaves this function.
 *
 * Deploy (see oauth-helper/README.md):
 *   1. https://dash.deno.com  ->  New Playground
 *   2. paste this file
 *   3. Project Settings -> Environment Variables:
 *        GITHUB_OAUTH_CLIENT_ID     = Ov23lirxWZffC9YVcJzD   (public by design)
 *        GITHUB_OAUTH_CLIENT_SECRET = <your app's client secret>
 *   4. Save & Deploy
 */
const FUSE_ORIGIN = "https://tariqchehardy.github.io";
const REDIRECT_URI = "https://tariqchehardy.github.io/fuse/";

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": FUSE_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Content-Type": "application/json",
  };

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  const clientId = Deno.env.get("GITHUB_OAUTH_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("GITHUB_OAUTH_CLIENT_SECRET") || "";

  // Public config check — client_id is public by design.
  if (req.method === "GET") {
    return new Response(
      JSON.stringify({
        configured: Boolean(clientId && clientSecret),
        client_id: clientId || null,
        redirect_uri: REDIRECT_URI,
      }),
      { headers: cors },
    );
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: cors });
  }

  if (!clientId || !clientSecret) {
    return new Response(
      JSON.stringify({ error: "not_configured", message: "Set GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET env vars." }),
      { status: 503, headers: cors },
    );
  }

  let body = {};
  try { body = await req.json(); } catch { /* validated below */ }

  const code = (body.code || "").trim();
  if (!code) return new Response(JSON.stringify({ error: "missing_code" }), { status: 400, headers: cors });

  const ghRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: body.redirect_uri || REDIRECT_URI,
    }),
  });

  const data = await ghRes.json().catch(() => ({}));
  if (!data.access_token) {
    return new Response(
      JSON.stringify({
        error: data.error || "exchange_failed",
        message: data.error_description || "GitHub rejected the authorization code.",
      }),
      { status: 400, headers: cors },
    );
  }

  return new Response(JSON.stringify({ access_token: data.access_token, scope: data.scope }), { headers: cors });
});
