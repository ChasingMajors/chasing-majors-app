/* ================================
   Print Run Vault — app.js
   - Homepage search handoff support
   - Uses Checklist Vault theme system
   - Bottom nav handled in HTML
   - Master logger support
   - Boot overlay integration
   - Normalized query matching for homepage/trending links
================================ */

// ---------------- CONFIG ----------------
const EXEC_URL = "https://script.google.com/macros/s/AKfycbz2GrNPpgls5Q2cwt8IkTGrtbged7J4pxIvec5F0r1JoTo-9m2OMkYvDFFz_MM0LEjOHA/exec";
const LOG_EXEC_URL = "https://script.google.com/macros/s/AKfycbyuTmGksD9ZF89Ij0VmnUeJqP0OcFL5qCe-MUjN0JonJ8QTlfpMsf0XRKZzCwLdFdiF/exec";
const INDEX_KEY = "prv_index_v1";
const INDEX_VER_KEY = "prv_index_ver_v1";
const THEME_KEY = "cm_theme";
const HANDOFF_FLAG_KEY = "cm_handoff_active";
const OVERLAY_MIN_MS = 1200;

// ---------------- DOM ----------------
const elQ = document.getElementById("q");
const elDD = document.getElementById("dropdown");
const elResults = document.getElementById("results");
const elThemeBtn = document.getElementById("themeToggle");
const elBtnSearch = document.getElementById("btnSearch");
const elBtnClear = document.getElementById("btnClear");
const elBootOverlay = document.getElementById("cmBootOverlay");

// ---------------- URL PARAM ----------------
const URL_Q = new URLSearchParams(location.search).get("q") || "";

// ---------------- STATE ----------------
let INDEX = [];
let selected = null;
let initDone = false;
let bootOverlayShownAt = window.__CM_SHOW_BOOT_OVERLAY__ ? Date.now() : 0;

// ---------------- QUERY HELPERS ----------------
function cleanQuery(value) {
  return String(value || "")
    .replace(/\u2019/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------- APPLY QUERY TO INPUT ----------------
function applyIncomingQueryToInput() {
  const incoming = cleanQuery(URL_Q || "");
  if (!incoming || !elQ) return;
  elQ.value = incoming;
}

// ---------------- THEME ----------------
function setTheme(theme) {
  const t = theme === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", t);
  localStorage.setItem(THEME_KEY, t);

  const icon = document.getElementById("themeIcon");
  if (!icon) return;

  if (t === "dark") {
    icon.innerHTML = `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>`;
  } else {
    icon.innerHTML = `
      <circle cx="12" cy="12" r="4"></circle>
      <path d="M12 2v2"></path><path d="M12 20v2"></path>
      <path d="M4.93 4.93l1.41 1.41"></path><path d="M17.66 17.66l1.41 1.41"></path>
      <path d="M2 12h2"></path><path d="M20 12h2"></path>
      <path d="M4.93 19.07l1.41-1.41"></path><path d="M17.66 6.34l1.41-1.41"></path>
    `;
  }
}

function loadTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") setTheme(saved);
  else setTheme("dark");
}

if (elThemeBtn) {
  elThemeBtn.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") || "dark";
    setTheme(cur === "dark" ? "light" : "dark");
  });
}

// ---------------- HELPERS ----------------
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    '"':"&quot;",
    "'":"&#39;"
  }[m]));
}

