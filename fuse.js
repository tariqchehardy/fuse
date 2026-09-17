"use strict";
/* FUSE — dispatch console for sovereign workstations.
   Talks directly to the GitHub REST API from the browser.
   The PAT lives only in localStorage and is sent only to api.github.com. */

const OWNER = "tariqchehardy";
const REPO = "sovereign-workstation";
const WF = "provision-sovereign-workstation.yml";
const API = "https://api.github.com";
const KEY = "fuse_token";

const $ = (id) => document.getElementById(id);
let token = localStorage.getItem(KEY) || "";
let timer = null;
let me = null;

/* ---------------- API helper ---------------- */
async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
      ...(opts.headers || {}),
    },
  });
  setDot(true);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.message || res.statusText);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}
function setDot(ok) { $("api-dot").className = `dot ${ok ? "ok" : "bad"}`; }

/* ---------------- auth ---------------- */
async function login() {
  const t = $("token-input").value.trim();
  if (!t) return;
  $("login-btn").disabled = true;
  $("login-error").classList.add("hidden");
  try {
    token = t;
    me = await api("/user");
    localStorage.setItem(KEY, t);
    $("user-avatar").src = me.avatar_url;
    $("user-login").textContent = me.login;
    boot();
  } catch (e) {
    token = "";
    $("login-error").textContent =
      `Login failed (${e.status || "network"}): ${e.message}` +
      (e.status === 401 ? " — token invalid or expired." :
       e.status === 403 ? " — token lacks access. Classic PAT: repo+workflow scopes." : "");
    $("login-error").classList.remove("hidden");
  } finally {
    $("login-btn").disabled = false;
  }
}
function logout() {
  localStorage.removeItem(KEY);
  token = "";
  clearInterval(timer);
  $("login-view").classList.remove("hidden");
  $("console-view").classList.add("hidden");
  $("user-chip").classList.add("hidden");
  $("token-input").value = "";
}
function boot() {
  $("login-view").classList.add("hidden");
  $("console-view").classList.remove("hidden");
  $("user-chip").classList.remove("hidden");
  refreshAll();
  clearInterval(timer);
  timer = setInterval(refreshAll, 15000);
}

/* ---------------- dispatch workstation ---------------- */
async function dispatch(e) {
  e.preventDefault();
  const btn = $("dispatch-btn");
  btn.disabled = true;
  const msg = $("dispatch-msg");
  msg.classList.add("hidden");
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
    msg.textContent = "⚡ Workstation dispatched — ignition. Status appears below in a moment.";
    msg.className = "muted";
  } catch (err) {
    msg.textContent = `Dispatch failed (${err.status}): ${err.message}`;
    msg.className = "error";
  } finally {
    msg.classList.remove("hidden");
    btn.disabled = false;
  }
}

/* ---------------- codespaces ---------------- */
async function createCodespace() {
  const btn = $("cs-create-btn");
  const msg = $("cs-msg");
  btn.disabled = true;
  try {
    const cs = await api(`/repos/${OWNER}/${REPO}/codespaces`, {
      method: "POST",
      body: JSON.stringify({ ref: "main" }),
    });
    msg.textContent = `▲ Codespace "${cs.name}" is provisioning — it will join the tailnet as an ephemeral exit node automatically.`;
    msg.className = "muted";
  } catch (err) {
    msg.textContent = `Codespace creation failed (${err.status}): ${err.message}`;
    msg.className = "error";
  } finally {
    msg.classList.remove("hidden");
    btn.disabled = false;
    loadCodespaces();
  }
}
async function loadCodespaces() {
  const wrap = $("codespaces-list");
  try {
    const data = await api(`/repos/${OWNER}/${REPO}/codespaces?per_page=10`);
    const list = data.codespaces || [];
    if (!list.length) { wrap.innerHTML = `<p class="muted">No codespaces running.</p>`; return; }
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
        try { await api(`/user/codespaces/${b.dataset.csDel}`, { method: "DELETE" }); }
        catch (err) { alert(`Delete failed: ${err.message}`); }
        loadCodespaces();
      }));
  } catch (err) {
    wrap.innerHTML = `<p class="error">Codespaces list failed: ${err.message}</p>`;
  }
}

