// ====== CONFIG ======
const EXEC_URL = "https://script.google.com/macros/s/AKfycbxFfMn0bc5Q7WIUQwo0RijoeKOQWAZX_RsipvYlFrvPAmo392ql9fSSgq_G_mgJGeBRSQ/exec";
const LS_KEY = "prv_index_v1";
const THEME_KEY = "cm_app_theme";
const MAX_SUGGESTIONS = 10;

// ====== STATE ======
let INDEX = [];
let selectedItem = null;
let hasSearched = false;

// ====== DOM ======
const elQ = document.getElementById("q");
const elDD = document.getElementById("dropdown");
const elResults = document.getElementById("results");
const elError = document.getElementById("error");
const elStatus = document.getElementById("statusPill");
const elOverlay = document.getElementById("loadingOverlay");
const elEmpty = document.getElementById("emptyState");
const elThemeToggle = document.getElementById("themeToggle");

document.getElementById("btnSearch").addEventListener("click", onSearchClick);
document.getElementById("btnClear").addEventListener("click", onClear);

elQ.addEventListener("input", onType);
elQ.addEventListener("keydown", (e) => {
  if (e.key === "Enter") onSearchClick();
});

document.addEventListener("click", (e) => {
  if (!elDD.contains(e.target) && e.target !== elQ) hideDropdown();
});

elThemeToggle.addEventListener("click", toggleTheme);

// ====== THEME ======
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);
  elThemeToggle.textContent = theme === "light" ? "Dark" : "Light";
}

function toggleTheme() {
  const cur = document.documentElement.getAttribute("data-theme") || "dark";
  applyTheme(cur === "dark" ? "light" : "dark");
}

(function initTheme(){
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") {
    applyTheme(saved);
  } else {
    // default: use system preference
    const prefersLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
    applyTheme(prefersLight ? "light" : "dark");
  }
})();

// ====== API (with timeout) ======
async function api(action, payload = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(EXEC_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, payload }),
      signal: controller.signal
    });
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// ====== INIT ======
(async function init() {
  setStatus("Loading index…");
  showOverlay(true);

  // Try browser cache first
  const cached = localStorage.getItem(LS_KEY);
  if (cached) {
    try {
      INDEX = JSON.parse(cached) || [];
      setStatus(`Index ready (${INDEX.length})`);
      showOverlay(false);
      return;
    } catch (_) {}
  }

  // Fetch fresh
  try {
    const data = await api("index");
    if (!data.ok) throw new Error(data.error || "Index load failed");
    INDEX = data.index || [];
    localStorage.setItem(LS_KEY, JSON.stringify(INDEX));
    setStatus(`Index ready (${INDEX.length})`);
  } catch (err) {
    setStatus("Index error");
    showError(`Index failed: ${String(err)}`);
  } finally {
    showOverlay(false);
  }
})();

// ====== SEARCH UX ======
function normalize(s) {
  return (s || "").toString().toLowerCase().trim();
}

function buildHay(item) {
  return normalize([
    item.DisplayName,
    item.Keywords,
    item.year,
    item.sport,
    item.manufacturer,
    item.product
  ].join(" "));
}

function onType() {
  hideError();
  selectedItem = null;

  const q = normalize(elQ.value);
  if (!q || q.length < 2) {
    hideDropdown();
    return;
  }

  const hits = [];
  for (const item of INDEX) {
    if (buildHay(item).includes(q)) hits.push(item);
    if (hits.length >= MAX_SUGGESTIONS) break;
  }

  renderDropdown(hits);
}

