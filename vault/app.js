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
const OVERLAY_MIN_MS = 0;
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
const URL_Q = new URLSearchParams(location.search).get("code") || new URLSearchParams(location.search).get("q") || "";
const URL_CODE = new URLSearchParams(location.search).get("code") || "";

// ---------------- STATE ----------------
let INDEX = [];
let selected = null;
let initDone = false;
let bootOverlayShownAt = window.__CM_SHOW_BOOT_OVERLAY__ ? Date.now() : 0;
let STATIC_MANIFEST = null;
const STATIC_CACHE = {};
let STRUCTURED_INDEX = null;
let searchGeneration = 0;
let activeProduct = null;
let visibleLimit = 60;

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
  else setTheme("light");
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
  return {
    softBg: "var(--bg2)",
    badgeBg: "var(--badgeBg)",
    badgeBorder: "var(--badgeBorder)",
    badgeText: "var(--badgeText)",
    subText: "var(--sub)",
    divider: "var(--line)"
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
      cache: "no-cache",
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
  if (!STATIC_CACHE[cacheKey]) {
    STATIC_CACHE[cacheKey] = fetchJsonWithTimeout_(url).catch(error => {
      delete STATIC_CACHE[cacheKey];
      throw error;
    });
  }
  return STATIC_CACHE[cacheKey];
}
async function loadStructuredIndex_() {
  await loadStaticManifest_();
  const index = await loadStaticJsonCached_("structured_index", "/data/v2/vault/index.json");
  if (index.schema_version !== 2 || index.source_revision !== STATIC_MANIFEST.vault_version) return null;
  STRUCTURED_INDEX = index;
  return index;
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
    cmURL: r.cmURL || r.cm_url || "",
    row_count: Number(r.row_count || 0),
    status: r.status || (Number(r.row_count || 0) ? 'ok' : 'empty')
  })).filter(r => r.Code && r.DisplayName);
}

function isEmptyProduct_(entry) {
  return !!entry && (entry.status === 'empty' || Number(entry.row_count || 0) === 0);
}

async function loadStaticVaultIndex_() {
  await loadStaticManifest_();
  try {
    const structured = await loadStructuredIndex_();
    if (structured) return normalizeIndexRows_(structured.index);
  } catch (e) { /* Legacy exports stay readable during refreshes. */ }
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
  try {
    const index = STRUCTURED_INDEX || await loadStructuredIndex_();
    const entry = index?.index.find(p => p.Code === code);
    if (entry) {
      const data = await loadStaticJsonCached_(`v2_${code}`, `/data/v2/vault/products/${encodeURIComponent(entry.file)}`);
      if (data.schema_version === 2 && data.source_revision === index.source_revision) return data;
    }
  } catch (e) { /* A newer source export may arrive before the derived view. */ }
  const bundle = await loadStaticJsonCached_("vault_bundle", `${STATIC_DATA_BASE}/vault/products/all.json`);
  let product = bundle.products?.[code];
  const file = bundle.product_map?.[code];
  if (!product && file) {
    const shard = await loadStaticJsonCached_(`shard_${file}`, `${STATIC_DATA_BASE}/vault/products/${encodeURIComponent(file)}`);
    product = shard.products?.[code];
  }
  return product ? VaultModel.product(product, code) : null;
}
async function getStaticPopSummary_(sport, code) {
  const sportKey = cleanQuery(sport).toLowerCase();
  if (!sportKey || !code) return null;
  const bundle = await loadStaticJsonCached_(`pop_${sportKey}`, `${STATIC_DATA_BASE}/vault/pop/${encodeURIComponent(sportKey)}.json`);
  const data = bundle.products?.[code];
  return data?.data || data || null;
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
    !isEmptyProduct_(i) && normalizeQuery_(i.DisplayName || "") === q
  );
  if (exactDisplay) return exactDisplay;

  const exactCode = INDEX.find(i =>
    !isEmptyProduct_(i) && normalizeQuery_(i.Code || "") === q
  );
  if (exactCode) return exactCode;

  const startsWithDisplay = INDEX.find(i =>
    !isEmptyProduct_(i) && normalizeQuery_(i.DisplayName || "").startsWith(q)
  );
  if (startsWithDisplay) return startsWithDisplay;

  const includesMatch = INDEX.find(i =>
    !isEmptyProduct_(i) && normalizeQuery_(`${i.DisplayName || ""} ${i.Keywords || ""} ${i.Code || ""}`).includes(q)
  );
  if (includesMatch) return includesMatch;

  return null;
}

