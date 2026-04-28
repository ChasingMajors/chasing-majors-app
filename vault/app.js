/* ================================
   Print Run Vault — app.js
   - Homepage search handoff support
   - Uses Checklist Vault theme system
   - Bottom nav handled in HTML
   - Master logger support
   - Boot overlay integration
   - Normalized query matching for homepage/trending links
   - POP Insights support
   - Jump to POP button
   - Scroll to top button
================================ */

// ---------------- CONFIG ----------------
const EXEC_URL = "https://script.google.com/macros/s/AKfycbz2GrNPpgls5Q2cwt8IkTGrtbged7J4pxIvec5F0r1JoTo-9m2OMkYvDFFz_MM0LEjOHA/exec";
const LOG_EXEC_URL = "https://script.google.com/macros/s/AKfycbyuTmGksD9ZF89Ij0VmnUeJqP0OcFL5qCe-MUjN0JonJ8QTlfpMsf0XRKZzCwLdFdiF/exec";
const STATIC_DATA_BASE = "/data/v1";
const INDEX_KEY = "prv_index_v1";
const INDEX_VER_KEY = "prv_index_ver_v1";
const THEME_KEY = "cm_theme";
const HANDOFF_FLAG_KEY = "cm_handoff_active";
const OVERLAY_MIN_MS = 1200;
const STATIC_FETCH_TIMEOUT_MS = 3500;

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
let STATIC_MANIFEST = null;
const STATIC_CACHE = {};

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

    if (selected && selected.Code) {
      runSearch();
    }
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

function fmtPct(value) {
  const s = String(value ?? "").trim();
  if (!s) return "—";
  return esc(s);
}

function fmtDateShort(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return esc(value);

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
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

function getThemeVars() {
  const isLight = document.documentElement.getAttribute("data-theme") === "light";

  return {
    subText: isLight ? "rgba(0,0,0,0.70)" : "rgba(255,255,255,0.78)",
    divider: isLight ? "rgba(0,0,0,0.10)" : "rgba(255,255,255,0.10)",
    badgeBg: isLight ? "rgba(0,0,0,0.04)" : "rgba(255,255,255,0.08)",
    badgeBorder: isLight ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.14)",
    badgeText: isLight ? "rgba(0,0,0,0.78)" : "rgba(255,255,255,0.86)",
    softBg: isLight ? "rgba(0,0,0,0.03)" : "rgba(255,255,255,0.04)"
  };
}