function fmtNum(x) {
  const n = Number(String(x ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n.toLocaleString() : esc(x);
}

function clearHomepageHandoff() {
  try {
    sessionStorage.removeItem("cm_home_search");
    sessionStorage.removeItem("cm_home_target");
    sessionStorage.removeItem(HANDOFF_FLAG_KEY);
  } catch (e) {}
}

function hideBootOverlay(force) {
  if (!elBootOverlay) return;

  const elapsed = Date.now() - bootOverlayShownAt;
  const remaining = Math.max(0, OVERLAY_MIN_MS - elapsed);

  setTimeout(() => {
    elBootOverlay.classList.remove("show");
    document.body.classList.remove("cm-handoff-loading");

    setTimeout(() => {
      elBootOverlay.style.display = "none";
    }, 240);
  }, force ? 0 : remaining);
}

// ---------------- LOGGER ----------------
function getSessionId_() {
  try {
    const key = "cm_session_id";
    let val = localStorage.getItem(key);
    if (!val) {
      val = "cm_" + Date.now() + "_" + Math.random().toString(36).slice(2, 10);
      localStorage.setItem(key, val);
    }
    return val;
  } catch (e) {
    return "cm_" + Date.now();
  }
}

function normalizeQuery_(value) {
  return cleanQuery(value)
    .toLowerCase()
    .replace(/[^\w\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function logEventFireAndForget_(payload) {
  const body = JSON.stringify({
    action: "logEvent",
    payload: Object.assign({
      app: "prv",
      page: "vault",
      session_id: getSessionId_(),
      referrer: document.referrer || "",
      url: location.href,
      user_agent: navigator.userAgent || "",
      status: "ok"
    }, payload || {})
  });

  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
      navigator.sendBeacon(LOG_EXEC_URL, blob);
      return;
    }
  } catch (e) {}

  fetch(LOG_EXEC_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body,
    keepalive: true
  }).catch(() => {});
}

function logSelectionFireAndForget_(sel) {
  if (!sel) return;

  logEventFireAndForget_({
    event_type: "typeahead_select",
    query: sel.DisplayName || "",
    normalized_query: normalizeQuery_(sel.DisplayName || ""),
    search_kind: "product",
    selected_name: sel.DisplayName || "",
    selected_code: sel.Code || "",
    selected_type: "product",
    sport: sel.sport || "",
    year: sel.year || "",
    route_target: "vault",
    source: "dropdown"
  });
}

// ---------------- API ----------------
async function api(action, payload = {}) {
  const res = await fetch(EXEC_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, payload })
  });

  const data = await res.json();

  if (!data || data.ok === false) {
    throw new Error(data?.error || "Request failed");
  }

  return data;
}

// ---------------- INDEX CACHE ----------------
function loadCachedIndex_() {
  const cached = localStorage.getItem(INDEX_KEY);
  if (!cached) return [];
  try {
    return JSON.parse(cached) || [];
  } catch (e) {
    return [];
  }
}

function storeIndex_(indexArr, versionStr) {
  INDEX = Array.isArray(indexArr) ? indexArr : [];
  localStorage.setItem(INDEX_KEY, JSON.stringify(INDEX));
  if (versionStr) localStorage.setItem(INDEX_VER_KEY, String(versionStr));
}

async function ensureFreshIndex_() {
  INDEX = loadCachedIndex_();
  const forceRefresh = new URLSearchParams(location.search).get("refresh") === "1";

  try {
    const meta = await api("meta");
    const remoteVer = meta && meta.ok ? String(meta.indexVersion || "") : "";
    const localVer = localStorage.getItem(INDEX_VER_KEY) || "";

    if (forceRefresh || !INDEX.length || (remoteVer && remoteVer !== localVer)) {
      const d = await api("index");
      const fresh = (d && d.ok && Array.isArray(d.index)) ? d.index : (d.index || []);
      storeIndex_(fresh, remoteVer || localVer);
    }
  } catch (e) {
    console.warn("Index freshness check failed, using cache.", e);
  }
}

// ---------------- SEARCH HELPERS ----------------
function findBestMatch(query) {
  const q = normalizeQuery_(query);
  if (!q || !INDEX.length) return null;

  const exactDisplay = INDEX.find(i =>
    normalizeQuery_(i.DisplayName || "") === q
  );
  if (exactDisplay) return exactDisplay;

  const exactCode = INDEX.find(i =>
    normalizeQuery_(i.Code || "") === q
  );
  if (exactCode) return exactCode;

  const startsWithDisplay = INDEX.find(i =>
    normalizeQuery_(i.DisplayName || "").startsWith(q)
  );
  if (startsWithDisplay) return startsWithDisplay;

  const includesMatch = INDEX.find(i =>
    normalizeQuery_(`${i.DisplayName || ""} ${i.Keywords || ""} ${i.Code || ""}`).includes(q)
  );
  if (includesMatch) return includesMatch;

  return null;
}

