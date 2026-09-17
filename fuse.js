"use strict";
/* FUSE — dispatch console for sovereign workstations.
   Static page talking straight to the GitHub REST API from the browser.
   Sign-in: GitHub account (OAuth via a tiny exchange helper) or a personal
   access token (advanced, optional). Token lives only in localStorage. */

const OWNER = "tariqchehardy";
const REPO = "sovereign-workstation";
const WF = "provision-sovereign-workstation.yml";
const API = "https://api.github.com";
const KEY = "fuse_token";
const LS_LIMITS = "fuse_limits";
const OAUTH_EXCHANGE_URL = "https://untitled.base44.app/functions/githubOauthExchange";

const $ = (id) => document.getElementById(id);
let token = localStorage.getItem(KEY) || "";
let me = null;
let timer = null;
let billMonth = null;
let oauthCfg = null;
let logCache = {};        // runId -> { ts, info, raw }
let activeInfo = null;   // parsed info of the running VM

/* ================= API ================= */
async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.message || res.statusText);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

/* ================= UI helpers ================= */
function toast(msg, type = "ok") {
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.textContent = msg;
  $("toasts").appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 320); }, 4200);
}
const openModal = (id) => $(id).classList.remove("hidden");
const closeModal = (id) => $(id).classList.add("hidden");
function skeletons(n) { return Array.from({ length: n }, () => `<div class="skeleton"></div>`).join(""); }
function lockedHTML(what) {
  return `<div class="locked">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
      <rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
    <p>Sign in to ${what}.</p>
    <button class="btn primary sm" data-open-login>Sign in</button>
  </div>`;
}
function bindLoginButtons(root) {
  root.querySelectorAll("[data-open-login]").forEach((b) => b.addEventListener("click", () => openLogin()));
}
function copyText(text, label) {
  navigator.clipboard.writeText(text)
    .then(() => toast(`${label} copied to clipboard.`))
    .catch(() => toast("Clipboard blocked by the browser — copy manually.", "err"));
}

/* ================= auth ================= */
function openLogin() {
  $("login-error").classList.add("hidden");
  openModal("login-modal");
  fetchOauthConfig();
}
async function doLogin() {
  const t = $("login-input").value.trim();
  if (!t) return;
  $("login-submit").disabled = true;
  $("login-error").classList.add("hidden");
  try {
    const save = token;
    token = t;
    me = await api("/user");
    localStorage.setItem(KEY, t);
    closeModal("login-modal");
    finishSignIn();
    toast(`Signed in as ${me.login} — console unlocked.`);
  } catch (e) {
    token = save;
    $("login-error").textContent =
      `Token sign-in failed (${e.status || "network"}): ${e.message}` +
      (e.status === 401 ? " — token invalid or expired." :
       e.status === 403 ? " — token lacks access. Check the scopes." : "");
    $("login-error").classList.remove("hidden");
  } finally {
    $("login-submit").disabled = false;
  }
}
function logout() {
  localStorage.removeItem(KEY);
  token = ""; me = null; activeInfo = null; logCache = {};
  clearInterval(timer); timer = null;
  renderAuthArea();
  renderLocks();
  toast("Signed out. Credentials cleared from this browser.");
}
function finishSignIn() {
  renderAuthArea();
  renderLocks();
  $("ws-body").innerHTML = skeletons(4);
  $("cs-body").innerHTML = skeletons(2);
  $("billing-body").innerHTML = skeletons(3);
  refreshAll();
  startPolling();
}
function renderAuthArea() {
  const a = $("auth-area");
  if (me) {
    a.innerHTML = `
      <div class="status-pill" title="sovereign-workstation · private repo"><span class="dot ok"></span> connected · <b>${me.login}</b></div>
      <img class="avatar" src="${me.avatar_url}" alt="" title="${me.login}">
      <button id="logout-btn" class="btn ghost sm">Sign out</button>`;
    $("logout-btn").addEventListener("click", logout);
  } else {
    a.innerHTML = `
      <div class="status-pill"><span class="dot"></span> guest</div>
      <button id="open-login" class="btn primary sm">Sign in with GitHub</button>`;
    $("open-login").addEventListener("click", openLogin);
  }
}
function renderLocks() {
  const authed = !!me;
  $("guest-strip").hidden = authed;
  $("lock-dispatch").hidden = authed;
  $("bill-nav").hidden = !authed;
  $("cs-create-btn").hidden = !authed;
  const bodies = {
    "billing-body": "load billing and usage",
    "cs-body": "manage codespace exit nodes",
    "ws-body": "see running workstations, stats and RDP access",
  };
  for (const [id, what] of Object.entries(bodies)) {
    if (!authed) { $(id).innerHTML = lockedHTML(what); bindLoginButtons($(id)); }
  }
}
function startPolling() {
  clearInterval(timer);
  timer = setInterval(refreshAll, 15000);
}

