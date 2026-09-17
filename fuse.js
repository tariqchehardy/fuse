"use strict";
/* FUSE — dispatch console for sovereign workstations.
   Static page that talks straight to the GitHub REST API from the browser.
   Sign-in is optional: the console renders as a guest until a PAT is added. */

const OWNER = "tariqchehardy";
const REPO = "sovereign-workstation";
const WF = "provision-sovereign-workstation.yml";
const API = "https://api.github.com";
const KEY = "fuse_token";
const LS_LIMITS = "fuse_limits";

const $ = (id) => document.getElementById(id);
let token = localStorage.getItem(KEY) || "";
let me = null;
let timer = null;
let billMonth = null;

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
    <p>Sign in with a GitHub token to ${what}.</p>
    <button class="btn primary sm" data-open-login>Sign in with token</button>
  </div>`;
}
function bindLoginButtons(root) {
  root.querySelectorAll("[data-open-login]").forEach((b) => b.addEventListener("click", () => openLogin()));
}

/* ================= auth ================= */
function openLogin() {
  $("login-error").classList.add("hidden");
  $("login-input").value = "";
  openModal("login-modal");
  $("login-input").focus();
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
    renderAuthArea();
    renderLocks();
    startPolling();
    refreshAll();
    toast(`Signed in as ${me.login} — console unlocked.`);
  } catch (e) {
    token = save;
    $("login-error").textContent =
      `Login failed (${e.status || "network"}): ${e.message}` +
      (e.status === 401 ? " — token invalid or expired." :
       e.status === 403 ? " — token lacks access. Check the scopes below." : "");
    $("login-error").classList.remove("hidden");
  } finally {
    $("login-submit").disabled = false;
  }
}
function logout() {
  localStorage.removeItem(KEY);
  token = ""; me = null;
  clearInterval(timer); timer = null;
  renderAuthArea();
  renderLocks();
  toast("Signed out. Token cleared from this browser.");
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
  const bodies = { "billing-body": "load billing and usage", "cs-body": "manage codespace exit nodes", "runs-body": "see workstation runs" };
  for (const [id, what] of Object.entries(bodies)) {
    if (!authed) { $(id).innerHTML = lockedHTML(what); bindLoginButtons($(id)); }
  }
}
function startPolling() {
  clearInterval(timer);
  timer = setInterval(refreshAll, 15000);
}

/* ================= dispatch ================= */
async function dispatch(e) {
  e.preventDefault();
  if (!me) { openLogin(); return; }
  const btn = $("dispatch-btn");
  btn.disabled = true;
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
    msg.textContent = "Dispatched — ignition. Status below in a moment.";
    msg.className = "ok";
    toast("Workstation dispatched — ignition.");
  } catch (err) {
    msg.textContent = `Failed (${err.status}): ${err.message}`;
    msg.className = "err";
    toast(`Dispatch failed: ${err.message}`, "err");
  } finally {
    btn.disabled = false;
    loadRuns();
  }
}

/* ================= codespaces ================= */
async function createCodespace() {
  const btn = $("cs-create-btn");
  btn.disabled = true;
  try {
    const cs = await api(`/repos/${OWNER}/${REPO}/codespaces`, {
      method: "POST",
      body: JSON.stringify({ ref: "main" }),
    });
    toast(`Codespace "${cs.name}" provisioning — joins the tailnet as an ephemeral exit node.`);
  } catch (err) {
    toast(`Codespace creation failed: ${err.message}`, "err");
  } finally {
    btn.disabled = false;
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

/* ================= runs ================= */
const ago = (iso) => {
  const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
};
async function loadRuns() {
  if (!me) return;
  const wrap = $("runs-body");
  try {
    const data = await api(`/repos/${OWNER}/${REPO}/actions/workflows/${WF}/runs?per_page=6`);
    const runs = data.workflow_runs || [];
    if (!runs.length) { wrap.innerHTML = `<p class="muted" style="padding:10px 2px">No runs yet — ignite a workstation above.</p>`; return; }
    wrap.innerHTML = runs.map((r) => {
      const st = r.status === "completed" ? (r.conclusion || "?") : "running";
      const cls = r.status === "completed"
        ? (r.conclusion === "success" ? "success" : r.conclusion)
        : r.status === "queued" || r.status === "waiting" ? "queued" : "in_progress";
      return `
      <div class="run">
        <span class="badge ${cls}">${st}</span>
        <div class="meta">Run #${r.run_number} · ${ago(r.created_at)}
          <div class="sub">${r.id}${r.display_title ? " · " + r.display_title : ""}</div>
        </div>
        <button class="btn ghost sm" data-run-info="${r.id}">Connection info</button>
        <a href="${r.html_url}" target="_blank" rel="noopener">open ↗</a>
      </div>`;
    }).join("");
    wrap.querySelectorAll("[data-run-info]").forEach((b) =>
      b.addEventListener("click", () => showConnectionInfo(b.dataset.runInfo, b)));
  } catch (err) {
    wrap.innerHTML = `<p class="error">Runs unavailable: ${err.message}</p>`;
  }
}

/* connection info: pull the provision job's log */
async function showConnectionInfo(runId, btn) {
  btn.disabled = true;
  $("conn-body").textContent = "Fetching logs…";
  openModal("conn-modal");
  try {
    const jobs = await api(`/repos/${OWNER}/${REPO}/actions/runs/${runId}/jobs`);
    const job = (jobs.jobs || []).find((j) => j.name.includes("Provision")) || (jobs.jobs || [])[0];
    if (!job) throw new Error("no jobs found on this run");
    let log = "";
    try {
      const res = await fetch(`${API}/repos/${OWNER}/${REPO}/actions/jobs/${job.id}/logs`, {
        headers: { Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" },
      });
      log = await res.text();
    } catch (e) { log = ""; }
    let out;
    if (log) {
      const keep = log.split("\n").filter((l) =>
        /tailscale\s+(ip|hostname|dns)|rdp|password|username|port|exit node|connection|ping|connect/i.test(l) && l.trim());
      out = [...new Set(keep.map((l) => l.replace(/^\S+\s+Z\s*/, "").trim()))].slice(0, 40).join("\n");
      if (!out) out = "(no connection lines found in log — check the run on GitHub)";
    } else {
      out = `Log fetch blocked (CORS on the log redirect). Open the run on GitHub and read the
"Display Connection Information" step:
https://github.com/${OWNER}/${REPO}/actions/runs/${runId}`;
    }
    $("conn-body").textContent = out;
  } catch (err) {
    $("conn-body").textContent = `Failed to load connection info (${err.status || ""}): ${err.message}`;
  } finally {
    btn.disabled = false;
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
  if (!me) return;
  loadRuns();
  loadCodespaces();
  if (!billMonth) loadBilling();
}

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

(async function init() {
  renderAuthArea();
  if (token) {
    try {
      me = await api("/user");
      renderAuthArea();
      renderLocks();
      $("runs-body").innerHTML = skeletons(3);
      $("cs-body").innerHTML = skeletons(2);
      $("billing-body").innerHTML = skeletons(3);
      refreshAll();
      startPolling();
    } catch (e) {
      token = ""; me = null;
      localStorage.removeItem(KEY);
      renderLocks();
      toast("Saved token no longer works — sign in again.", "err");
    }
  } else {
    renderLocks();
  }
})();