// ---------------- HOMEPAGE HANDOFF ----------------
function runHomepageHandoffIfPresent() {
  if (!initDone) return;

  const urlQuery = cleanQuery(URL_Q || "");
  let savedQuery = "";
  let savedTarget = "";

  try {
    savedQuery = cleanQuery(sessionStorage.getItem("cm_home_search") || "");
    savedTarget = sessionStorage.getItem("cm_home_target") || "";
  } catch (e) {}

  const incomingQuery = urlQuery || savedQuery;

  if (!incomingQuery) {
    hideBootOverlay(true);
    return;
  }
  if (!elQ) {
    hideBootOverlay(true);
    return;
  }

  if (!urlQuery && savedTarget && savedTarget !== "vault") {
    hideBootOverlay(true);
    return;
  }

  elQ.value = incomingQuery;
  closeDropdown();

  const best = findBestMatch(incomingQuery);
  if (!best) {
    logEventFireAndForget_({
      event_type: "search_submit",
      query: incomingQuery,
      normalized_query: normalizeQuery_(incomingQuery),
      search_kind: "product",
      selected_name: "",
      selected_code: "",
      selected_type: "",
      sport: "",
      year: "",
      route_target: "vault",
      source: "homepage_handoff",
      status: "error"
    });

    elResults.innerHTML = `<div class="card" style="opacity:.8;">No matching product found for "${esc(incomingQuery)}".</div>`;
    hideBootOverlay();
    clearHomepageHandoff();
    return;
  }

  selected = best;
  elQ.value = best.DisplayName;
  logSelectionFireAndForget_(selected);

  runSearch().finally(clearHomepageHandoff);
}

// ---------------- INIT ----------------
(async function init() {
  loadTheme();
  applyIncomingQueryToInput();
  await ensureFreshIndex_();
  initDone = true;
  runHomepageHandoffIfPresent();
})();

// ---------------- DROPDOWN ----------------
function openDropdown(html) {
  elDD.innerHTML = html;
  elDD.style.display = "block";
}

function closeDropdown() {
  elDD.style.display = "none";
  elDD.innerHTML = "";
}

// ---------------- TYPEAHEAD ----------------
elQ.addEventListener("input", () => {
  const q = normalizeQuery_(elQ.value);
  selected = null;

  if (q.length < 2) {
    closeDropdown();
    return;
  }

  const hits = INDEX
    .filter(i => normalizeQuery_(`${i.DisplayName || ""} ${i.Keywords || ""} ${i.Code || ""}`).includes(q))
    .slice(0, 10);

  if (!hits.length) {
    closeDropdown();
    return;
  }

  openDropdown(hits.map(i => `
    <div class="ddItem" data-code="${esc(i.Code)}">
      <div class="ddTitle">${esc(i.DisplayName)}</div>
      <div class="ddMeta">${esc(i.year)} • ${esc(i.sport)} • ${esc(i.manufacturer)}</div>
    </div>
  `).join(""));

  [...elDD.children].forEach(node => {
    node.onclick = async () => {
      selected = INDEX.find(x => String(x.Code) === String(node.dataset.code)) || null;
      if (!selected) return;

      elQ.value = selected.DisplayName;
      closeDropdown();

      logSelectionFireAndForget_(selected);
      await runSearch();
    };
  });
});

document.addEventListener("click", (e) => {
  const inSearch = e.target.closest(".searchWrap") || e.target.closest("#dropdown");
  if (!inSearch) closeDropdown();
});

elQ.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    runSearch();
  }
});

// ---------------- BUTTONS ----------------
if (elBtnSearch) {
  elBtnSearch.onclick = runSearch;
}

if (elBtnClear) {
  elBtnClear.onclick = () => {
    elQ.value = "";
    selected = null;
    closeDropdown();
    hideBootOverlay(true);
    elResults.innerHTML = `<div class="card" style="opacity:.8;">No results yet. Run a search.</div>`;
  };
}