/* ================= GitHub account (OAuth) ================= */
async function fetchOauthConfig() {
  try {
    const r = await fetch(OAUTH_EXCHANGE_URL, { headers: { Accept: "application/json" } });
    oauthCfg = r.ok ? await r.json() : null;
  } catch { oauthCfg = null; }
  renderOAuthState();
}
function renderOAuthState() {
  const ready = oauthCfg && oauthCfg.configured && oauthCfg.client_id;
  $("oauth-btn").disabled = !ready;
  $("oauth-note").classList.toggle("hidden", !!ready);
  if (ready) $("oauth-note").textContent = "";
}
function startOAuth() {
  if (!oauthCfg || !oauthCfg.configured) {
    toast("GitHub account sign-in is still being configured — use a token for now.", "err");
    return;
  }
  const state = crypto.randomUUID();
  sessionStorage.setItem("fuse_oauth_state", state);
  const p = new URLSearchParams({
    client_id: oauthCfg.client_id,
    redirect_uri: oauthCfg.redirect_uri || (location.origin + location.pathname),
    scope: "repo workflow user codespace",
    state,
  });
  location.href = `https://github.com/login/oauth/authorize?${p}`;
}
async function completeOAuth() {
  const q = new URLSearchParams(location.search);
  const code = q.get("code");
  if (!code) return false;
  const expected = sessionStorage.getItem("fuse_oauth_state");
  sessionStorage.removeItem("fuse_oauth_state");
  history.replaceState(null, "", location.pathname);
  if (expected && q.get("state") !== expected) {
    toast("Sign-in state mismatch — aborted for safety.", "err");
    return false;
  }
  toast("Completing GitHub sign-in…");
  try {
    const r = await fetch(OAUTH_EXCHANGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ code, redirect_uri: location.origin + location.pathname }),
    });
    const data = await r.json();
    if (!r.ok || !data.access_token) throw new Error(data.message || data.error || `HTTP ${r.status}`);
    token = data.access_token;
    localStorage.setItem(KEY, token);
    me = await api("/user");
    finishSignIn();
    toast(`Welcome back, ${me.login} — signed in with GitHub.`);
    return true;
  } catch (e) {
    token = "";
    toast(`GitHub sign-in failed: ${e.message}`, "err");
    return false;
  }
}

/* ================= dispatch ================= */
async function dispatch(e) {
  e.preventDefault();
  if (!me) { openLogin(); return; }
  const btn = $("dispatch-btn");
  btn.disabled = true; btn.classList.add("loading");
  const msg = $("dispatch-msg");
  msg.textContent = ""; msg.className = "";
  try {
    await api(`/repos/${OWNER}/${REPO}/actions/workflows/${WF}/dispatches`, {
      method: "POST",
      body: JSON.stringify({
        ref: "main",
        inputs: {
          tailscale_key: $("ts-key").value.trim(),
          duration_minutes: $("duration").value,
          warning_minutes: $("warning").value,
          rdp_username: $("rdp-user").value.trim(),
          rdp_password: $("rdp-pass").value,
          rdp_port: $("rdp-port").value.trim(),
          enable_auto_shutdown: $("auto-shutdown").checked,
        },
      }),
    });
    msg.textContent = "Dispatched — ignition.";
    msg.className = "ok";
    toast("Workstation dispatched — ignition. Watch Workstations below.");
    loadWorkstations();
  } catch (err) {
    msg.textContent = `Failed (${err.status}): ${err.message}`;
    msg.className = "err";
    toast(`Dispatch failed: ${err.message}`, "err");
  } finally {
    btn.disabled = false; btn.classList.remove("loading");
  }
}