function renderDropdown(items) {
  if (!items.length) {
    hideDropdown();
    return;
  }

  elDD.innerHTML = items.map(i => {
    const meta = [i.year, i.sport, i.manufacturer, i.product].filter(Boolean).join(" • ");
    return `
      <div class="ddItem" data-code="${escapeHtml(i.Code)}">
        <div class="ddTitle">${escapeHtml(i.DisplayName || "")}</div>
        <div class="ddMeta">${escapeHtml(meta)}</div>
      </div>
    `;
  }).join("");

  Array.from(elDD.querySelectorAll(".ddItem")).forEach(node => {
    node.addEventListener("click", () => {
      const code = node.getAttribute("data-code");
      const item = INDEX.find(x => String(x.Code) === String(code));
      if (!item) return;

      selectedItem = item;
      elQ.value = item.DisplayName || "";
      hideDropdown();

      // selecting a dropdown item should run the search (WaxAlert feel)
      runSearchByCode(item.Code);
    });
  });

  elDD.style.display = "block";
}

function hideDropdown() {
  elDD.style.display = "none";
  elDD.innerHTML = "";
}

function onSearchClick() {
  hideError();
  hideDropdown();

  const q = normalize(elQ.value);
  if (!q) return;

  // Exact DisplayName match first
  let match = INDEX.find(i => normalize(i.DisplayName) === q);
  if (!match) match = INDEX.find(i => buildHay(i).includes(q));

  if (!match) {
    showError("No matching product found. Try different keywords or pick from the dropdown.");
    return;
  }

  selectedItem = match;
  runSearchByCode(match.Code);
}

function onClear() {
  hideError();
  hideDropdown();
  selectedItem = null;
  hasSearched = false;

  elQ.value = "";
  elResults.innerHTML = `<div class="metaRow" id="emptyState">No results yet. Run a search to view print run rows.</div>`;
}

// ====== RESULTS ======
async function runSearchByCode(code) {
  hasSearched = true;
  hideError();
  showOverlay(true);

  // wipe results area and show “loading…”
  elResults.innerHTML = `<div class="metaRow">Loading results…</div>`;

  try {
    const data = await api("getRowsByCode", { code });
    if (!data.ok) throw new Error(data.error || "Search failed");
    renderResults(data.meta || {}, data.rows || []);
  } catch (err) {
    showError(String(err));
    elResults.innerHTML = `<div class="metaRow">No results.</div>`;
  } finally {
    showOverlay(false);
  }
}

function renderResults(meta, rows) {
  const title = meta.displayName || selectedItem?.DisplayName || "Selected Product";
  const metaLine = [meta.year, meta.sport, meta.manufacturer, meta.product].filter(Boolean).join(" • ");
  const cmURL = meta.cmURL || selectedItem?.cmURL || "";

  const btn = cmURL
    ? `<button onclick="window.open('${escapeAttr(cmURL)}','_blank')">View on ChasingMajors</button>`
    : "";

  const table = rows.length ? `
    <table class="table">
      <thead>
        <tr>
          <th>Set Type</th>
          <th>Set Line</th>
          <th>Print Run</th>
          <th>Serial</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td>${escapeHtml(r.setType || "")}</td>
            <td>${escapeHtml(r.setLine || "")}</td>
            <td>${formatNumber(r.printRun)}</td>
            <td>${escapeHtml(r.serial || "")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  ` : `<div class="metaRow">No rows found for this product.</div>`;

  elResults.innerHTML = `
    <p class="selected">${escapeHtml(title)}</p>
    <div class="metaRow">${escapeHtml(metaLine)}</div>
    <div class="actionsRow">${btn}</div>
    ${table}
  `;
}

// ====== UI HELPERS ======
function setStatus(text) {
  elStatus.textContent = text;
}

function showError(msg) {
  elError.textContent = msg;
  elError.style.display = "block";
}

function hideError() {
  elError.textContent = "";
  elError.style.display = "none";
}

function showOverlay(show) {
  if (!elOverlay) return;
  elOverlay.style.display = show ? "flex" : "none";
}

function formatNumber(v) {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(String(v).replace(/,/g, ""));
  if (Number.isFinite(n)) return n.toLocaleString();
  return escapeHtml(String(v));
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(s) {
  return String(s ?? "").replace(/'/g, "%27");
}