/* ---------------- runs ---------------- */
const STATUS_LABEL = { success: "success", failure: "failed", in_progress: "running", queued: "queued", waiting: "queued", cancelled: "cancelled" };
function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}
async function loadRuns() {
  const wrap = $("runs-list");
  try {
    const data = await api(`/repos/${OWNER}/${REPO}/actions/workflows/${WF}/runs?per_page=6`);
    const runs = data.workflow_runs || [];
    if (!runs.length) { wrap.innerHTML = `<p class="muted">No runs yet.</p>`; return; }
    wrap.innerHTML = runs.map((r) => `
      <div class="run">
        <span class="badge ${STATUS_LABEL[r.status === "completed" ? r.conclusion : r.status] || "queued"}">
          ${r.status === "completed" ? (r.conclusion || "?") : "running"}</span>
        <div class="meta">#${r.run_number} · dispatched ${ago(r.created_at)}
          <div class="sub">run ${r.id}</div>
        </div>
        <button class="btn ghost sm" data-run-info="${r.id}">Connection info</button>
        <a href="${r.html_url}" target="_blank" rel="noopener">open ↗</a>
      </div>`).join("");
    wrap.querySelectorAll("[data-run-info]").forEach((b) =>
      b.addEventListener("click", () => showConnectionInfo(b.dataset.runInfo, b)));
  } catch (err) {
    wrap.innerHTML = `<p class="error">Runs list failed: ${err.message}</p>`;
  }
}

/* pull the provision job's log and surface connection details */
async function showConnectionInfo(runId, btn) {
  btn.disabled = true;
  $("modal-body").textContent = "Fetching logs…";
  $("modal").classList.remove("hidden");
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
    } catch (e) {
      log = "";
    }

    let out = "";
    if (log) {
      const keep = log.split("\n").filter((l) =>
        /tailscale\s+(ip|hostname|dns)|rdp|password|username|port|exit node|connection|ping|connect/i.test(l) && l.trim());
      const dedup = [...new Set(keep.map((l) => l.replace(/^\S+\s+Z\s*/, "").trim()))];
      out = dedup.slice(0, 40).join("\n");
      if (!out) out = "(no connection lines found in log — check the run on GitHub)";
    } else {
      out = `Log fetch blocked (CORS on the log redirect). Open the run on GitHub and read the
"Display Connection Information" step:\nhttps://github.com/${OWNER}/${REPO}/actions/runs/${runId}`;
    }
    $("modal-body").textContent = out;
  } catch (err) {
    $("modal-body").textContent = `Failed to load connection info (${err.status || ""}): ${err.message}`;
  } finally {
    btn.disabled = false;
  }
}

function refreshAll() { loadRuns(); loadCodespaces(); if (!billMonth) loadBilling(); }


/* ---------------- billing & usage ---------------- */
const LS_LIMITS = "fuse_limits";
let billMonth = null; // {y, m} while navigating
function nowYM() { const d = new Date(); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 }; }
function loadLimits() {
  try { return JSON.parse(localStorage.getItem(LS_LIMITS)) || null; } catch { return null; }
}
function defaultLimits() {
  const pro = me && me.plan && /pro/i.test(me.plan.name || "");
  return { actionsMinutes: pro ? 3000 : 2000, codespacesCoreHours: 120, codespacesStorageGbMonth: 15 };
}
function getLimits() { return Object.assign(defaultLimits(), loadLimits() || {}); }

function coresFromSku(sku) { const m = /(\d+)-core/i.exec(sku || ""); return m ? +m[1] : 1; }
const usd = (n) => "$" + (n || 0).toFixed(2);