/* ================= workstations (running + dead VMs) ================= */
const ago = (iso) => {
  const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
};
function parseConnInfo(log) {
  // The workflow echoes its own script source into the log, so the FIRST
  // regex hit can be a source line ($tsHost, $env:SESSION_ID...). The real
  // printed values always come later, so take the LAST match.
  const grab = (re) => {
    const ms = [...log.matchAll(re)];
    return ms.length ? ms[ms.length - 1][1].trim() : null;
  };
  const target = grab(/RDP Target\s*[:=]\s*([0-9.]+:\d+)/);
  const [tIp, tPort] = target ? target.split(":") : [null, null];
  return {
    tsIp: tIp || grab(/Tailscale IP\s*[:=]\s*([0-9.]+)/),
    tsHost: grab(/Tailscale Host(?:name)?\s*[:=]\s*(\S+)/),
    tsDns: grab(/Tailscale DNS(?: Name)?\s*[:=]\s*(\S+)/),
    rdpUser: grab(/Username\s*[:=]\s*(\S+)/i),
    rdpPass: grab(/Password\s*[:=]\s*(\S+)/i),
    rdpPort: tPort || grab(/RDP Port\s*[:=]\s*(\d+)/i) || grab(/Port\s*[:=]\s*(\d+)/),
    duration: grab(/Duration\s*[:=]\s*(\d+)\s*min/i) || grab(/IN_DURATION\s*[:=]\s*(\d+)/),
    warning: grab(/Warning at\s*[:=]\s*(\S+\s+\S+)/),
    sessionId: grab(/Session ID\s*[:=]\s*(\S+)/),
    autoShutdown: /Auto-Shutdown\s*[:=]\s*true/i.test(log),
  };
}
async function fetchJobLog(run) {
  const jobs = await api(`/repos/${OWNER}/${REPO}/actions/runs/${run.id}/jobs`);
  const job = (jobs.jobs || []).find((j) => j.name.includes("Provision")) || (jobs.jobs || [])[0];
  if (!job) throw new Error("no jobs found on this run");
  const res = await fetch(`${API}/repos/${OWNER}/${REPO}/actions/jobs/${job.id}/logs`, {
    headers: { Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" },
  });
  return await res.text();
}
function activeVMCard(run, info) {
  if (!run) {
    return `<div class="vm-idle">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9 12h6"/></svg>
      <p>No workstation currently running — ignite one above, then connection info appears here automatically.</p>
    </div>`;
  }
  const pending = !info || (!info.tsIp && !info.rdpUser);
  const f = (id, label, val, cls = "") => val
    ? `<div class="field ${cls}"><span class="f-label">${label}</span>
         <span class="f-val mono" id="${id}-text">${val}</span>
         <button class="icon-btn" data-copy="${id}" title="Copy">&#9114;</button></div>`
    : "";
  const rdpAddr = info && info.tsIp ? `${info.tsIp}:${info.rdpPort || "3389"}` : null;
  return `
  <div class="vm-card">
    <div class="vm-head">
      <span class="badge in_progress">running</span>
      <div class="vm-title">Workstation #${run.run_number}
        <span class="vm-sub mono">run ${run.id} · started ${ago(run.created_at)}${info && info.duration ? ` · session ${info.duration} min` : ""}${info && info.warning ? ` · warns at ${info.warning}` : ""}${info && info.autoShutdown ? ` · auto-shutdown on` : ""}</span>
      </div>
      <a href="${run.html_url}" target="_blank" rel="noopener">open ↗</a>
    </div>
    ${pending
      ? `<p class="muted vm-pending"><span class="spin"></span> Provisioning — Tailscale IP and RDP details appear here as soon as the workstation is up (this refreshes automatically).</p>`
      : `<div class="vm-fields">
          ${f("tsIp", "Tailscale IP", info.tsIp)}
          ${f("tsHost", "Hostname", info.tsHost)}
          ${f("tsDns", "Tailscale DNS", info.tsDns)}
        </div>
        <div class="rdp-block">
          <div class="rdp-title">RDP access</div>
          <div class="vm-fields">
            ${f("rdpAddr", "Address", rdpAddr)}
            ${f("rdpUser", "Username", info.rdpUser)}
            ${f("rdpPass", "Password", info.rdpPass)}
            ${f("rdpPort", "Port", info.rdpPort)}
            ${f("sessionId", "Session ID", info.sessionId)}
          </div>
          <div class="btn-row">
            <button class="btn primary sm" id="rdp-download">Download .rdp file</button>
            <button class="btn ghost sm" data-run-info="${run.id}">Full connection info</button>
          </div>
          <p class="fineprint">Connect from any device on your tailnet — Windows Remote Desktop (mstsc), or an RDP client that accepts the .rdp file.</p>
        </div>`}
  </div>`;
}
function deadVMRow(run) {
  const ok = run.conclusion === "success";
  return `
  <div class="run">
    <span class="badge ${ok ? "success" : "failure"}">${ok ? "ended" : run.conclusion || "?"}</span>
    <div class="meta">#${run.run_number} · ${ago(run.created_at)}
      <div class="sub">run ${run.id} · dead VM — session closed</div>
    </div>
    <a href="${run.html_url}" target="_blank" rel="noopener">open ↗</a>
  </div>`;
}
async function loadWorkstations() {
  if (!me) return;
  const wrap = $("ws-body");
  try {
    const data = await api(`/repos/${OWNER}/${REPO}/actions/workflows/${WF}/runs?per_page=8`);
    const runs = data.workflow_runs || [];
    const active = runs.filter((r) => r.status !== "completed");
    const dead = runs.filter((r) => r.status === "completed");
    let html = activeVMCard(active[0] || null, active[0] ? (logCache[active[0].id] || {}).info : null);
    html += `<h3 class="sub-h">Past workstations</h3>`;
    html += dead.length ? dead.map(deadVMRow).join("") : `<p class="muted">None yet.</p>`;
    wrap.innerHTML = html;
    $("ws-updated").textContent = `updated ${new Date().toLocaleTimeString()}`;
    bindVmEvents(wrap);
    if (active[0]) fetchActiveInfo(active[0]);
  } catch (err) {
    wrap.innerHTML = `<p class="error">Workstation status unavailable: ${err.message}</p>`;
  }
}
/* ---- connection info via the workflow's connection-info artifact ---- */
function parseArtifactInfo(txt) {
  const m = {};
  txt.split(/\r?\n/).forEach((l) => {
    const i = l.indexOf("=");
    if (i > 0) m[l.slice(0, i).trim()] = l.slice(i + 1).trim();
  });
  const [ip, port] = (m.rdp_target || "").split(":");
  return {
    tsIp: m.tailscale_ip || ip || null,
    tsHost: m.tailscale_hostname || null,
    tsDns: m.tailscale_dns || null,
    rdpUser: m.rdp_username || null,
    rdpPass: m.rdp_password || null,
    rdpPort: m.rdp_port || port || null,
    duration: m.duration_minutes || null,
    warning: m.warning_minutes ? `T-${m.warning_minutes} min` : null,
    sessionId: m.session_id || null,
    autoShutdown: (m.auto_shutdown || "").toLowerCase() === "true",
  };
}
/* minimal zip reader (stored + deflate) for the single-file artifact */
async function unzipFirstText(buf, needle) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("bad zip: no EOCD");
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const td = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(off, true) !== 0x02014b50) throw new Error("bad central dir");
    const method = dv.getUint16(off + 10, true);
    const csize = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const commentLen = dv.getUint16(off + 32, true);
    const lho = dv.getUint32(off + 42, true);
    const name = td.decode(u8.subarray(off + 46, off + 46 + nameLen));
    off += 46 + nameLen + extraLen + commentLen;
    if (needle && !name.toLowerCase().includes(needle)) continue;
    const lNameLen = dv.getUint16(lho + 26, true);
    const lExtraLen = dv.getUint16(lho + 28, true);
    const dataStart = lho + 30 + lNameLen + lExtraLen;
    const data = u8.subarray(dataStart, dataStart + csize);
    if (method === 0) return td.decode(data);
    if (method !== 8) throw new Error("unsupported zip method " + method);
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return await new Response(stream).text();
  }
  throw new Error("entry not found in zip");
}
async function fetchArtifactInfo(run) {
  const arts = await api(`/repos/${OWNER}/${REPO}/actions/artifacts?per_page=20`);
  const art = (arts.artifacts || []).find(
    (a) => a.workflow_run && a.workflow_run.id === run.id && a.name === "connection-info" && !a.expired);
  if (!art) return null;
  const res = await fetch(`${API}/repos/${OWNER}/${REPO}/actions/artifacts/${art.id}/zip`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
  });
  if (!res.ok) throw new Error(`artifact zip HTTP ${res.status}`);
  const txt = await unzipFirstText(await res.arrayBuffer(), "connection-info");
  return { info: parseArtifactInfo(txt), raw: txt };
}

