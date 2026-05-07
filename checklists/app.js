/* =========================================
   Checklist Vault — app.js
   Mirrors Print Run Vault UX
   Adds:
   - Sport picker
   - Instant local product autocomplete
   - Remote SearchIndex enrichment
   - Broader checklist search
   - Product section tabs
   - Base default view
   - Card No sorting
   - Subset grouping for Inserts/Autographs/Relics/Variations
   - Broad search paging
   - Parallels support from Google Sheets Parallels tab
   - Baseball hitter player stat card support
   - Homepage search handoff support
   - Master logger support
   - Boot overlay integration
   - Direct URL product routing via ?code=&sport=&type=
========================================= */

// ---------------- CONFIG ----------------

const EXEC_URL = "https://script.google.com/macros/s/AKfycbxVsOvACvcgwf8igVdlRcGVqTa0KciCO_w23GCHzVXp4dQrUE-4hx1Uut5o_KrCLXYL/exec";
const LOG_EXEC_URL = "https://script.google.com/macros/s/AKfycbyuTmGksD9ZF89Ij0VmnUeJqP0OcFL5qCe-MUjN0JonJ8QTlfpMsf0XRKZzCwLdFdiF/exec";
const STATIC_DATA_BASE = "/data/v1";

const INDEX_KEY = "cv_index_v2";
const INDEX_VER_KEY = "cv_index_ver_v2";
const THEME_KEY = "cm_theme";
const BROAD_PAGE_SIZE = 50;
const HANDOFF_FLAG_KEY = "cm_handoff_active";
const OVERLAY_MIN_MS = 1200;
const STATIC_FETCH_TIMEOUT_MS = 3500;
const STATIC_SPORTS = ["baseball", "basketball", "football", "hockey", "soccer"];

// ---------------- DOM ----------------
const elQ = document.getElementById("q");
const elDD = document.getElementById("dropdown");
const elResults = document.getElementById("results");
const elThemeBtn = document.getElementById("themeToggle");
const elSport = document.getElementById("sport");
const elBtnSearch = document.getElementById("btnSearch");
const elBtnClear = document.getElementById("btnClear");
const elBootOverlay = document.getElementById("cmBootOverlay");

// ---------------- STATE ----------------
let INDEX = [];
let selected = null;
let searchTimer = null;
let activeTypeaheadToken = 0;
let initDone = false;
let bootOverlayShownAt = window.__CM_SHOW_BOOT_OVERLAY__ ? Date.now() : 0;

const URL_PARAMS = new URLSearchParams(location.search);
const URL_Q = URL_PARAMS.get("q") || "";
const URL_CODE = URL_PARAMS.get("code") || "";
const URL_SPORT = URL_PARAMS.get("sport") || "";
const URL_TYPE = URL_PARAMS.get("type") || "";

let currentProductMeta = null;
let currentProductRows = [];
let currentProductParallels = [];
let currentProductTab = "Base";
let currentPlayerStats = null;
let STATIC_MANIFEST = null;
const STATIC_CACHE = {};
let MLB_PLAYER_TYPEAHEAD_CACHE = null;
let MLB_PLAYER_TYPEAHEAD_PROMISE = null;

let broadSearchState = {
  q: "",
  sport: "",
  page: 1,
  pageSize: BROAD_PAGE_SIZE,
  total: 0,
  totalPages: 0
};

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

    if (currentProductMeta && currentProductRows.length) {
      renderCurrentProductTab();
    } else if (broadSearchState.q) {
      runBroadSearch(
        broadSearchState.q,
        broadSearchState.sport,
        broadSearchState.page
      );
    }
  });
}

function scrollChecklistTop_() {
  const target = elResults && elResults.innerHTML.trim() ? elResults : document.body;
  const top = target === document.body
    ? 0
    : Math.max(0, target.getBoundingClientRect().top + window.pageYOffset - 14);

  window.scrollTo({ top, behavior: "smooth" });
}

function installFloatingTopButton_() {
  if (document.getElementById("cvTopButton")) return;

  const btn = document.createElement("button");
  btn.id = "cvTopButton";
  btn.type = "button";
  btn.textContent = "Top";
  btn.setAttribute("aria-label", "Back to top");
  btn.style.cssText = [
    "position:fixed",
    "right:16px",
    "bottom:82px",
    "z-index:9998",
    "border:1px solid rgba(255,255,255,0.18)",
    "background:rgba(20,20,20,0.92)",
    "color:#fff",
    "border-radius:999px",
    "padding:10px 14px",
    "font-size:13px",
    "font-weight:800",
    "box-shadow:0 10px 24px rgba(0,0,0,0.26)",
    "cursor:pointer",
    "display:none"
  ].join(";");

  btn.addEventListener("click", scrollChecklistTop_);
  document.body.appendChild(btn);

  window.addEventListener("scroll", () => {
    btn.style.display = window.scrollY > 520 ? "block" : "none";
  }, { passive: true });
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

function norm(s) {
  return String(s ?? "").trim();
}

function lower(s) {
  return norm(s).toLowerCase();
}

function fmtType(type) {
  const t = lower(type);
  if (!t) return "Result";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function getSportValue() {
  return elSport ? elSport.value : "";
}

function debounce(fn, wait = 80) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(fn, wait);
}

function setLoadingState(isLoading) {
  if (elBtnSearch) {
    elBtnSearch.disabled = !!isLoading;
    elBtnSearch.textContent = isLoading ? "Loading..." : "Search";
  }
}

function sortByDisplayPriority(items) {
  const typeRank = {
    search: 1,
    query: 1,
    player: 2,
    product: 3,
    team: 3,
    subset: 4,
    section: 5,
    tag: 6
  };

  return items.slice().sort((a, b) => {
    const aRank = typeRank[lower(a.type)] || 99;
    const bRank = typeRank[lower(b.type)] || 99;
    if (aRank !== bRank) return aRank - bRank;

    const aYear = Number(a.year) || 0;
    const bYear = Number(b.year) || 0;
    if (bYear !== aYear) return bYear - aYear;

    return String(a.term || a.displayName || "").localeCompare(String(b.term || b.displayName || ""));
  });
}

function getThemeVars() {
  const isLight = document.documentElement.getAttribute("data-theme") === "light";

  return {
    pillBg: isLight ? "rgba(0,0,0,0.04)" : "rgba(255,255,255,0.04)",
    pillBorder: isLight ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.12)",
    pillText: isLight ? "#0b0b0b" : "#ffffff",
    pillActiveBg: isLight ? "#111111" : "rgba(255,255,255,0.96)",
    pillActiveText: isLight ? "#ffffff" : "#000000",
    badgeBg: isLight ? "rgba(0,0,0,0.04)" : "rgba(255,255,255,0.08)",
    badgeBorder: isLight ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.14)",
    badgeText: isLight ? "rgba(0,0,0,0.78)" : "rgba(255,255,255,0.86)",
    subText: isLight ? "rgba(0,0,0,0.70)" : "rgba(255,255,255,0.78)",
    divider: isLight ? "rgba(0,0,0,0.10)" : "rgba(255,255,255,0.10)"
  };
}

function fmtUpdatedDate(value) {
  if (!value) return "";

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return esc(value);

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `Updated ${months[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}`;
}

function fmtBaseballRateStat(value) {
  const s = norm(value);
  if (!s) return "—";

  const n = Number(s);
  if (!Number.isFinite(n)) return s;

  const fixed = n.toFixed(3);
  if (n >= 1) return fixed;
  return fixed.replace(/^0/, "");
}

function toCardNoSortValue(v) {
  const s = norm(v);
  if (!s) return [2, "", ""];

  const n = Number(s);
  if (Number.isFinite(n)) return [0, n, s];

  const m = s.match(/^(\d+)(.*)$/);
  if (m) {
    return [1, Number(m[1]), s.toLowerCase()];
  }

  return [2, s.toLowerCase(), s.toLowerCase()];
}

function sortRowsByCardNo(rows) {
  return rows.slice().sort((a, b) => {
    const av = toCardNoSortValue(a.card_no);
    const bv = toCardNoSortValue(b.card_no);

    if (av[0] !== bv[0]) return av[0] - bv[0];
    if (av[1] < bv[1]) return -1;
    if (av[1] > bv[1]) return 1;

    const ap = lower(a.player);
    const bp = lower(b.player);
    if (ap < bp) return -1;
    if (ap > bp) return 1;

    return 0;
  });
}