async function loadBilling() {
  const body = $("billing-body");
  const { y, m } = billMonth || nowYM();
  const lbl = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
  $("bill-month-label").textContent = lbl;
  try {
    const data = await api(`/users/${me.login}/settings/billing/usage?year=${y}&month=${m}`);
    const items = data.usageItems || [];

    // aggregate
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
      <p class="muted">The token may lack billing read access — for a fine-grained PAT add the account permission <code>Plans: Read</code>; for a classic PAT include the <code>user</code> scope.</p>`;
  }
}

function metricBar(label, used, limit, unit, decimals = 0) {
  const pct = limit > 0 ? (used / limit) * 100 : 100;
  const cls = pct > 100 ? "over" : pct > 85 ? "warn" : "";
  const left = Math.max(0, limit - used);
  return `<div class="metric">
    <div class="m-top"><span>${label}</span>
      <span>${used.toFixed(decimals)} / ${limit.toLocaleString()} ${unit} used · <span class="m-left">left: ${left.toFixed(decimals)} ${unit}</span></span>
    </div>
    <div class="bar-track"><div class="bar-fill ${cls}" style="width:${Math.min(100, pct)}%"></div></div>
  </div>`;
}

function renderBilling(t) {
  const lim = getLimits();
  const csGbMonth = t.csGbHrs / 730; // GB-hours -> GB-month
  const body = $("billing-body");

  // tiles
  const tiles = `
    <div class="tile"><div class="t-label">Actions minutes</div><div class="t-value">${Math.round(t.actionsMin).toLocaleString()}</div><div class="t-sub">of ${lim.actionsMinutes.toLocaleString()} included</div></div>
    <div class="tile"><div class="t-label">Codespaces core-h</div><div class="t-value">${Math.round(t.csCoreHrs).toLocaleString()}</div><div class="t-sub">of ${lim.codespacesCoreHours.toLocaleString()} included</div></div>
    <div class="tile"><div class="t-label">Codespaces storage</div><div class="t-value">${csGbMonth.toFixed(2)}<span style="font-size:12px"> GB-mo</span></div><div class="t-sub">of ${lim.codespacesStorageGbMonth.toLocaleString()} GB-mo included</div></div>
    <div class="tile"><div class="t-label">Month net cost</div><div class="t-value">${usd(t.net)}</div><div class="t-sub">${usd(t.discount)} covered by included usage</div></div>`;

  // daily usage chart
  const days = new Date(Date.UTC(t.y, t.m, 0)).getUTCDate();
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
    const mon = new Date(Date.UTC(t.y, t.m - 1, 1)).toLocaleDateString(undefined, { month: "short", timeZone: "UTC" });
    return `<div class="day" title="${mon} ${r.d} · ${Math.round(r.a)} min actions · ${r.c.toFixed(2)} core-h codespaces">${bars}</div>`;
  }).join("");
  const legend = `<div class="chart-legend">
    <span><span class="legend-dot" style="background:var(--accent)"></span>Actions minutes / day</span>
    <span><span class="legend-dot" style="background:var(--warn)"></span>Codespaces core-hours / day</span>
  </div>`;

  body.innerHTML = `
    <div class="tiles">${tiles}</div>
    ${metricBar("Actions minutes", t.actionsMin, lim.actionsMinutes, "min")}
    ${metricBar("Codespaces compute", t.csCoreHrs, lim.codespacesCoreHours, "core-h", 1)}
    ${metricBar("Codespaces storage", csGbMonth, lim.codespacesStorageGbMonth, "GB-mo", 2)}
    <div class="chart">${chart}</div>${legend}
    <p class="b-cost">Gross ${usd(t.gross)} · covered ${usd(t.discount)} · net ${usd(t.net)} — from the GitHub billing usage report for this month.</p>`;
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

/* ---------------- wire up ---------------- */
$("login-btn").addEventListener("click", login);
$("token-input").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
$("token-visibility").addEventListener("click", () => {
  const i = $("token-input");
  i.type = i.type === "password" ? "text" : "password";
});
$("logout-btn").addEventListener("click", logout);
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
});
$("dispatch-form").addEventListener("submit", dispatch);
$("cs-create-btn").addEventListener("click", createCodespace);
$("modal-close").addEventListener("click", () => $("modal").classList.add("hidden"));
$("modal").addEventListener("click", (e) => { if (e.target === $("modal")) $("modal").classList.add("hidden"); });

if (token) {
  api("/user").then((u) => {
    me = u;
    $("user-avatar").src = me.avatar_url;
    $("user-login").textContent = me.login;
    boot();
  }).catch(() => { token = ""; localStorage.removeItem(KEY); });
}