function resolveByCode_(code) {
  const target = normalizeQuery_(code || "");
  if (!target || !INDEX.length) return null;
  return INDEX.find(i => normalizeQuery_(i.Code || "") === target) || null;
}

function renderSplitChoice_(query) {
  const split=STRUCTURED_INDEX?.aliases?.[query];
  if(!split)return false;
  const choices=split.products.map(code=>STRUCTURED_INDEX.index.find(p=>p.Code===code)).filter(Boolean);
  elResults.innerHTML=`<section class="card"><h2>Choose a product</h2>${choices.map(p=>`<p><a href="?code=${encodeURIComponent(p.Code)}">${esc(p.DisplayName)}</a></p>`).join('')}</section>`;
  hideBootOverlay(true);
  return true;
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

  if(renderSplitChoice_(incomingQuery))return;

  const best = (URL_CODE && resolveByCode_(URL_CODE)) || findBestMatch(incomingQuery);
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
  if (INDEX.length) runHomepageHandoffIfPresent();
  else elResults.innerHTML = '<div class="card" role="alert">The product list could not load. Reload to try again.</div>';
  injectScrollTopButton();
})();

// ---------------- DROPDOWN ----------------
function openDropdown(html) {
  elDD.innerHTML = html;
  elDD.style.display = "block";
  elQ.setAttribute("aria-expanded", "true");
}

function closeDropdown() {
  elQ.setAttribute("aria-expanded", "false");
  elQ.removeAttribute("aria-activedescendant");
  elDD.style.display = "none";
  elDD.innerHTML = "";
}