async function fetchActiveInfo(run) {
  const cached = logCache[run.id];
  if (cached && Date.now() - cached.ts < 45000) return;
  // Prefer the workflow's connection-info artifact — in-progress job logs
  // are only intermittently fetchable via the API. Logs stay the fallback
  // (and the only source for old runs pre-v4.4.0).
  let info = null, raw = null;
  try {
    const a = await fetchArtifactInfo(run);
    if (a) { info = a.info; raw = a.raw; }
  } catch (e) { /* artifact missing or fetch hiccup — try logs */ }
  if (!info) {
    try {
      const log = await fetchJobLog(run);
      info = parseConnInfo(log);
      raw = log;
    } catch (e) { /* neither available yet — next poll retries */ }
  }
  if (!info) return;
  logCache[run.id] = { ts: Date.now(), info, raw };
  activeInfo = info;
  // re-render just the active card if fields changed
  const wrap = $("ws-body");
  const cur = wrap.querySelector(".vm-card");
  if (cur && (cached ? JSON.stringify(cached.info) !== JSON.stringify(info) : true)) {
    wrap.querySelector(".vm-card").outerHTML = activeVMCard(run, info);
    bindVmEvents(wrap);
  }
}
function bindVmEvents(wrap) {
  wrap.querySelectorAll("[data-copy]").forEach((b) => {
    b.addEventListener("click", () => {
      const id = b.dataset.copy;
      const el = $(id + "-text");
      if (el) copyText(el.textContent, b.closest(".field")?.querySelector(".f-label")?.textContent || "Value");
    });
  });
  wrap.querySelectorAll("[data-run-info]").forEach((b) =>
    b.addEventListener("click", () => showConnectionInfo(b.dataset.runInfo, b)));
  const dl = $("rdp-download");
  if (dl) dl.addEventListener("click", downloadRdp);
}
function downloadRdp() {
  const info = activeInfo;
  if (!info || !info.tsIp) { toast("No active workstation info yet.", "err"); return; }
  const rdp = [
    "screen mode id:i:2",
    "use multimon:i:0",
    `full address:s:${info.tsIp}:${info.rdpPort || "3389"}`,
    `username:s:${info.rdpUser || "SovereignUser"}`,
    `password 51:b:${btoa(info.rdpPass || "")}`,
    "authentication level:i:2",
    "desktopwidth:i:1920",
    "desktopheight:i:1080",
  ].join("\r\n");
  const blob = new Blob([rdp], { type: "application/x-rdp" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "sovereign-workstation.rdp";
  a.click();
  URL.revokeObjectURL(a.href);
  toast(".rdp file downloaded — open it with your RDP client.");
}

/* raw connection info modal */
async function showConnectionInfo(runId, btn) {
  if (btn) btn.disabled = true;
  $("conn-body").textContent = "Fetching logs…";
  openModal("conn-modal");
  try {
    const run = { id: runId };
    let log = (logCache[runId] || {}).raw;
    if (!log) {
      log = await fetchJobLog(run);
      logCache[runId] = { ts: Date.now(), info: parseConnInfo(log), raw: log };
    }
    if (/^session_id=/m.test(log)) {
      // artifact text — clean key=value lines, render as-is
      $("conn-body").textContent = log.trim();
      return;
    }
    const keep = log.split("\n").filter((l) =>
      /tailscale\s+(ip|hostname|dns)|rdp|password|username|port|exit node|connection|ping|connect|shutdown|duration/i.test(l) && l.trim());
    const out = [...new Set(keep.map((l) => l.replace(/^\S+\s+Z\s*/, "").trim()))].slice(0, 50).join("\n");
    $("conn-body").textContent = out || "(no connection lines found in log — check the run on GitHub)";
  } catch (err) {
    $("conn-body").textContent = `Failed to load connection info (${err.status || ""}): ${err.message}\n\n` +
      `Open the run on GitHub and read the "Display Connection Information" step:\nhttps://github.com/${OWNER}/${REPO}/actions/runs/${runId}`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ================= codespaces ================= */
async function createCodespace() {
  const btn = $("cs-create-btn");
  btn.disabled = true; btn.classList.add("loading");
  try {
    const cs = await api(`/repos/${OWNER}/${REPO}/codespaces`, {
      method: "POST",
      body: JSON.stringify({ ref: "main" }),
    });
    toast(`Codespace "${cs.name}" provisioning — joins the tailnet as an ephemeral exit node.`);
  } catch (err) {
    toast(`Codespace creation failed: ${err.message}`, "err");
  } finally {
    btn.disabled = false; btn.classList.remove("loading");
    loadCodespaces();
  }
}
async function loadCodespaces() {
  if (!me) return;
  const wrap = $("cs-body");
  try {
    const data = await api(`/repos/${OWNER}/${REPO}/codespaces?per_page=10`);
    const list = data.codespaces || [];
    if (!list.length) { wrap.innerHTML = `<p class="muted" style="padding:10px 2px">No codespaces running.</p>`; return; }
    wrap.innerHTML = list.map((c) => `
      <div class="run">
        <span class="badge ${c.state === "Available" ? "success" : "in_progress"}">${c.state}</span>
        <div class="meta">${c.name}
          <div class="sub">${(c.machine && c.machine.display_name) || ""} · created ${ago(c.created_at)}</div>
        </div>
        <button class="btn danger sm" data-cs-del="${c.id}">Delete</button>
      </div>`).join("");
    wrap.querySelectorAll("[data-cs-del]").forEach((b) =>
      b.addEventListener("click", async () => {
        b.disabled = true;
        try {
          await api(`/user/codespaces/${b.dataset.csDel}`, { method: "DELETE" });
          toast("Codespace deleted — node removed from the tailnet.");
        } catch (err) { toast(`Delete failed: ${err.message}`, "err"); }
        loadCodespaces();
      }));
  } catch (err) {
    wrap.innerHTML = `<p class="error">Codespaces unavailable: ${err.message}</p>`;
  }
}

/* ================= billing ================= */
function nowYM() { const d = new Date(); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 }; }
function loadLimits() { try { return JSON.parse(localStorage.getItem(LS_LIMITS)) || null; } catch { return null; } }
function defaultLimits() {
  const pro = me && me.plan && /pro/i.test(me.plan.name || "");
  return { actionsMinutes: pro ? 3000 : 2000, codespacesCoreHours: 120, codespacesStorageGbMonth: 15 };
}
const getLimits = () => Object.assign(defaultLimits(), loadLimits() || {});
const coresFromSku = (sku) => { const m = /(\d+)-core/i.exec(sku || ""); return m ? +m[1] : 1; };
const usd = (n) => "$" + (n || 0).toFixed(2);

async function loadBilling() {
  if (!me) return;
  const body = $("billing-body");
  const { y, m } = billMonth || nowYM();
  $("bill-month-label").textContent =
    new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
  try {
    const data = await api(`/users/${me.login}/settings/billing/usage?year=${y}&month=${m}`);
    const items = data.usageItems || [];
    let actionsMin = 0, csCoreHrs = 0, csGbHrs = 0, gross = 0, discount = 0, net = 0;
    const perDay = {};
    for (const it of items) {
      gross += it.grossAmount || 0; discount += it.discountAmount || 0; net += it.netAmount || 0;
      const day = (it.date || "").slice(5, 10);
      perDay[day] = perDay[day] || { a: 0, c: 0 };
      if (it.product === "actions") {
        actionsMin += it.quantity || 0;
        perDay[day].a += it.quantity || 0;
      } else if (it.product === "codespaces") {
        if (/compute/i.test(it.sku || "")) {
          const ch = (it.quantity || 0) * coresFromSku(it.sku);
          csCoreHrs += ch; perDay[day].c += ch;
        } else if (/storage/i.test(it.sku || "")) {
          csGbHrs += it.quantity || 0;
        }
      }
    }
    renderBilling({ actionsMin, csCoreHrs, csGbHrs, gross, discount, net, perDay, y, m });
  } catch (err) {
    body.innerHTML = `<p class="error">Billing unavailable (${err.status || "network"}): ${err.message}.</p>
      <p class="muted">The token may lack billing read access — fine-grained PAT: account permission <code>Plans: Read</code>; classic PAT: <code>user</code> scope.</p>`;
  }
}
function metricBar(label, used, limit, unit, decimals = 0) {
  const pct = limit > 0 ? (used / limit) * 100 : 100;
  const cls = pct > 100 ? "over" : pct > 85 ? "warn" : "";
  const left = Math.max(0, limit - used);
  return `<div class="metric">
    <div class="m-top"><span>${label}</span>
      <span>${used.toFixed(decimals)} / ${limit.toLocaleString()} ${unit} · <span class="m-left">left: ${left.toFixed(decimals)}</span></span>
    </div>
    <div class="bar-track"><div class="bar-fill ${cls}" style="width:${Math.min(100, pct)}%"></div></div>
  </div>`;
}
function renderBilling(t) {
  const lim = getLimits();
  const csGbMonth = t.csGbHrs / 730;
  const tiles = `
    <div class="tile"><div class="t-label">Actions minutes</div><div class="t-value">${Math.round(t.actionsMin).toLocaleString()}</div><div class="t-sub">of ${lim.actionsMinutes.toLocaleString()} included</div></div>
    <div class="tile"><div class="t-label">Codespaces core-h</div><div class="t-value">${Math.round(t.csCoreHrs).toLocaleString()}</div><div class="t-sub">of ${lim.codespacesCoreHours.toLocaleString()} included</div></div>
    <div class="tile"><div class="t-label">Codespaces storage</div><div class="t-value">${csGbMonth.toFixed(2)}<span style="font-size:12px"> GB-mo</span></div><div class="t-sub">of ${lim.codespacesStorageGbMonth.toLocaleString()} GB-mo included</div></div>
    <div class="tile"><div class="t-label">Month net cost</div><div class="t-value">${usd(t.net)}</div><div class="t-sub">${usd(t.discount)} covered by included usage</div></div>`;
  const days = new Date(Date.UTC(t.y, t.m, 0)).getUTCDate();
  const mon = new Date(Date.UTC(t.y, t.m - 1, 1)).toLocaleDateString(undefined, { month: "short", timeZone: "UTC" });
  let max = 0;
  const rows = [];
  for (let d = 1; d <= days; d++) {
    const key = String(t.m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
    const v = t.perDay[key] || { a: 0, c: 0 };
    max = Math.max(max, v.a, v.c);
    rows.push({ d, ...v });
  }
  const chart = rows.map((r) => {
    const bars = (r.a || r.c)
      ? `<div class="d-bar d-actions" style="height:${max ? (r.a / max) * 100 : 0}%"></div><div class="d-bar d-cs" style="height:${max ? (r.c / max) * 100 : 0}%"></div>`
      : `<div class="d-zero"></div>`;
    return `<div class="day" title="${mon} ${r.d} · ${Math.round(r.a)} min actions · ${r.c.toFixed(2)} core-h codespaces">${bars}</div>`;
  }).join("");
  const legend = `<div class="chart-legend">
    <span><span class="legend-dot" style="background:linear-gradient(180deg,#3cf0ba,#14b586)"></span>Actions minutes / day</span>
    <span><span class="legend-dot" style="background:linear-gradient(180deg,#ffce85,#d69a35)"></span>Codespaces core-hours / day</span>
  </div>`;
  $("billing-body").innerHTML = `
    <div class="tiles">${tiles}</div>
    ${metricBar("Actions minutes", t.actionsMin, lim.actionsMinutes, "min")}
    ${metricBar("Codespaces compute", t.csCoreHrs, lim.codespacesCoreHours, "core-h", 1)}
    ${metricBar("Codespaces storage", csGbMonth, lim.codespacesStorageGbMonth, "GB-mo", 2)}
    <div class="chart">${chart}</div>${legend}
    <p class="b-cost">Gross <b>${usd(t.gross)}</b> · covered <b>${usd(t.discount)}</b> · net <b>${usd(t.net)}</b> — from the GitHub billing usage report.</p>`;
}
function shiftMonth(dir) {
  const cur = billMonth || nowYM();
  const d = new Date(Date.UTC(cur.y, cur.m - 1 + dir, 1));
  billMonth = { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
  loadBilling();
}
function toggleLimitsForm() {
  const f = $("limits-form");
  if (f.classList.contains("hidden")) {
    const l = getLimits();
    $("lim-actions").value = l.actionsMinutes;
    $("lim-cs-hrs").value = l.codespacesCoreHours;
    $("lim-cs-gb").value = l.codespacesStorageGbMonth;
    f.classList.remove("hidden");
  } else f.classList.add("hidden");
}

/* ================= refresh & init ================= */
function refreshAll() {
  if (!me || document.hidden) return;
  loadWorkstations();
  loadCodespaces();
  if (!billMonth) loadBilling();
}

/* wire up */
$("oauth-btn").addEventListener("click", startOAuth);
$("token-toggle").addEventListener("click", () => {
  const p = $("token-pane");
  p.classList.toggle("hidden");
  if (!p.classList.contains("hidden")) $("login-input").focus();
});
$("login-submit").addEventListener("click", doLogin);
$("login-input").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
$("login-visibility").addEventListener("click", () => {
  const i = $("login-input");
  i.type = i.type === "password" ? "text" : "password";
});
$("login-close").addEventListener("click", () => closeModal("login-modal"));
$("login-modal").addEventListener("click", (e) => { if (e.target === $("login-modal")) closeModal("login-modal"); });
$("conn-close").addEventListener("click", () => closeModal("conn-modal"));
$("conn-modal").addEventListener("click", (e) => { if (e.target === $("conn-modal")) closeModal("conn-modal"); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { closeModal("login-modal"); closeModal("conn-modal"); }
});
$("dispatch-form").addEventListener("submit", dispatch);
$("cs-create-btn").addEventListener("click", createCodespace);
$("bill-prev").addEventListener("click", () => shiftMonth(-1));
$("bill-next").addEventListener("click", () => shiftMonth(1));
$("limits-btn").addEventListener("click", toggleLimitsForm);
$("limits-save").addEventListener("click", () => {
  localStorage.setItem(LS_LIMITS, JSON.stringify({
    actionsMinutes: +$("lim-actions").value || 0,
    codespacesCoreHours: +$("lim-cs-hrs").value || 0,
    codespacesStorageGbMonth: +$("lim-cs-gb").value || 0,
  }));
  $("limits-form").classList.add("hidden");
  loadBilling();
  toast("Limits saved.");
});
document.addEventListener("visibilitychange", () => { if (!document.hidden && me) refreshAll(); });

(async function init() {
  renderAuthArea();
  const oauthDone = await completeOAuth();
  if (!oauthDone) {
    if (token) {
      try {
        me = await api("/user");
        finishSignIn();
      } catch (e) {
        token = ""; me = null;
        localStorage.removeItem(KEY);
        renderLocks();
        toast("Saved credentials no longer work — sign in again.", "err");
      }
    } else {
      renderLocks();
    }
  }
})();