function comparableYearValue_(value) {
  const raw = String(value || "");
  const m = raw.match(/\b(19|20)\d{2}\b/);
  return m ? (Number(m[0]) || 9999) : 9999;
}

function compareBroadSearchRows_(a, b) {
  const yearCompare = comparableYearValue_(a.year || a.displayName) - comparableYearValue_(b.year || b.displayName);
  if (yearCompare !== 0) return yearCompare;

  const productCompare = String(a.displayName || "").localeCompare(String(b.displayName || ""));
  if (productCompare !== 0) return productCompare;

  const subsetCompare = String(a.subset || "").localeCompare(String(b.subset || ""));
  if (subsetCompare !== 0) return subsetCompare;

  const cardCompare = toCardNoSortValue(a.card_no);
  const otherCardCompare = toCardNoSortValue(b.card_no);
  if (cardCompare[0] !== otherCardCompare[0]) return cardCompare[0] - otherCardCompare[0];
  if (cardCompare[1] < otherCardCompare[1]) return -1;
  if (cardCompare[1] > otherCardCompare[1]) return 1;

  return String(a.player || "").localeCompare(String(b.player || ""));
}

function dedupeSearchRows_(rows) {
  const seen = {};
  const out = [];

  (rows || []).forEach(row => {
    const key = [
      lower(row.sport),
      lower(row.code),
      lower(row.section),
      lower(row.subset),
      lower(row.card_no),
      lower(row.player),
      lower(row.team),
      lower(row.tag)
    ].join("||");

    if (seen[key]) return;
    seen[key] = true;
    out.push(row);
  });

  return out;
}

function normalizeSectionName(section) {
  return lower(section).replace(/\s+/g, " ").trim();
}

function getParallelSectionKeys(tabKey) {
  const t = lower(tabKey);

  if (t === "base") return ["base"];
  if (t === "inserts") return ["insert"];
  if (t === "autographs") return ["autograph", "auto relic"];
  if (t === "relics") return ["relic"];
  if (t === "variations") return ["variation"];

  return [t];
}

function getTabConfig() {
  return [
    {
      key: "Base",
      match: row => normalizeSectionName(row.section) === "base"
    },
    {
      key: "Inserts",
      match: row => normalizeSectionName(row.section) === "insert"
    },
    {
      key: "Autographs",
      match: row => {
        const s = normalizeSectionName(row.section);
        return s === "autograph" || s === "auto relic";
      }
    },
    {
      key: "Relics",
      match: row => normalizeSectionName(row.section) === "relic"
    },
    {
      key: "Variations",
      match: row => normalizeSectionName(row.section) === "variation"
    }
  ];
}

function getAvailableTabs(rows) {
  return getTabConfig()
    .filter(tab => rows.some(tab.match))
    .map(tab => ({ key: tab.key }));
}

function filterRowsForTab(rows, tabKey) {
  const tab = getTabConfig().find(t => t.key === tabKey);
  if (!tab) return [];
  return sortRowsByCardNo(rows.filter(tab.match));
}

function makeTagBubble(tag) {
  const t = norm(tag);
  if (!t) return "";

  const vars = getThemeVars();

  return `
    <span style="
      display:inline-flex;
      align-items:center;
      justify-content:center;
      padding:2px 8px;
      min-height:22px;
      border-radius:999px;
      font-size:12px;
      font-weight:700;
      line-height:1;
      background:${vars.badgeBg};
      border:1px solid ${vars.badgeBorder};
      color:${vars.badgeText};
      white-space:nowrap;
    ">${esc(t)}</span>
  `;
}

function normalizeSubsetName(subset, fallbackLabel) {
  const s = norm(subset);
  return s || fallbackLabel;
}

function groupRowsBySubset(rows, fallbackLabel) {
  const map = new Map();

  rows.forEach(row => {
    const subsetName = normalizeSubsetName(row.subset, fallbackLabel);
    if (!map.has(subsetName)) {
      map.set(subsetName, []);
    }
    map.get(subsetName).push(row);
  });

  const groups = Array.from(map.entries()).map(([subset, groupRows]) => ({
    subset,
    rows: sortRowsByCardNo(groupRows)
  }));

  groups.sort((a, b) => {
    const aIsBase = lower(a.subset) === "[base]" || lower(a.subset) === "base";
    const bIsBase = lower(b.subset) === "[base]" || lower(b.subset) === "base";

    if (aIsBase && !bIsBase) return -1;
    if (!aIsBase && bIsBase) return 1;

    return lower(a.subset).localeCompare(lower(b.subset));
  });

  return groups;
}