// ---------------- TYPEAHEAD ----------------
elQ.addEventListener("input", () => {
  const q = normalizeQuery_(elQ.value);
  searchGeneration++;
  selected = null;

  if (q.length < 2) {
    closeDropdown();
    return;
  }

  const hits = INDEX
    .filter(i => !isEmptyProduct_(i) && normalizeQuery_(`${i.DisplayName || ""} ${i.Keywords || ""} ${i.Code || ""}`).includes(q))
    .slice(0, 10);

  if (!hits.length) {
    closeDropdown();
    return;
  }

  openDropdown(hits.map(i => `
    <div class="ddItem" role="option" id="option-${esc(i.Code)}" data-code="${esc(i.Code)}">
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
  if (e.key === "Escape") closeDropdown();
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    const items = [...elDD.children];
    if (!items.length) return;
    e.preventDefault();
    const current = items.findIndex(n=>n.id===elQ.getAttribute('aria-activedescendant'));
    const next = (current + (e.key==='ArrowDown'?1:-1) + items.length) % items.length;
    items.forEach((n,i)=>n.classList.toggle('keyboardActive',i===next));
    elQ.setAttribute('aria-activedescendant',items[next].id);
    items[next].scrollIntoView({block:'nearest'});
  }
  if (e.key === "Enter") {
    e.preventDefault();
    const item = [...elDD.children].find(n=>n.id===elQ.getAttribute('aria-activedescendant'));
    if (item) item.click(); else runSearch();
  }
});

// ---------------- BUTTONS ----------------
if (elBtnSearch) {
  elBtnSearch.onclick = runSearch;
}

if (elBtnClear) {
  elBtnClear.onclick = () => {
    searchGeneration++;
    activeProduct = null;
    history.replaceState(null, "", location.pathname);
    elQ.value = "";
    selected = null;
    closeDropdown();
    hideBootOverlay(true);
    elResults.innerHTML = `<div class="card" style="opacity:.8;">No results yet. Run a search.</div>`;
  };
}

// ---------------- SEARCH ----------------
async function runSearch() {
  if (!initDone) return;
  const query = cleanQuery(elQ.value);
  if (!query) return;
  const generation = ++searchGeneration;
  if(renderSplitChoice_(query))return;
  const product = selected || findBestMatch(query);
  closeDropdown();
  if (!product) {
    elResults.innerHTML = '<div class="card">No matching product. Try a year and product name.</div>';
    hideBootOverlay(true);
    return;
  }
  selected = product;
  elQ.value = product.DisplayName;
  activeProduct = null;
  elResults.innerHTML = '<div class="card" role="status">Loading print runs…</div>';
  try {
    let data = await getStaticVaultProduct_(product.Code);
    if (!data) data = VaultModel.product(await api("getRowsByCode", {code:product.Code}),product.Code);
    if (generation !== searchGeneration) return;
    activeProduct = data;
    visibleLimit = 60;
    renderResults(data.meta, data.rows, null);
    history.replaceState(null, "", `?code=${encodeURIComponent(product.Code)}`);
    logEventFireAndForget_({event_type:"product_view",selected_code:product.Code,selected_name:product.DisplayName,result_count:data.rows.length});
  } catch (error) {
    if (generation === searchGeneration) elResults.innerHTML = '<div class="card" role="alert">Print runs could not load. Please try Search again.</div>';
  } finally {
    if (generation === searchGeneration) hideBootOverlay(true);
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
function renderResults(meta, rows) {
  if (!rows.length) {
    const cv = activeProduct && activeProduct.checklist;
    elResults.innerHTML = `
    <section class="card productHeader" role="status">
      <div class="eyebrow">${[meta.year,meta.sport,meta.manufacturer].filter(Boolean).map(esc).join(' · ')}</div>
      <h2>${esc(meta.displayName || (selected && selected.DisplayName) || "")}</h2>
      <h3>Data unavailable</h3>
      <p class="muted">Print-run data isn't available for this product yet.</p>
      ${cv ? `<div class="productStats"><a href="/checklists/?code=${encodeURIComponent(cv.code)}&sport=${encodeURIComponent(cv.sport)}&type=product">Open checklist ↗</a></div>` : ''}
    </section>`;
    return;
  }
  const categories = [...new Set(rows.map(r => r.category))].sort();
  const cv = activeProduct.checklist;
  elResults.innerHTML = `
    <section class="card productHeader">
      <div class="eyebrow">${[meta.year,meta.sport,meta.manufacturer].filter(Boolean).map(esc).join(' · ')}</div>
      <h2>${esc(meta.displayName || selected.DisplayName)}</h2>
      <div class="productStats"><span><strong>${rows.length}</strong> entries</span>
      ${cv ? `<a href="/checklists/?code=${encodeURIComponent(cv.code)}&sport=${encodeURIComponent(cv.sport)}&type=product">Open checklist ↗</a>` : ''}</div>
    </section>
    <section class="card entriesCard" aria-label="Print-run entries">
      <div class="entryTools">
        <label>Find an entry<input id="entryQuery" type="search" placeholder="Refractor, autograph, gold…"></label>
        <label>Category<select id="entryCategory"><option value="">All categories</option>${categories.map(c=>`<option>${esc(c)}</option>`).join('')}</select></label>
        <label>Sort<select id="entrySort"><option value="source">Default order</option><option value="low">Count: low to high</option><option value="name">Name: A–Z</option></select></label>
      </div>
      <div id="entryCount" class="muted" role="status"></div>
      <details class="entryLegend">
        <summary>What do these numbers mean?</summary>
        <dl>
          <dt>Print run</dt><dd>The estimated or reported number of copies produced. A qualifier (Reported, Estimated, At least, Up to, Average) says how firm that figure is. "No print-run estimate" means none is known.</dd>
          <dt>Numbered</dt><dd>The serial limit stamped on each card (e.g. /25) — a per-card ceiling, not a total of how many were made.</dd>
          <dt>Checklist cards</dt><dd>How many distinct cards make up this subset.</dd>
        </dl>
      </details>
      <div class="entryColumns" aria-hidden="true"><span title="Estimated or reported copies produced">Set / parallel</span><span title="Estimated or reported copies produced">Print run</span><span title="Serial limit stamped per card (e.g. /25) — a ceiling, not a total made">Numbered</span><span title="Distinct cards in this subset">Checklist cards</span></div>
      <div id="entryList"></div>
      <button id="showMore" class="clearBtn" type="button" hidden>Show more entries</button>
    </section>
    <details class="card" id="popDetails"><summary>Grading &amp; population insights</summary><div id="popInsightsCard"><p class="muted">Open to load grading data.</p></div></details>`;
  for (const id of ['entryQuery','entryCategory','entrySort']) document.getElementById(id).addEventListener(id==='entryQuery'?'input':'change',()=>{visibleLimit=60;renderEntries();});
  document.getElementById('showMore').onclick=()=>{visibleLimit+=60;renderEntries();};
  const generation = searchGeneration;
  const details = document.getElementById('popDetails');
  details.addEventListener('toggle',async()=>{
    if (!details.open || details.dataset.loaded) return;
    details.dataset.loaded='1';
    const target = document.getElementById('popInsightsCard');
    target.innerHTML='<p role="status">Loading grading data…</p>';
    try {
      const data = await getStaticPopSummary_(meta.sport || selected.sport,selected.Code);
      if (generation===searchGeneration) target.innerHTML=renderPopInsights(data);
    } catch {
      if (generation===searchGeneration) {target.innerHTML='<p>Grading data could not load. Close and reopen to retry.</p>';delete details.dataset.loaded;}
    }
  });
  renderEntries();
}
function renderEntries() {
  const query = document.getElementById('entryQuery').value.toLowerCase().trim();
  const category = document.getElementById('entryCategory').value;
  const sort = document.getElementById('entrySort').value;
  let rows = activeProduct.rows.filter(r=>(!category || r.category===category) && `${r.set_name} ${r.section}`.toLowerCase().includes(query));
  if (sort==='low') rows.sort((a,b)=>(a.measurement.value??Infinity)-(b.measurement.value??Infinity));
  if (sort==='name') rows.sort((a,b)=>a.set_name.localeCompare(b.set_name));
  const labels={estimate:'Estimated',average:'Average',lower_bound:'At least',upper_bound:'Up to',reported:'Reported',serial_limit:'Numbered',unknown:'Print run unknown'};
  document.getElementById('entryCount').textContent=`${rows.length ? Math.min(rows.length,visibleLimit) : 0} of ${rows.length} entries${category || query ? ' matching filters' : ''}`;
  document.getElementById('entryList').innerHTML=rows.slice(0,visibleLimit).map(r=>{
    const m=r.measurement;
    const numberedOnly=m.value===null&&r.serial_limit!==null;
    const qualifier=(numberedOnly?'No print-run estimate':labels[m.kind])+(m.scope==='per_card'?' · per card':'');
    const srNumber=m.value===null
      ? (numberedOnly?`No known print run; serial limit /${esc(r.serial_limit)}`:'Print run unknown')
      : `${qualifier} print run ${fmtNum(m.value)}`;
    return `<div class="entry"><div class="entryRow">
      <span class="entryName"><strong>${esc(r.set_name)}</strong><small>${esc(r.section || r.category)}</small></span>
      <span class="entryNumber"><span class="srOnly">${esc(srNumber)}</span><strong aria-hidden="true">${m.value===null?'—':fmtNum(m.value)}</strong><span class="entryQualifier" aria-hidden="true">${esc(qualifier)}</span></span>
      <span class="entrySerial"><span class="mobileLabel">Numbered </span>${r.serial_limit===null?'—':'/'+esc(r.serial_limit)}</span>
      <span class="entrySize"><span class="srOnly">Checklist cards: </span><span class="mobileLabel" aria-hidden="true">Checklist cards </span>${r.checklist_size===null?'—':fmtNum(r.checklist_size)}</span>
      </div></div>`;
  }).join('') || '<p class="emptyEntries">No entries match these filters.</p>';
  document.getElementById('showMore').hidden=rows.length<=visibleLimit;
}