function safeJsonArray(value) {
  if (!value) return [];
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function calcMomentumLabel(currentVal, priorVal) {
  const current = Number(currentVal || 0);
  const prior = Number(priorVal || 0);

  if (!Number.isFinite(current) || !Number.isFinite(prior)) return "—";
  if (prior <= 0) return current > 0 ? "New" : "—";

  const pct = ((current / prior) - 1) * 100;
  const rounded = Math.round(pct);

  if (rounded > 0) return `+${rounded}%`;
  return `${rounded}%`;
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

// ---------------- STATIC DATA ----------------
// Static JSON is the fast path. The existing Apps Script calls remain as a
// fallback so the live app still works while data files are being deployed.
async function fetchJsonWithTimeout_(url, timeoutMs = STATIC_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "force-cache",
      signal: controller.signal
    });

    if (!res.ok) throw new Error(`Static file unavailable: ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function loadStaticManifest_() {
  if (STATIC_MANIFEST) return STATIC_MANIFEST;

  try {
    STATIC_MANIFEST = await fetchJsonWithTimeout_(`${STATIC_DATA_BASE}/manifest.json`);
  } catch (e) {
    STATIC_MANIFEST = { ok: false };
  }

  return STATIC_MANIFEST;
}

function staticVersion_(key, fallback = "") {
  const manifest = STATIC_MANIFEST || {};
  return String(manifest[key] || manifest.version || fallback || "");
}

async function loadStaticJsonCached_(cacheKey, url) {
  if (STATIC_CACHE[cacheKey]) return STATIC_CACHE[cacheKey];
  const data = await fetchJsonWithTimeout_(url);
  STATIC_CACHE[cacheKey] = data;
  return data;
}

function normalizeIndexRows_(rows) {
  return (Array.isArray(rows) ? rows : []).map(r => ({
    Code: r.Code || r.code || "",
    DisplayName: r.DisplayName || r.displayName || r.display_name || "",
    Keywords: r.Keywords || r.keywords || "",
    year: r.year || "",
    sport: r.sport || "",
    manufacturer: r.manufacturer || "",
    product: r.product || "",
    cmURL: r.cmURL || r.cm_url || ""
  })).filter(r => r.Code && r.DisplayName);
}

async function loadStaticVaultIndex_() {
  await loadStaticManifest_();
  const data = await loadStaticJsonCached_("vault_index", `${STATIC_DATA_BASE}/vault/index.json`);
  return normalizeIndexRows_(Array.isArray(data) ? data : (data.index || data.rows || []));
}

function normalizeVaultProduct_(data, code) {
  if (!data) return null;
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const meta = data.meta || {};

  if (!rows.length && !meta.displayName && !meta.DisplayName) return null;

  return {
    ok: true,
    meta: {
      code: meta.code || code || "",
      displayName: meta.displayName || meta.DisplayName || "",
      year: meta.year || "",
      sport: meta.sport || "",
      manufacturer: meta.manufacturer || "",
      product: meta.product || "",
      cmURL: meta.cmURL || meta.cm_url || ""
    },
    rows
  };
}

async function getStaticVaultProduct_(code) {
  if (!code) return null;

  try {
    const data = await loadStaticJsonCached_(
      `vault_product_${code}`,
      `${STATIC_DATA_BASE}/vault/products/${encodeURIComponent(code)}.json`
    );

    return normalizeVaultProduct_(data, code);
  } catch (perProductErr) {
    const bundle = await loadStaticJsonCached_(
      "vault_product_bundle_all",
      `${STATIC_DATA_BASE}/vault/products/all.json`
    );
    let product = bundle && bundle.products ? bundle.products[code] : null;

    if (!product && bundle && bundle.sharded && bundle.product_map && bundle.product_map[code]) {
      const shardFile = bundle.product_map[code];
      const shard = await loadStaticJsonCached_(
        `vault_product_shard_${shardFile}`,
        `${STATIC_DATA_BASE}/vault/products/${encodeURIComponent(shardFile)}`
      );
      product = shard && shard.products ? shard.products[code] : null;
    }

    return normalizeVaultProduct_(product, code);
  }
}

async function getStaticPopSummary_(sport, code) {
  const sportKey = cleanQuery(sport || "").toLowerCase();
  if (!sportKey || !code) return null;

  let data = null;

  try {
    data = await loadStaticJsonCached_(
      `vault_pop_${sportKey}_${code}`,
      `${STATIC_DATA_BASE}/vault/pop/${encodeURIComponent(sportKey)}/${encodeURIComponent(code)}.json`
    );
  } catch (perProductErr) {
    const bundle = await loadStaticJsonCached_(
      `vault_pop_bundle_${sportKey}`,
      `${STATIC_DATA_BASE}/vault/pop/${encodeURIComponent(sportKey)}.json`
    );
    data = bundle && bundle.products ? bundle.products[code] : null;
  }

  return data && data.data ? data.data : data;
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
    await loadStaticManifest_();
    const staticVer = staticVersion_("vault_version", "");

    if (staticVer && !forceRefresh && INDEX.length && localStorage.getItem(INDEX_VER_KEY) === staticVer) {
      return;
    }

    const staticIndex = await loadStaticVaultIndex_();
    if (staticIndex.length) {
      storeIndex_(staticIndex, staticVer || `static_${Date.now()}`);
      return;
    }
  } catch (e) {
    console.warn("Static vault index unavailable, using Apps Script fallback.", e);
  }

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
  injectScrollTopButton();
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
    let prvData = null;

    try {
      prvData = await getStaticVaultProduct_(selected.Code);
    } catch (staticErr) {
      prvData = null;
    }

    if (!prvData) {
      prvData = await api("getRowsByCode", { code: selected.Code });
    }

    let popData = null;
    try {
      popData = await getStaticPopSummary_(
        (prvData.meta && prvData.meta.sport) || selected.sport || "",
        selected.Code
      );
    } catch (popErr) {
      try {
        const popRes = await api("getPopSummary", {
          sport: (prvData.meta && prvData.meta.sport) || selected.sport || "",
          code: selected.Code
        });
        popData = popRes && popRes.data ? popRes.data : null;
      } catch (apiPopErr) {
        popData = null;
      }
    }

    renderResults(prvData.meta, prvData.rows || [], popData);

    logEventFireAndForget_({
      event_type: "product_view",
      query: rawQuery || (selected && selected.DisplayName) || "",
      normalized_query: normalizeQuery_(rawQuery || (selected && selected.DisplayName) || ""),
      search_kind: "product",
      selected_name: (prvData.meta && prvData.meta.displayName) || (selected && selected.DisplayName) || "",
      selected_code: selected ? (selected.Code || "") : "",
      selected_type: "product",
      sport: (prvData.meta && prvData.meta.sport) || (selected && selected.sport) || "",
      year: (prvData.meta && prvData.meta.year) || (selected && selected.year) || "",
      route_target: "vault",
      source: "results_load",
      result_count: Array.isArray(prvData.rows) ? prvData.rows.length : 0
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

// ---------------- POP RENDER HELPERS ----------------
function renderInsightMiniStat(label, value) {
  const vars = getThemeVars();

  return `
    <div style="
      border:1px solid ${vars.divider};
      border-radius:14px;
      padding:10px 12px;
      min-width:0;
      background:${vars.softBg};
    ">
      <div style="font-size:11px;letter-spacing:.4px;text-transform:uppercase;color:${vars.subText};margin-bottom:4px;">
        ${esc(label)}
      </div>
      <div style="font-size:18px;font-weight:800;line-height:1;">
        ${esc(value || "—")}
      </div>
    </div>
  `;
}

function renderTopList(title, items) {
  const vars = getThemeVars();
  const topItems = (items || []).slice(0, 5);

  if (!topItems.length) {
    return `
      <div style="
        border:1px solid ${vars.divider};
        border-radius:16px;
        padding:14px;
      ">
        <div style="font-weight:800;margin-bottom:8px;">${esc(title)}</div>
        <div style="color:${vars.subText};font-size:13px;">No data yet.</div>
      </div>
    `;
  }

  return `
    <div style="
      border:1px solid ${vars.divider};
      border-radius:16px;
      padding:14px;
    ">
      <div style="font-weight:800;margin-bottom:10px;">${esc(title)}</div>
      <div style="display:grid;gap:8px;">
        ${topItems.map((item, idx) => `
          <div style="
            display:flex;
            justify-content:space-between;
            gap:12px;
            align-items:flex-start;
            border-bottom:${idx === topItems.length - 1 ? "0" : `1px solid ${vars.divider}`};
            padding-bottom:${idx === topItems.length - 1 ? "0" : "8px"};
          ">
            <div style="font-size:14px;line-height:1.3;">${esc(item[0] || "—")}</div>
            <div style="
              flex:0 0 auto;
              padding:4px 8px;
              border-radius:999px;
              background:${vars.badgeBg};
              border:1px solid ${vars.badgeBorder};
              color:${vars.badgeText};
              font-size:12px;
              font-weight:700;
              white-space:nowrap;
            ">${fmtNum(item[1] || 0)}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderPopInsights(popData) {
  const vars = getThemeVars();

  if (!popData) {
    return `
      <div class="card">
        <div style="font-weight:800;margin-bottom:6px;">POP Insights</div>
        <div style="color:${vars.subText};font-size:13px;">No POP data available for this set yet.</div>
      </div>
    `;
  }

  const topPlayers = safeJsonArray(popData.top_players_json);
  const topParallels = safeJsonArray(popData.top_parallels_json);
  const momentumLabel = calcMomentumLabel(popData.graded_past_month, popData.graded_prior_month);
  const updatedLabel = fmtDateShort(popData.run_ts);

  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;margin-bottom:12px;">
        <div>
          <div style="font-weight:800;font-size:20px;line-height:1.15;margin-bottom:4px;">POP Insights</div>
          <div style="color:${vars.subText};font-size:13px;">How this set is grading right now.</div>
        </div>

        ${updatedLabel ? `
          <div style="
            display:inline-flex;
            align-items:center;
            justify-content:center;
            padding:6px 12px;
            border-radius:999px;
            font-size:13px;
            font-weight:700;
            background:${vars.badgeBg};
            border:1px solid ${vars.badgeBorder};
            color:${vars.badgeText};
            white-space:nowrap;
          ">Updated ${esc(updatedLabel)}</div>
        ` : ""}
      </div>

      <div style="
        display:grid;
        grid-template-columns:repeat(auto-fit,minmax(150px,1fr));
        gap:10px;
        margin-bottom:14px;
      ">
        ${renderInsightMiniStat("Total Graded", fmtNum(popData.total_graded))}
        ${renderInsightMiniStat("Gem Rate", fmtPct(popData.weighted_gem_rate))}
        ${renderInsightMiniStat("Graded Past Month", fmtNum(popData.graded_past_month))}
        ${renderInsightMiniStat("30 Day Momentum", momentumLabel)}
      </div>

      <div style="
        display:grid;
        grid-template-columns:repeat(auto-fit,minmax(260px,1fr));
        gap:12px;
      ">
        ${renderTopList("Top Graded Players", topPlayers)}
        ${renderTopList("Top Graded Parallels", topParallels)}
      </div>
    </div>
  `;
}

// ---------------- JUMP HELPERS ----------------
function bindPopJumpButton() {
  const btn = document.getElementById("jumpToPopBtn");
  const target = document.getElementById("popInsightsCard");
  if (!btn || !target) return;

  btn.addEventListener("click", () => {
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function injectScrollTopButton() {
  if (document.getElementById("cmScrollTopBtn")) return;

  const btn = document.createElement("button");
  btn.id = "cmScrollTopBtn";
  btn.type = "button";
  btn.setAttribute("aria-label", "Scroll to top");
  btn.innerHTML = "↑";

  btn.style.cssText = `
    position: fixed;
    right: 16px;
    bottom: 82px;
    width: 44px;
    height: 44px;
    border-radius: 999px;
    border: 1px solid rgba(255,255,255,0.18);
    background: rgba(255,255,255,0.92);
    color: #000;
    font-size: 22px;
    font-weight: 800;
    line-height: 1;
    display: none;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 10020;
    box-shadow: 0 10px 24px rgba(0,0,0,0.22);
  `;

  btn.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  document.body.appendChild(btn);

  const updateBtn = () => {
    const isLight = document.documentElement.getAttribute("data-theme") === "light";

    btn.style.display = window.scrollY > 500 ? "flex" : "none";
    btn.style.border = isLight ? "1px solid rgba(0,0,0,0.12)" : "1px solid rgba(255,255,255,0.18)";
    btn.style.background = isLight ? "rgba(17,17,17,0.92)" : "rgba(255,255,255,0.92)";
    btn.style.color = isLight ? "#fff" : "#000";
  };

  window.addEventListener("scroll", updateBtn, { passive: true });
  window.addEventListener("resize", updateBtn);
  updateBtn();
}

// ---------------- RENDER ----------------
function renderResults(meta, rows, popData) {
  if (!rows.length) {
    elResults.innerHTML = `<div class="card" style="opacity:.8;">No print run rows found.</div>`;
    return;
  }

  const vars = getThemeVars();
  const title = esc(meta?.displayName || selected?.DisplayName || "Results");
  const subParts = [meta?.year, meta?.sport, meta?.manufacturer].filter(Boolean).map(esc);
  const sub = subParts.join(" • ");
  const hasPop = !!popData;

  elResults.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;margin-bottom:6px;">
        <div>
          <div style="font-weight:800;margin-bottom:6px;">${title}</div>
          <div style="opacity:.75;font-size:13px;margin-bottom:6px;">${sub}</div>
          ${hasPop ? `
            <div style="color:${vars.subText};font-size:13px;">
              Includes grading trends and POP insights
            </div>
          ` : ``}
        </div>

        ${hasPop ? `
          <button
            type="button"
            id="jumpToPopBtn"
            style="
              border:1px solid ${vars.badgeBorder};
              background:${vars.badgeBg};
              color:${vars.badgeText};
              border-radius:999px;
              padding:8px 12px;
              font-size:13px;
              font-weight:700;
              cursor:pointer;
              white-space:nowrap;
            "
          >See POP Data</button>
        ` : ``}
      </div>

      <div style="
        border:1px solid ${vars.divider};
        border-radius:16px;
        overflow-x:auto;
      ">
        <table style="margin-top:0;">
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
    </div>

    <div id="popInsightsCard">
      ${renderPopInsights(popData)}
    </div>
  `;

  bindPopJumpButton();
}