// ---------------- SEARCH ----------------
async function runSearch() {
  if (!initDone) {
    elResults.innerHTML = `<div class="card" style="opacity:.8;">Loading…</div>`;
    return;
  }

  const rawQuery = cleanQuery(elQ.value || "");
  if (!rawQuery) {
    hideBootOverlay(true);
    return;
  }

  logEventFireAndForget_({
    event_type: "search_submit",
    query: rawQuery,
    normalized_query: normalizeQuery_(rawQuery),
    search_kind: "product",
    selected_name: selected ? (selected.DisplayName || "") : "",
    selected_code: selected ? (selected.Code || "") : "",
    selected_type: "product",
    sport: selected ? (selected.sport || "") : "",
    year: selected ? (selected.year || "") : "",
    route_target: "vault",
    source: "button_or_enter"
  });

  if (!selected) {
    const best = findBestMatch(rawQuery);
    if (best) {
      selected = best;
      elQ.value = best.DisplayName;
      logSelectionFireAndForget_(selected);
    } else {
      logEventFireAndForget_({
        event_type: "search_results",
        query: rawQuery,
        normalized_query: normalizeQuery_(rawQuery),
        search_kind: "product",
        selected_name: "",
        selected_code: "",
        selected_type: "",
        sport: "",
        year: "",
        route_target: "vault",
        source: "results_load",
        result_count: 0,
        status: "error"
      });

      elResults.innerHTML = `<div class="card" style="opacity:.8;">No matching product found.</div>`;
      hideBootOverlay();
      return;
    }
  }

  elResults.innerHTML = `<div class="card" style="opacity:.8;">Loading…</div>`;

  try {
    const data = await api("getRowsByCode", { code: selected.Code });
    renderResults(data.meta, data.rows || []);

    logEventFireAndForget_({
      event_type: "product_view",
      query: rawQuery || (selected && selected.DisplayName) || "",
      normalized_query: normalizeQuery_(rawQuery || (selected && selected.DisplayName) || ""),
      search_kind: "product",
      selected_name: (data.meta && data.meta.displayName) || (selected && selected.DisplayName) || "",
      selected_code: selected ? (selected.Code || "") : "",
      selected_type: "product",
      sport: (data.meta && data.meta.sport) || (selected && selected.sport) || "",
      year: (data.meta && data.meta.year) || (selected && selected.year) || "",
      route_target: "vault",
      source: "results_load",
      result_count: Array.isArray(data.rows) ? data.rows.length : 0
    });
  } catch (e) {
    logEventFireAndForget_({
      event_type: "product_view",
      query: rawQuery || "",
      normalized_query: normalizeQuery_(rawQuery || ""),
      search_kind: "product",
      selected_name: selected ? (selected.DisplayName || "") : "",
      selected_code: selected ? (selected.Code || "") : "",
      selected_type: "product",
      sport: selected ? (selected.sport || "") : "",
      year: selected ? (selected.year || "") : "",
      route_target: "vault",
      source: "results_load",
      result_count: 0,
      status: "error"
    });

    elResults.innerHTML = `<div class="card" style="opacity:.8;">Error loading data.</div>`;
  } finally {
    hideBootOverlay();
  }
}

// ---------------- RENDER ----------------
function renderResults(meta, rows) {
  if (!rows.length) {
    elResults.innerHTML = `<div class="card" style="opacity:.8;">No print run rows found.</div>`;
    return;
  }

  const title = esc(meta?.displayName || selected?.DisplayName || "Results");
  const subParts = [meta?.year, meta?.sport, meta?.manufacturer].filter(Boolean).map(esc);
  const sub = subParts.join(" • ");

  elResults.innerHTML = `
    <div class="card">
      <div style="font-weight:800;margin-bottom:6px;">${title}</div>
      <div style="opacity:.75;font-size:13px;margin-bottom:10px;">${sub}</div>

      <table>
        <thead>
          <tr>
            <th>Set</th>
            <th>Subset</th>
            <th>Print Run</th>
            <th>Cards in Set</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${esc(r.setType || "")}</td>
              <td>${esc(r.setLine || "")}</td>
              <td>${fmtNum(r.printRun)}</td>
              <td>${fmtNum(r.subSetSize)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}