function getSerialSortValue(serialNo) {
  const s = norm(serialNo);
  if (!s) return null;

  const m = s.match(/\/\s*(\d+)/);
  if (!m) return null;

  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function sortParallels(parallels) {
  const nonSerial = [];
  const serial = [];

  parallels.forEach(p => {
    const serialVal = getSerialSortValue(p.serial_no);

    if (serialVal === null) {
      nonSerial.push(p);
    } else {
      serial.push({
        ...p,
        _serialVal: serialVal
      });
    }
  });

  nonSerial.sort((a, b) => lower(a.parallel_name).localeCompare(lower(b.parallel_name)));

  serial.sort((a, b) => {
    if (b._serialVal !== a._serialVal) return b._serialVal - a._serialVal;
    return lower(a.parallel_name).localeCompare(lower(b.parallel_name));
  });

  return [...nonSerial, ...serial];
}

function getParallelsForSectionSubset(section, subset) {
  const targetSections = Array.isArray(section)
    ? section.map(lower)
    : [lower(section)];
  const targetSubset = lower(subset);

  return currentProductParallels.filter(p => {
    const sec = lower(p.applies_to_section);
    const sub = lower(p.applies_to_subset);

    const secMatch = !sec || targetSections.includes(sec);
    const subsetMatch = !sub || sub === targetSubset;

    return secMatch && subsetMatch;
  });
}

function renderParallelsList(parallels) {
  if (!parallels || !parallels.length) return "";

  const sorted = sortParallels(parallels);

  return `
    <div style="margin-bottom:12px;">
      <div style="font-weight:700;margin-bottom:4px;">Parallels:</div>
      <ul style="margin:0;padding-left:18px;">
        ${sorted.map(p => `
          <li>
            ${esc(p.parallel_name)}
            ${p.serial_no ? ` ${esc(p.serial_no)}` : ""}
          </li>
        `).join("")}
      </ul>
    </div>
  `;
}

function renderMiniStat(label, value, extraClass = "") {
  const vars = getThemeVars();

  return `
    <div class="${extraClass}" style="
      border:1px solid ${vars.divider};
      border-radius:14px;
      padding:10px 12px;
      min-width:0;
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

function isPitcherPlayer_(player) {
  const t = lower(player && (player.player_type || player.playerType || player.position || ""));
  return t.includes("pitch");
}

function statValue_(group, keys, formatter) {
  const obj = group || {};
  for (let i = 0; i < keys.length; i++) {
    const value = obj[keys[i]];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return formatter ? formatter(value) : value;
    }
  }
  return "";
}

function renderPlayerStatGrid_(player, scope) {
  const group = player && player[scope] ? player[scope] : {};

  if (isPitcherPlayer_(player)) {
    return `
      ${renderMiniStat("ERA", statValue_(group, ["era"]))}
      ${renderMiniStat("SV", statValue_(group, ["sv", "saves"]), "desktopOnly")}
      ${renderMiniStat("IP", statValue_(group, ["ip", "inningsPitched"]))}
      ${renderMiniStat("SO", statValue_(group, ["so", "strikeOuts", "strikeouts"]))}
      ${renderMiniStat("WHIP", statValue_(group, ["whip"], fmtBaseballRateStat))}
    `;
  }

  return `
    ${renderMiniStat("H", statValue_(group, ["h", "hits"]))}
    ${renderMiniStat("HR", statValue_(group, ["hr", "homeRuns"]))}
    ${renderMiniStat("RBI", statValue_(group, ["rbi"]), "desktopOnly")}
    ${renderMiniStat("BA", statValue_(group, ["ba", "avg"], fmtBaseballRateStat))}
    ${renderMiniStat("OPS", statValue_(group, ["ops"], fmtBaseballRateStat))}
  `;
}

function renderPlayerStatsCard(player) {
  if (!player) return "";

  const vars = getThemeVars();

  return `
    <div class="card" style="margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;">
        <div>
          <div style="font-weight:800;font-size:20px;line-height:1.15;margin-bottom:4px;">${esc(player.player)}</div>
          <div style="color:${vars.subText};font-size:13px;">
            Baseball Player Snapshot
          </div>
        </div>

        <div class="playerUpdated" style="
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
        ">
          ${fmtUpdatedDate(player.updated_at)}
        </div>
      </div>

      <div style="margin-top:14px;">
        <div style="font-weight:700;margin-bottom:8px;">Current Season</div>
        <div class="playerStatsGrid" style="margin-bottom:16px;">
          ${renderPlayerStatGrid_(player, "season")}
        </div>

        <div style="font-weight:700;margin-bottom:8px;">Career</div>
        <div class="playerStatsGrid">
          ${renderPlayerStatGrid_(player, "career")}
        </div>
      </div>
    </div>
  `;
}

function findBestLocalProductMatch(query, sport) {
  const q = lower(query);
  if (!q || !INDEX.length) return null;

  const rows = INDEX.filter(i => !sport || lower(i.sport) === lower(sport));

  const exactDisplay = rows.find(i => lower(i.DisplayName) === q);
  if (exactDisplay) return exactDisplay;

  const exactCode = rows.find(i => lower(i.Code) === q);
  if (exactCode) return exactCode;

  const startsDisplay = rows.find(i => lower(i.DisplayName).startsWith(q));
  if (startsDisplay) return startsDisplay;

  const startsKeywords = rows.find(i => lower(i.Keywords).startsWith(q));
  if (startsKeywords) return startsKeywords;

  const includesAny = rows.find(i => {
    const hay = `${i.DisplayName} ${i.Keywords} ${i.Code}`.toLowerCase();
    return hay.includes(q);
  });
  if (includesAny) return includesAny;

  return null;
}

function findLocalProductByCode(code, sport) {
  const c = norm(code);
  if (!c || !INDEX.length) return null;

  const rows = INDEX.filter(i => !sport || lower(i.sport) === lower(sport));
  return rows.find(i => norm(i.Code) === c) || null;
}

function clearHomepageHandoff() {
  try {
    sessionStorage.removeItem("cm_home_search");
    sessionStorage.removeItem("cm_home_target");
    sessionStorage.removeItem(HANDOFF_FLAG_KEY);
  } catch (e) {}
}

function applyIncomingQueryToInput() {
  if (!elQ) return;

  const incomingCode = norm(URL_CODE);
  const incomingQ = norm(URL_Q);

  if (incomingQ) {
    elQ.value = incomingQ;
    return;
  }

  if (incomingCode) {
    elQ.value = incomingCode;
  }
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

function runHomepageHandoffIfPresent() {
  if (!initDone) return;

  const directCode = norm(URL_CODE);
  const directSport = norm(URL_SPORT);
  const directType = lower(URL_TYPE);

  if (directCode && (!directType || directType === "product")) {
    const bestByCode = findLocalProductByCode(directCode, directSport);

    if (bestByCode) {
      selected = {
        type: "product",
        code: bestByCode.Code,
        sport: bestByCode.sport,
        displayName: bestByCode.DisplayName,
        term: bestByCode.DisplayName,
        year: bestByCode.year
      };

      if (elQ) {
        elQ.value = bestByCode.DisplayName || directCode;
      }

      if (elSport && bestByCode.sport) {
        elSport.value = bestByCode.sport;
      }

      closeDropdown();
      runProductSearch(bestByCode.Code, bestByCode.sport).finally(clearHomepageHandoff);
      return;
    }

    if (elQ) {
      elQ.value = directCode;
    }

    if (elSport && directSport) {
      elSport.value = directSport;
    }

    closeDropdown();
    runProductSearch(directCode, directSport).finally(clearHomepageHandoff);
    return;
  }

  const urlQuery = norm(URL_Q);
  let savedQuery = "";
  let savedTarget = "";

  try {
    savedQuery = sessionStorage.getItem("cm_home_search") || "";
    savedTarget = sessionStorage.getItem("cm_home_target") || "";
  } catch (e) {}

  const incomingQuery = urlQuery || savedQuery;

  if (!incomingQuery) {
    setLoadingState(false);
    hideBootOverlay(true);
    return;
  }

  if (!elQ) {
    setLoadingState(false);
    hideBootOverlay(true);
    return;
  }

  if (!urlQuery && savedTarget && savedTarget !== "checklists") {
    setLoadingState(false);
    hideBootOverlay(true);
    return;
  }

  elQ.value = incomingQuery;
  closeDropdown();

  const sport = getSportValue() || directSport;
  const best = findBestLocalProductMatch(incomingQuery, sport);

  if (best) {
    selected = {
      type: "product",
      code: best.Code,
      sport: best.sport,
      displayName: best.DisplayName,
      term: best.DisplayName,
      year: best.year
    };

    if (elSport && best.sport) {
      elSport.value = best.sport;
    }

    runProductSearch(best.Code, best.sport).finally(clearHomepageHandoff);
    return;
  }

  runBroadSearch(incomingQuery, sport, 1).finally(clearHomepageHandoff);
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
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\u2019/g, "'")
    .replace(/[^\w\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function searchTokens_(value) {
  return normalizeQuery_(value)
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length >= 2);
}

function buildSearchHaystack_(parts) {
  return normalizeQuery_((parts || []).filter(Boolean).join(" "));
}

function scoreProductMatch_(query, item) {
  const needle = normalizeQuery_(query);
  if (!needle) return -1;

  const displayName = normalizeQuery_(item.DisplayName || item.displayName || item.term || "");
  const keywords = normalizeQuery_(item.Keywords || item.keywords || item.search_blob || "");
  const code = normalizeQuery_(item.Code || item.code || "");
  const product = normalizeQuery_(item.product || "");
  const manufacturer = normalizeQuery_(item.manufacturer || "");
  const sport = normalizeQuery_(item.sport || "");
  const year = normalizeQuery_(item.year || "");
  const hay = buildSearchHaystack_([displayName, keywords, code, product, manufacturer, sport, year]);
  const tokens = searchTokens_(needle);

  if (!hay || !tokens.length) return -1;
  if (displayName === needle || code === needle) return 10000;
  if (displayName.startsWith(needle) || code.startsWith(needle)) return 9000;
  if (hay.includes(needle)) return 8000 - Math.max(0, displayName.length - needle.length);
  if (!tokens.every(t => hay.includes(t))) return -1;

  let score = 5000;
  tokens.forEach(t => {
    if (displayName.includes(t)) score += 90;
    else if (keywords.includes(t)) score += 45;
    else if (code.includes(t)) score += 35;
    else score += 10;
  });

  if (year && tokens.some(t => year.includes(t))) score += 120;
  return score - Math.min(displayName.length, 300);
}

function stripYearTokens_(tokens) {
  return (tokens || []).filter(t => !/^(19|20)\d{2}$/.test(t) && !/^\d{2}$/.test(t));
}

function scorePlayerNameMatch_(query, playerName) {
  const score = scoreNameLikeMatch_(query, playerName);
  return score < 0 ? -1 : score + 800;
}

function editDistance_(a, b) {
  a = String(a || "");
  b = String(b || "");

  const al = a.length;
  const bl = b.length;
  if (!al) return bl;
  if (!bl) return al;

  const dp = [];
  for (let i = 0; i <= al; i++) dp[i] = [i];
  for (let j = 1; j <= bl; j++) dp[0][j] = j;

  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[al][bl];
}

function canFuzzyTokenMatch_(queryToken, nameToken) {
  const q = String(queryToken || "");
  const n = String(nameToken || "");
  if (!q || !n) return false;
  if (n.startsWith(q) || q.startsWith(n)) return true;

  const minLen = Math.min(q.length, n.length);
  const maxLen = Math.max(q.length, n.length);
  const dist = editDistance_(q, n.slice(0, q.length));

  if (minLen >= 4 && dist <= 1) return true;
  if (maxLen >= 7 && dist <= 2) return true;
  return false;
}

function scoreNameLikeMatch_(query, name) {
  const needle = normalizeQuery_(query);
  const normalizedName = normalizeQuery_(name);
  const qTokens = stripYearTokens_(searchTokens_(needle));
  const nameTokens = searchTokens_(normalizedName);

  if (!needle || !normalizedName || !qTokens.length || !nameTokens.length) return -1;
  if (normalizedName === needle) return 10000;
  if (normalizedName.startsWith(needle)) return 9200;
  if (normalizedName.includes(needle)) return 8200 - Math.max(0, normalizedName.length - needle.length);

  let score = 5200;
  for (const qt of qTokens) {
    const exact = nameTokens.includes(qt);
    const fuzzy = nameTokens.some(nt => canFuzzyTokenMatch_(qt, nt));
    if (exact) score += 140;
    else if (fuzzy) score += 80;
    else return -1;
  }

  return score - Math.min(normalizedName.length, 160);
}

function inferSearchKind_(value, selectedType) {
  const st = String(selectedType || "").trim().toLowerCase();
  if (st) return st;

  const q = String(value || "").trim();
  if (!q) return "";

  if (/^\d{4}/.test(q)) return "product";

  const words = q.split(/\s+/).filter(Boolean);
  if (words.length === 2 && /^[A-Za-z'.-]+$/.test(words[0]) && /^[A-Za-z'.-]+$/.test(words[1])) {
    return "player";
  }

  return "query";
}

function logEventFireAndForget_(payload) {
  const body = JSON.stringify({
    action: "logEvent",
    payload: Object.assign({
      app: "cv",
      page: "checklists",
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
// Static JSON is the fast path. Apps Script remains the fallback so live users
// are protected while data files are rolled out sport by sport.
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

async function fetchFreshJsonWithTimeout_(url, timeoutMs = STATIC_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const separator = url.includes("?") ? "&" : "?";
    const res = await fetch(`${url}${separator}ts=${Date.now()}`, {
      method: "GET",
      cache: "no-store",
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

function staticDataPathUrl_(path) {
  return String(path || "")
    .split("/")
    .map(part => encodeURIComponent(part))
    .join("/");
}

function normalizeIndexRows_(rows) {
  return (Array.isArray(rows) ? rows : []).map(r => ({
    Code: r.Code || r.code || "",
    DisplayName: r.DisplayName || r.displayName || r.display_name || "",
    Keywords: r.Keywords || r.keywords || "",
    year: r.year || "",
    sport: r.sport || "",
    manufacturer: r.manufacturer || "",
    product: r.product || ""
  })).filter(r => r.Code && r.DisplayName);
}

async function loadStaticChecklistIndex_() {
  await loadStaticManifest_();
  const data = await loadStaticJsonCached_("checklist_index", `${STATIC_DATA_BASE}/checklists/index.json`);
  return normalizeIndexRows_(Array.isArray(data) ? data : (data.index || data.rows || []));
}

function normalizeProductPayload_(data, code, sport) {
  if (!data) return null;
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const parallels = Array.isArray(data.parallels) ? data.parallels : [];
  const meta = data.meta || {};

  if (!rows.length && !meta.displayName && !meta.DisplayName) return null;

  return {
    ok: true,
    meta: {
      code: meta.code || code || "",
      displayName: meta.displayName || meta.DisplayName || "",
      year: meta.year || "",
      manufacturer: meta.manufacturer || "",
      product: meta.product || "",
      sport: meta.sport || sport || ""
    },
    rows,
    parallels
  };
}

async function getStaticChecklistProduct_(code, sport) {
  const sportKey = lower(sport || "");
  if (!code || !sportKey) return null;

  try {
    const url = `${STATIC_DATA_BASE}/checklists/products/${encodeURIComponent(sportKey)}/${encodeURIComponent(code)}.json`;
    const data = await loadStaticJsonCached_(`checklist_product_${sportKey}_${code}`, url);
    return normalizeProductPayload_(data, code, sportKey);
  } catch (perProductErr) {
    const bundle = await loadStaticJsonCached_(
      `checklist_product_bundle_${sportKey}`,
      `${STATIC_DATA_BASE}/checklists/products/${encodeURIComponent(sportKey)}.json`
    );
    let product = bundle && bundle.products ? bundle.products[code] : null;

    if (!product && bundle && bundle.sharded && bundle.product_map && bundle.product_map[code]) {
      const shardFile = bundle.product_map[code];
      const shard = await loadStaticJsonCached_(
        `checklist_product_shard_${sportKey}_${shardFile}`,
        `${STATIC_DATA_BASE}/checklists/products/${encodeURIComponent(shardFile)}`
      );
      product = shard && shard.products ? shard.products[code] : null;
    }

    return normalizeProductPayload_(product, code, sportKey);
  }
}

function normalizeSearchRows_(rows) {
  return (Array.isArray(rows) ? rows : []).map(r => ({
    term: r.term || r.displayName || r.display_name || r.player || "",
    type: r.type || "product",
    sport: r.sport || "",
    code: r.code || r.Code || "",
    displayName: r.displayName || r.DisplayName || r.display_name || "",
    year: r.year || "",
    manufacturer: r.manufacturer || "",
    product: r.product || "",
    section: r.section || "",
    subset: r.subset || "",
    card_no: r.card_no || r.cardNo || "",
    player: r.player || "",
    team: r.team || "",
    tag: r.tag || r.tags || "",
    search_blob: r.search_blob || r.searchBlob || ""
  }));
}

async function loadStaticChecklistSearchRows_(sport) {
  const sportKey = lower(sport || "all") || "all";

  if (sportKey === "all") {
    const rowGroups = await Promise.all(STATIC_SPORTS.map(s => loadStaticChecklistSearchRows_(s).catch(() => [])));
    return rowGroups.reduce((out, rows) => out.concat(rows), []);
  }

  const data = await loadStaticJsonCached_(
    `checklist_search_${sportKey}`,
    `${STATIC_DATA_BASE}/checklists/search-index/${encodeURIComponent(sportKey)}.json`
  ).catch(() => null);

  let primaryRows = [];

  if (data && data.sharded && Array.isArray(data.shards)) {
    const rowGroups = await Promise.all(data.shards.map(fileName => {
      return loadStaticJsonCached_(
        `checklist_search_shard_${fileName}`,
        `${STATIC_DATA_BASE}/checklists/search-index/${encodeURIComponent(fileName)}`
      ).then(shard => normalizeSearchRows_(shard.rows || []));
    }));
    primaryRows = rowGroups.reduce((out, rows) => out.concat(rows), []);
  } else {
    primaryRows = normalizeSearchRows_(data ? (Array.isArray(data) ? data : (data.results || data.rows || data.index || [])) : []);
  }

  const sourceRows = await loadStaticChecklistSourceSearchRows_(sportKey).catch(() => []);
  return primaryRows.concat(sourceRows);
}

async function loadStaticChecklistSourceSearchRows_(sportKey) {
  const registry = await loadStaticJsonCached_(
    "checklist_search_source_registry",
    `${STATIC_DATA_BASE}/checklists/search-index/sources.json`
  ).catch(() => null);

  const entries = registry && registry.sources && Array.isArray(registry.sources[sportKey])
    ? registry.sources[sportKey]
    : [];

  if (!entries.length) return [];

  const rowGroups = await Promise.all(entries.map(entry => {
    const manifestPath = norm(entry.path || "");
    if (!manifestPath) return Promise.resolve([]);

    return loadStaticJsonCached_(
      `checklist_search_source_${sportKey}_${manifestPath}`,
      `${STATIC_DATA_BASE}/checklists/search-index/${staticDataPathUrl_(manifestPath)}`
    ).then(manifest => {
      if (manifest && manifest.sharded && Array.isArray(manifest.shards)) {
        return Promise.all(manifest.shards.map(fileName => {
          const shardPath = "sources/" + fileName;
          return loadStaticJsonCached_(
            `checklist_search_source_shard_${sportKey}_${fileName}`,
            `${STATIC_DATA_BASE}/checklists/search-index/${staticDataPathUrl_(shardPath)}`
          ).then(shard => normalizeSearchRows_(shard.rows || []));
        })).then(groups => groups.reduce((out, rows) => out.concat(rows), []));
      }

      return normalizeSearchRows_(manifest ? (manifest.rows || []) : []);
    }).catch(() => []);
  }));

  return rowGroups.reduce((out, rows) => out.concat(rows), []);
}

function looksLikeHelpfulPlayerSuggestion_(query, row) {
  const player = norm(row && row.player);
  if (!player) return false;
  if (player.length > 60) return false;

  const playerLower = lower(player);
  const comboMarkers = [" / ", " & ", " and ", " with ", " vs ", " versus "];
  if (comboMarkers.some(marker => playerLower.includes(marker))) return false;

  const nameParts = player.replace(/[."']/g, "").split(/\s+/).filter(Boolean);
  if (nameParts.length < 2 || nameParts.length > 4) return false;

  return scoreNameLikeMatch_(query, player) >= 0;
}

async function makeChecklistPlayerTypeaheadHits_(q, sport, limit = 5) {
  const needle = normalizeQuery_(q);
  if (!needle || needle.length < 3) return [];

  const rows = await loadStaticChecklistSearchRows_(sport || "all");
  const seen = {};
  const hits = [];

  for (const row of rows) {
    if (!looksLikeHelpfulPlayerSuggestion_(needle, row)) continue;

    const key = [
      normalizeQuery_(row.player),
      normalizeQuery_(row.sport)
    ].join("||");

    if (seen[key]) continue;
    seen[key] = true;

    hits.push({
      term: row.player,
      type: "player",
      sport: row.sport || sport || "",
      code: "",
      displayName: row.player,
      year: "",
      player: row.player,
      _score: scoreNameLikeMatch_(needle, row.player)
    });

    if (hits.length >= limit * 3) break;
  }

  return hits
    .sort((a, b) => b._score - a._score)
    .slice(0, limit);
}

async function searchStaticTypeahead_(q, sport, limit = 10) {
  const needle = normalizeQuery_(q);
  if (!needle || needle.length < 2) return [];

  const rows = await loadStaticChecklistSearchRows_(sport || "all");
  return sortByDisplayPriority(rows
    .map(r => Object.assign({}, r, { _score: scoreProductMatch_(needle, r) }))
    .filter(r => r._score >= 0)
    .sort((a, b) => b._score - a._score)
  ).slice(0, limit);
}

async function searchStaticCards_(q, sport, page = 1, pageSize = BROAD_PAGE_SIZE) {
  const tokens = normalizeQuery_(q).split(/\s+/).filter(Boolean);
  if (!tokens.length) {
    return { ok: true, results: [], total: 0, page: 1, pageSize, totalPages: 0 };
  }

  const rows = await loadStaticChecklistSearchRows_(sport || "all");
  const filtered = dedupeSearchRows_(rows.filter(r => {
    if (sport && lower(r.sport) !== lower(sport)) return false;
    const hay = lower(`${r.displayName} ${r.product} ${r.section} ${r.subset} ${r.card_no} ${r.player} ${r.team} ${r.tag} ${r.search_blob}`);
    return tokens.every(t => hay.includes(t));
  })).sort(compareBroadSearchRows_);

  const total = filtered.length;
  const totalPages = total ? Math.ceil(total / pageSize) : 0;
  const safePage = totalPages ? Math.min(Math.max(1, Number(page) || 1), totalPages) : 1;
  const start = (safePage - 1) * pageSize;

  return {
    ok: true,
    results: filtered.slice(start, start + pageSize),
    total,
    page: safePage,
    pageSize,
    totalPages
  };
}

function normalizeStaticPlayer_(r) {
  if (!r) return null;
  return {
    player: r.player || r.fullName || r.full_name || "",
    url: r.url || "",
    sport: "baseball",
    player_type: r.player_type || r.playerType || "hitter",
    season: r.season || {
      h: r.season_h || r.h || "",
      hr: r.season_hr || r.hr || "",
      rbi: r.season_rbi || r.rbi || "",
      ba: r.season_ba || r.avg || r.ba || "",
      ops: r.season_ops || r.ops || "",
      era: r.season_era || r.era || "",
      sv: r.season_sv || r.sv || r.saves || "",
      ip: r.season_ip || r.ip || r.inningsPitched || "",
      so: r.season_so || r.so || r.strikeOuts || "",
      whip: r.season_whip || r.whip || ""
    },
    career: r.career || {
      h: r.career_h || "",
      hr: r.career_hr || "",
      rbi: r.career_rbi || "",
      ba: r.career_ba || "",
      ops: r.career_ops || "",
      era: r.career_era || "",
      sv: r.career_sv || "",
      ip: r.career_ip || "",
      so: r.career_so || "",
      whip: r.career_whip || ""
    },
    updated_at: r.updated_at || r.updatedAt || ""
  };
}

async function getStaticPlayerStats_(q, sport) {
  if (sport && lower(sport) !== "baseball") return { found: false };

  const needle = normalizeQuery_(q);
  if (!needle) return { found: false };

  const data = await fetchFreshJsonWithTimeout_(`${STATIC_DATA_BASE}/players/mlb-stats.json`);
  const rows = Array.isArray(data) ? data : (data.players || data.rows || []);
  const hit = rows
    .map(r => Object.assign({}, r, {
      _score: scorePlayerNameMatch_(needle, r.player || r.fullName || r.full_name || "")
    }))
    .filter(r => r._score >= 0)
    .sort((a, b) => b._score - a._score)[0];

  return hit ? { found: true, player: normalizeStaticPlayer_(hit) } : { found: false };
}

async function loadMlbPlayerTypeaheadRows_() {
  if (MLB_PLAYER_TYPEAHEAD_CACHE) return MLB_PLAYER_TYPEAHEAD_CACHE;
  if (MLB_PLAYER_TYPEAHEAD_PROMISE) return MLB_PLAYER_TYPEAHEAD_PROMISE;

  MLB_PLAYER_TYPEAHEAD_PROMISE = fetchFreshJsonWithTimeout_(`${STATIC_DATA_BASE}/players/mlb-stats.json`)
    .then(data => {
      const rows = Array.isArray(data) ? data : (data.players || data.rows || []);
      const seen = {};

      MLB_PLAYER_TYPEAHEAD_CACHE = rows
        .map(normalizeStaticPlayer_)
        .filter(player => player && player.player)
        .filter(player => {
          const key = normalizeQuery_(player.player);
          if (!key || seen[key]) return false;
          seen[key] = true;
          return true;
        });

      return MLB_PLAYER_TYPEAHEAD_CACHE;
    })
    .catch(err => {
      MLB_PLAYER_TYPEAHEAD_PROMISE = null;
      throw err;
    });

  return MLB_PLAYER_TYPEAHEAD_PROMISE;
}

async function makeMlbPlayerTypeaheadHits_(q, sport, limit = 4) {
  if (sport && lower(sport) !== "baseball") return [];

  const needle = normalizeQuery_(q);
  if (!needle || needle.length < 2) return [];

  const players = await loadMlbPlayerTypeaheadRows_();
  return players
    .map(player => ({
      term: player.player,
      type: "player",
      sport: "baseball",
      code: "",
      displayName: player.player,
      year: "",
      player: player.player,
      _score: scorePlayerNameMatch_(needle, player.player)
    }))
    .filter(item => item._score >= 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, limit);
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
    const staticVer = staticVersion_("checklists_version", "");

    if (staticVer && !forceRefresh && INDEX.length && localStorage.getItem(INDEX_VER_KEY) === staticVer) {
      return;
    }

    const staticIndex = await loadStaticChecklistIndex_();
    if (staticIndex.length) {
      storeIndex_(staticIndex, staticVer || `static_${Date.now()}`);
      return;
    }
  } catch (e) {
    console.warn("Static checklist index unavailable, using Apps Script fallback.", e);
  }

  try {
    const meta = await api("meta");
    const remoteVer = meta && meta.ok ? String(meta.indexVersion || "") : "";
    const localVer = localStorage.getItem(INDEX_VER_KEY) || "";

    if (forceRefresh || !INDEX.length || (remoteVer && remoteVer !== localVer)) {
      const d = await api("index");
      const fresh = (d && d.ok && Array.isArray(d.index)) ? d.index : [];
      storeIndex_(fresh, remoteVer || localVer);
    }
  } catch (e) {
    console.warn("Index freshness check failed, using cache.", e);
  }
}

// ---------------- INIT ----------------
(async function init() {
  loadTheme();
  installFloatingTopButton_();
  applyIncomingQueryToInput();

  const hasDirectProductHandoff = !!(URL_CODE && URL_SPORT && lower(URL_TYPE) === "product");

  if (hasDirectProductHandoff) {
    initDone = true;

    selected = {
      type: "product",
      code: URL_CODE,
      sport: URL_SPORT,
      displayName: URL_Q || URL_CODE,
      term: URL_Q || URL_CODE,
      year: ""
    };

    if (elSport && URL_SPORT) {
      elSport.value = URL_SPORT;
    }

    runProductSearch(URL_CODE, URL_SPORT)
      .finally(clearHomepageHandoff);

    ensureFreshIndex_().catch(() => {});
    return;
  }

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

function dropdownItemHtml(item) {
  const type = lower(item.type || "product");
  const typeLabel = type === "search" || type === "query"
    ? "Search"
    : fmtType(item.type || "product");

  return `
    <div class="ddItem"
         data-code="${esc(item.code || "")}"
         data-sport="${esc(item.sport || "")}"
         data-type="${esc(item.type || "product")}"
         data-term="${esc(item.term || item.displayName || "")}">
      <div class="ddTitle">${esc(item.term || item.displayName || "")}</div>
      <div class="ddMeta">
        ${esc(typeLabel)}
        ${item.sport ? ` • ${esc(item.sport)}` : ""}
        ${item.displayName && lower(item.term) !== lower(item.displayName) ? ` • ${esc(item.displayName)}` : ""}
      </div>
    </div>
  `;
}

function makeExactSearchSuggestion_(q, sport) {
  const term = norm(q);
  if (!term || term.length < 2) return null;

  return {
    term: `Search for "${term}"`,
    searchTerm: term,
    type: "search",
    sport: sport || "",
    code: "",
    displayName: term,
    year: "",
    _score: 99999
  };
}

function bindDropdownItems(items) {
  [...elDD.children].forEach((node, idx) => {
    node.onclick = async () => {
      const item = items[idx];
      if (!item) return;

      selected = item;
      elQ.value = item.term || item.displayName || "";
      closeDropdown();

      if (lower(item.type) === "product" && item.code) {
        logSelectionFireAndForget_({
          DisplayName: item.displayName || item.term || "",
          year: item.year || "",
          sport: item.sport || "",
          code: item.code || "",
          type: item.type || "product",
          term: item.term || item.displayName || ""
        });

        if (elSport && item.sport) {
          elSport.value = item.sport;
        }

        await runProductSearch(item.code, item.sport);
      } else {
        logEventFireAndForget_({
          event_type: "typeahead_select",
          query: item.term || item.displayName || elQ.value || "",
          normalized_query: normalizeQuery_(item.term || item.displayName || elQ.value || ""),
          search_kind: lower(item.type || inferSearchKind_(item.term || item.displayName || "")),
          selected_name: item.term || item.displayName || "",
          selected_code: item.code || "",
          selected_type: item.type || "",
          sport: item.sport || getSportValue() || "",
          year: item.year || "",
          route_target: "checklists",
          source: "dropdown"
        });

        if (elSport && item.sport) {
          elSport.value = item.sport;
        }

        await runBroadSearch(item.searchTerm || item.displayName || item.term || elQ.value, item.sport || getSportValue(), 1);
      }
    };
  });
}

function renderDropdownItems(items) {
  if (!items || !items.length) {
    closeDropdown();
    return;
  }

  const sorted = sortByDisplayPriority(items);
  openDropdown(sorted.map(dropdownItemHtml).join(""));
  bindDropdownItems(sorted);
}

// ---------------- LOGGING ----------------
function logSelectionFireAndForget_(sel) {
  if (!sel) return;

  logEventFireAndForget_({
    event_type: "typeahead_select",
    query: sel.term || sel.DisplayName || sel.displayName || "",
    normalized_query: normalizeQuery_(sel.term || sel.DisplayName || sel.displayName || ""),
    search_kind: lower(sel.type || "product"),
    selected_name: sel.DisplayName || sel.displayName || sel.term || "",
    selected_code: sel.code || "",
    selected_type: sel.type || "product",
    sport: sel.sport || "",
    year: sel.year || "",
    route_target: "checklists",
    source: "dropdown"
  });
}

// ---------------- LOCAL TYPEAHEAD ----------------
function dedupeTypeaheadResults(rows) {
  const seen = {};
  const out = [];

  rows.forEach(r => {
    const key = [
      lower(r.type),
      lower(r.sport),
      lower(r.code),
      lower(r.term)
    ].join("||");

    if (seen[key]) return;
    seen[key] = true;
    out.push(r);
  });

  return out;
}

function prioritizeTypeaheadResults_(rows, limit = 10) {
  return sortByDisplayPriority(dedupeTypeaheadResults(rows || []))
    .sort((a, b) => {
      if (lower(a.type) === "search" && lower(b.type) !== "search") return -1;
      if (lower(b.type) === "search" && lower(a.type) !== "search") return 1;
      const aScore = Number(a._score) || 0;
      const bScore = Number(b._score) || 0;
      if (bScore !== aScore) return bScore - aScore;
      return String(a.term || a.displayName || "").localeCompare(String(b.term || b.displayName || ""));
    })
    .slice(0, limit);
}

function makeProductHitsFromLocalIndex(q, sport, limit = 8) {
  const needle = normalizeQuery_(q);
  if (!needle || needle.length < 2) return [];

  let rows = INDEX.slice();

  if (sport) {
    rows = rows.filter(r => normalizeQuery_(r.sport) === normalizeQuery_(sport));
  }

  return dedupeTypeaheadResults(rows
    .map(r => ({
      term: r.DisplayName,
      type: "product",
      sport: r.sport,
      code: r.Code,
      displayName: r.DisplayName,
      year: r.year,
      manufacturer: r.manufacturer,
      product: r.product,
      Keywords: r.Keywords,
      _score: scoreProductMatch_(needle, r)
    }))
    .filter(r => r._score >= 0)
    .sort((a, b) => b._score - a._score)
  ).slice(0, limit);
}

function mergeTypeaheadResults(localHits, remoteHits, limit = 10) {
  return prioritizeTypeaheadResults_([...(localHits || []), ...(remoteHits || [])], limit);
}

// ---------------- FAST AUTOCOMPLETE ----------------
async function runTypeahead() {
  const token = ++activeTypeaheadToken;
  const q = norm(elQ.value);
  const sport = getSportValue();
  selected = null;

  if (q.length < 2) {
    closeDropdown();
    return;
  }

  const exactHit = makeExactSearchSuggestion_(q, sport);
  const localHits = [
    ...(exactHit ? [exactHit] : []),
    ...makeProductHitsFromLocalIndex(q, sport, 6)
  ];
  renderDropdownItems(prioritizeTypeaheadResults_(localHits, 10));

  try {
    const [mlbPlayerHits, checklistPlayerHits] = await Promise.all([
      makeMlbPlayerTypeaheadHits_(q, sport, 4).catch(() => []),
      makeChecklistPlayerTypeaheadHits_(q, sport, 5).catch(() => [])
    ]);

    if (token !== activeTypeaheadToken) return;

    const merged = mergeTypeaheadResults(localHits, [...mlbPlayerHits, ...checklistPlayerHits], 10);

    renderDropdownItems(merged);
  } catch (e) {
    console.warn("Player typeahead enrichment failed; local suggestions still shown.", e);
  }
}

elQ.addEventListener("input", () => {
  debounce(() => {
    runTypeahead();
  }, 140);
});

document.addEventListener("click", (e) => {
  const inSearch = e.target.closest(".searchWrap") || e.target.closest("#dropdown");
  if (!inSearch) closeDropdown();
});

elQ.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    closeDropdown();
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
    currentProductMeta = null;
    currentProductRows = [];
    currentProductParallels = [];
    currentProductTab = "Base";
    currentPlayerStats = null;
    broadSearchState = {
      q: "",
      sport: "",
      page: 1,
      pageSize: BROAD_PAGE_SIZE,
      total: 0,
      totalPages: 0
    };
    closeDropdown();
    setLoadingState(false);
    hideBootOverlay(true);
    elResults.innerHTML = `<div class="card" style="opacity:.8;">No results yet. Run a search.</div>`;
  };
}

if (elSport) {
  elSport.addEventListener("change", () => {
    selected = null;
    closeDropdown();
    if (norm(elQ.value).length >= 2) {
      runTypeahead();
    }
  });
}

// ---------------- SEARCH ROUTER ----------------
async function runSearch() {
  if (!initDone) {
    elResults.innerHTML = `<div class="card" style="opacity:.8;">Loading…</div>`;
    return;
  }

  const q = norm(elQ.value);
  const sport = getSportValue();

  if (!q) {
    setLoadingState(false);
    hideBootOverlay(true);
    return;
  }

  logEventFireAndForget_({
    event_type: "search_submit",
    query: q,
    normalized_query: normalizeQuery_(q),
    search_kind: inferSearchKind_(q, selected && selected.type),
    selected_name: selected ? (selected.displayName || selected.term || "") : "",
    selected_code: selected ? (selected.code || "") : "",
    selected_type: selected ? (selected.type || "") : "",
    sport: sport || "",
    year: selected ? (selected.year || "") : "",
    route_target: "checklists",
    source: "button_or_enter"
  });

  if (selected && lower(selected.type) === "product" && selected.code) {
    if (elSport && selected.sport) {
      elSport.value = selected.sport;
    }
    await runProductSearch(selected.code, selected.sport || sport);
    return;
  }

  const localMatch = findBestLocalProductMatch(q, sport);

  if (localMatch) {
    selected = {
      type: "product",
      code: localMatch.Code,
      sport: localMatch.sport,
      displayName: localMatch.DisplayName,
      term: localMatch.DisplayName,
      year: localMatch.year
    };

    logSelectionFireAndForget_({
      DisplayName: localMatch.DisplayName || "",
      year: localMatch.year || "",
      sport: localMatch.sport || "",
      code: localMatch.Code || "",
      type: "product",
      term: localMatch.DisplayName || ""
    });

    if (elSport && localMatch.sport) {
      elSport.value = localMatch.sport;
    }

    await runProductSearch(localMatch.Code, localMatch.sport);
    return;
  }

  await runBroadSearch(q, sport, 1);
}

// ---------------- PRODUCT SEARCH ----------------
async function runProductSearch(code, sport) {
  currentProductMeta = null;
  currentProductRows = [];
  currentProductParallels = [];
  currentPlayerStats = null;
  broadSearchState = {
    q: "",
    sport: "",
    page: 1,
    pageSize: BROAD_PAGE_SIZE,
    total: 0,
    totalPages: 0
  };

  const handoffQuery = norm(URL_Q) || norm(elQ ? elQ.value : "") || norm(code);
  setLoadingState(true);
  elResults.innerHTML = `<div class="card" style="opacity:.8;">Searching for "${esc(handoffQuery || "your query")}"…</div>`;

  try {
    let data = null;

    try {
      data = await getStaticChecklistProduct_(code, sport);
    } catch (staticErr) {
      data = null;
    }

    if (!data) {
      data = await api("getRowsByCode", { code, sport });
    }

    currentProductMeta = data.meta || null;
    currentProductRows = Array.isArray(data.rows) ? data.rows : [];
    currentProductParallels = Array.isArray(data.parallels) ? data.parallels : [];

    const resolvedSport = sport || (currentProductMeta && currentProductMeta.sport) || "";
    const resolvedName = (currentProductMeta && currentProductMeta.displayName) || handoffQuery || code || "";

    if (elSport && resolvedSport) {
      elSport.value = resolvedSport;
    }

    if (elQ && resolvedName) {
      elQ.value = resolvedName;
    }

    logEventFireAndForget_({
      event_type: "product_view",
      query: resolvedName,
      normalized_query: normalizeQuery_(resolvedName),
      search_kind: "product",
      selected_name: resolvedName,
      selected_code: code || "",
      selected_type: "product",
      sport: resolvedSport,
      year: (currentProductMeta && currentProductMeta.year) || "",
      route_target: "checklists",
      source: "results_load",
      result_count: currentProductRows.length || 0
    });

    const availableTabs = getAvailableTabs(currentProductRows);
    if (availableTabs.some(t => t.key === "Base")) {
      currentProductTab = "Base";
    } else if (availableTabs.length) {
      currentProductTab = availableTabs[0].key;
    } else {
      currentProductTab = "Base";
    }

    renderCurrentProductTab();
  } catch (e) {
    console.error("runProductSearch error:", e);

    logEventFireAndForget_({
      event_type: "product_view",
      query: handoffQuery || "",
      normalized_query: normalizeQuery_(handoffQuery || ""),
      search_kind: "product",
      selected_name: "",
      selected_code: code || "",
      selected_type: "product",
      sport: sport || "",
      year: "",
      route_target: "checklists",
      source: "results_load",
      result_count: 0,
      status: "error"
    });

    elResults.innerHTML = `<div class="card" style="opacity:.8;">Error loading checklist data: ${esc(e?.message || String(e))}</div>`;
  } finally {
    setLoadingState(false);
    hideBootOverlay();
  }
}

// ---------------- BROADER SEARCH ----------------
async function runBroadSearch(q, sport, page = 1) {
  currentProductMeta = null;
  currentProductRows = [];
  currentProductParallels = [];
  currentProductTab = "Base";
  currentPlayerStats = null;

  broadSearchState.q = q;
  broadSearchState.sport = sport || "";
  broadSearchState.page = page;
  broadSearchState.pageSize = BROAD_PAGE_SIZE;

  setLoadingState(true);
  elResults.innerHTML = `<div class="card" style="opacity:.8;">Searching for "${esc(q)}"…</div>`;

  try {
    const cardsPromise = searchStaticCards_(q, sport, page, BROAD_PAGE_SIZE)
      .catch(() => api("searchCards", {
        q,
        sport,
        limit: BROAD_PAGE_SIZE,
        page
      }));

    const playerPromise = getStaticPlayerStats_(q, sport)
      .catch(() => api("getPlayerStats", {
        q,
        sport
      }).catch(() => ({ found: false })));

    const [cardsData, playerData] = await Promise.all([cardsPromise, playerPromise]);

    broadSearchState.total = Number(cardsData.total) || 0;
    broadSearchState.totalPages = Number(cardsData.totalPages) || 0;
    broadSearchState.page = Number(cardsData.page) || 1;
    broadSearchState.pageSize = Number(cardsData.pageSize) || BROAD_PAGE_SIZE;

    currentPlayerStats = playerData && playerData.found ? playerData.player : null;

    logEventFireAndForget_({
      event_type: "search_results",
      query: q,
      normalized_query: normalizeQuery_(q),
      search_kind: currentPlayerStats ? "player" : inferSearchKind_(q),
      selected_name: currentPlayerStats ? (currentPlayerStats.player || "") : "",
      selected_code: "",
      selected_type: currentPlayerStats ? "player" : "",
      sport: sport || "",
      year: "",
      route_target: "checklists",
      source: page > 1 ? "paging" : "results_load",
      result_count: Number(cardsData.total) || 0,
      page_number: Number(cardsData.page) || 1
    });

    renderBroadResults(q, cardsData.results || [], sport, {
      total: broadSearchState.total,
      page: broadSearchState.page,
      pageSize: broadSearchState.pageSize,
      totalPages: broadSearchState.totalPages
    });
  } catch (e) {
    console.error("runBroadSearch error:", e);

    logEventFireAndForget_({
      event_type: "search_results",
      query: q,
      normalized_query: normalizeQuery_(q),
      search_kind: inferSearchKind_(q),
      selected_name: "",
      selected_code: "",
      selected_type: "",
      sport: sport || "",
      year: "",
      route_target: "checklists",
      source: page > 1 ? "paging" : "results_load",
      result_count: 0,
      page_number: page || 1,
      status: "error"
    });

    elResults.innerHTML = `<div class="card" style="opacity:.8;">Error loading search results: ${esc(e?.message || String(e))}</div>`;
  } finally {
    setLoadingState(false);
    hideBootOverlay();
  }
}

// ---------------- PRODUCT TAB RENDERING ----------------
function renderCurrentProductTab() {
  if (!currentProductMeta || !currentProductRows.length) {
    elResults.innerHTML = `<div class="card" style="opacity:.8;">No checklist rows found.</div>`;
    return;
  }

  const vars = getThemeVars();
  const displayBadge = esc(currentProductMeta?.displayName || "");
  const availableTabs = getAvailableTabs(currentProductRows);
  const filteredRows = filterRowsForTab(currentProductRows, currentProductTab);
  const rowCountLabel = `${filteredRows.length.toLocaleString()} Card${filteredRows.length === 1 ? "" : "s"}`;

  const subsetBlocks = currentProductTab !== "Base" ? groupRowsBySubset(filteredRows, currentProductTab) : [];

  elResults.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;">
        <div>
          <div style="font-weight:800;font-size:20px;line-height:1.15;margin-bottom:4px;">${esc(currentProductTab)} Checklist</div>
          <div style="color:${vars.subText};font-size:13px;">${esc(rowCountLabel)}</div>
        </div>

        ${displayBadge ? `
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
          ">${displayBadge}</div>
        ` : ""}
      </div>

      ${availableTabs.length ? `
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px;margin-bottom:14px;">
          ${availableTabs.map(tab => {
            const isActive = tab.key === currentProductTab;
            return `
              <button
                type="button"
                class="cv-tab-btn"
                data-tab="${esc(tab.key)}"
                style="
                  border:1px solid ${isActive ? vars.pillActiveBg : vars.pillBorder};
                  background:${isActive ? vars.pillActiveBg : vars.pillBg};
                  color:${isActive ? vars.pillActiveText : vars.pillText};
                  border-radius:999px;
                  padding:8px 14px;
                  font-size:14px;
                  font-weight:700;
                  cursor:pointer;
                "
              >${esc(tab.key)}</button>
            `;
          }).join("")}
        </div>
      ` : ""}

      ${
        currentProductTab === "Base"
          ? renderSingleChecklistTable(filteredRows, vars, "Base")
          : renderSubsetBlocks(subsetBlocks, vars)
      }
    </div>
  `;

  bindProductTabButtons();
}

function renderSingleChecklistTable(rows, vars, emptyLabel) {
  const baseParallels = getParallelsForSectionSubset(["base"], "[Base]");

  return `
    ${renderParallelsList(baseParallels)}

    <div class="tableScroller" style="
      border:1px solid ${vars.divider};
      border-radius:16px;
      margin-top:8px;
    ">
      <table>
        <thead>
          <tr>
            <th>Card No.</th>
            <th>Player</th>
            <th>Team</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows.length ? rows.map(r => `
            <tr>
              <td>${esc(r.card_no || "")}</td>
              <td>${esc(r.player || "")}</td>
              <td>${esc(r.team || "")}</td>
              <td>${makeTagBubble(r.tag)}</td>
            </tr>
          `).join("") : `
            <tr>
              <td colspan="4" style="padding:16px 12px;color:${vars.subText};">No cards found in ${esc(emptyLabel)}.</td>
            </tr>
          `}
        </tbody>
      </table>
    </div>
  `;
}

function renderSubsetBlocks(groups, vars) {
  if (!groups.length) {
    return `
      <div class="tableScroller" style="
        border:1px solid ${vars.divider};
        border-radius:16px;
        margin-top:8px;
      ">
        <table>
          <tbody>
            <tr>
              <td style="padding:16px 12px;color:${vars.subText};">No cards found in ${esc(currentProductTab)}.</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  }

  return groups.map(group => {
    const sectionForParallels = getParallelSectionKeys(currentProductTab);
    const parallels = getParallelsForSectionSubset(sectionForParallels, group.subset);

    return `
      <div style="margin-top:18px;">
        <div style="font-weight:800;font-size:18px;line-height:1.15;margin-bottom:2px;">${esc(group.subset)}</div>
        <div style="color:${vars.subText};font-size:13px;margin-bottom:12px;">${esc(group.rows.length.toLocaleString())} Card${group.rows.length === 1 ? "" : "s"}</div>

        ${renderParallelsList(parallels)}

        <div class="tableScroller" style="
          border:1px solid ${vars.divider};
          border-radius:16px;
        ">
          <table>
            <thead>
              <tr>
                <th>Card No.</th>
                <th>Player</th>
                <th>Team</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${group.rows.map(r => `
                <tr>
                  <td>${esc(r.card_no || "")}</td>
                  <td>${esc(r.player || "")}</td>
                  <td>${esc(r.team || "")}</td>
                  <td>${makeTagBubble(r.tag)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }).join("");
}

function bindProductTabButtons() {
  const buttons = elResults.querySelectorAll(".cv-tab-btn");
  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      currentProductTab = btn.getAttribute("data-tab") || "Base";
      renderCurrentProductTab();
    });
  });
}

// ---------------- BROAD SEARCH RESULTS ----------------
function renderBroadResults(q, rows, sport, pageInfo) {
  const vars = getThemeVars();
  const titleBits = ["Search Results"];
  const playerCardHtml = currentPlayerStats ? renderPlayerStatsCard(currentPlayerStats) : "";

  if (!rows.length) {
    elResults.innerHTML = `
      ${playerCardHtml}
      <div class="card">
        <div style="font-weight:800;margin-bottom:6px;">${titleBits.join(" • ")}</div>
        <div style="opacity:.75;font-size:13px;margin-bottom:10px;">Query: ${esc(q)}</div>
        <div style="opacity:.8;">No results found for "${esc(q)}".</div>
      </div>
    `;
    return;
  }

  const sortedRows = rows.slice().sort(compareBroadSearchRows_);
  const total = Number(pageInfo?.total) || sortedRows.length;
  const page = Number(pageInfo?.page) || 1;
  const totalPages = Number(pageInfo?.totalPages) || 1;
  const pageSize = Number(pageInfo?.pageSize) || BROAD_PAGE_SIZE;
  const start = total ? ((page - 1) * pageSize) + 1 : 0;
  const end = Math.min(page * pageSize, total);

  elResults.innerHTML = `
    ${playerCardHtml}

    <div class="card">
      <div style="font-weight:800;margin-bottom:6px;">${titleBits.join(" • ")}</div>
      <div style="opacity:.75;font-size:13px;margin-bottom:6px;">Query: ${esc(q)}</div>
      <div style="opacity:.75;font-size:13px;margin-bottom:12px;">Showing ${start.toLocaleString()}-${end.toLocaleString()} of ${total.toLocaleString()}</div>

      <div class="tableScroller" style="
        border:1px solid ${vars.divider};
        border-radius:16px;
      ">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Subset</th>
              <th>Card No.</th>
              <th class="mobileHide">Player</th>
              <th class="mobileHide">Team</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${sortedRows.map(r => `
              <tr>
                <td>${esc(r.displayName || "")}</td>
                <td>${esc(r.subset || "")}</td>
                <td>${esc(r.card_no || "")}</td>
                <td class="mobileHide">${esc(r.player || "")}</td>
                <td class="mobileHide">${esc(r.team || "")}</td>
                <td>${makeTagBubble(r.tag)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>

      ${totalPages > 1 ? `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:14px;">
          <div style="color:${vars.subText};font-size:13px;">Page ${page.toLocaleString()} of ${totalPages.toLocaleString()}</div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            <button
              type="button"
              class="cv-page-btn"
              data-page="${page - 1}"
              ${page <= 1 ? "disabled" : ""}
              style="
                border:1px solid ${vars.pillBorder};
                background:${vars.pillBg};
                color:${vars.pillText};
                border-radius:999px;
                padding:8px 14px;
                font-size:14px;
                font-weight:700;
                cursor:${page <= 1 ? "not-allowed" : "pointer"};
                opacity:${page <= 1 ? ".45" : "1"};
              "
            >Previous</button>

            <button
              type="button"
              class="cv-page-btn"
              data-page="${page + 1}"
              ${page >= totalPages ? "disabled" : ""}
              style="
                border:1px solid ${vars.pillBorder};
                background:${vars.pillBg};
                color:${vars.pillText};
                border-radius:999px;
                padding:8px 14px;
                font-size:14px;
                font-weight:700;
                cursor:${page >= totalPages ? "not-allowed" : "pointer"};
                opacity:${page >= totalPages ? ".45" : "1"};
              "
            >Next</button>
          </div>
        </div>
      ` : ``}
    </div>
  `;

  bindBroadPagingButtons();
}

function bindBroadPagingButtons() {
  const buttons = elResults.querySelectorAll(".cv-page-btn");
  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      const nextPage = Number(btn.getAttribute("data-page")) || 1;
      runBroadSearch(broadSearchState.q, broadSearchState.sport, nextPage);
    });
  });
}
