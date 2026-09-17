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
    const me = await api("/user");
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

function refreshAll() { loadRuns(); loadCodespaces(); }

/* ---------------- wire up ---------------- */
$("login-btn").addEventListener("click", login);
$("token-input").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
$("token-visibility").addEventListener("click", () => {
  const i = $("token-input");
  i.type = i.type === "password" ? "text" : "password";
});
$("logout-btn").addEventListener("click", logout);
$("dispatch-form").addEventListener("submit", dispatch);
$("cs-create-btn").addEventListener("click", createCodespace);
$("modal-close").addEventListener("click", () => $("modal").classList.add("hidden"));
$("modal").addEventListener("click", (e) => { if (e.target === $("modal")) $("modal").classList.add("hidden"); });

if (token) {
  api("/user").then((me) => {
    $("user-avatar").src = me.avatar_url;
    $("user-login").textContent = me.login;
    boot();
  }).catch(() => { token = ""; localStorage.removeItem(KEY); });
}
