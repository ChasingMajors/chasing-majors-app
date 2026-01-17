/* ================================
   Print Run Vault — app.js (FULL)
   - Updates EXEC_URL to new deployment
   - Adds minimal logging: ts, selectedName, year, sport
   - Logs ONLY when a product is selected (dropdown click or best-match on Search)
   - Fire-and-forget (never blocks UX)
================================ */

// ---------------- CONFIG ----------------
const EXEC_URL = "https://script.google.com/macros/s/AKfycbx_1rqxgSCu6aqDc7jEnETYC-KcNxHEf208GWXM23FR7hDT0ey8Y1SZ2i4U1VmXOZgpAg/exec";
const INDEX_KEY = "prv_index_v1";
const INDEX_VER_KEY = "prv_index_ver_v1";
const THEME_KEY = "cm_theme";

// ---------------- DOM ----------------
const elQ = document.getElementById("q");
const elDD = document.getElementById("dropdown");
const elResults = document.getElementById("results");
const elOverlay = document.getElementById("overlay");
const elThemeBtn = document.getElementById("themeToggle");

// ---------------- STATE ----------------
let INDEX = [];
let selected = null;

// ---------------- THEME (WaxAlert parity) ----------------
function iconMoon(){
  return `
    <svg class="themeIcon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M21 14.5A8.5 8.5 0 0 1 9.5 3a7 7 0 1 0 11.5 11.5Z"
        stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
}
function iconSun(){
  return `
    <svg class="themeIcon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z"
        stroke="currentColor" stroke-width="2"
        stroke-linecap="round"/>
      <path d="M12 2v2M12 20v2M4 12H2M22 12h-2
               M5 5l1.5 1.5M17.5 17.5 19 19
               M19 5l-1.5 1.5M6.5 17.5 5 19"
        stroke="currentColor" stroke-width="2"
        stroke-linecap="round"/>
    </svg>`;
}

function applyTheme(t){
  document.body.classList.toggle("light", t === "light");
  localStorage.setItem(THEME_KEY, t);
  elThemeBtn.innerHTML = (t === "light") ? iconSun() : iconMoon();
}
applyTheme(localStorage.getItem(THEME_KEY) || "dark");

elThemeBtn.addEventListener("click", () => {
  const isLight = document.body.classList.contains("light");
  applyTheme(isLight ? "dark" : "light");
});

// ---------------- API ----------------
async function api(action, payload = {}) {
  const res = await fetch(EXEC_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, payload })
  });
  return res.json();
}

// ---------------- SPLASH ----------------
function hideOverlay(){
  setTimeout(() => {
    // overlay element supports .hide in your CSS; if not, this still works
    elOverlay.classList.add("hide");
    setTimeout(() => { elOverlay.style.display = "none"; }, 320);
  }, 500);
}

// ---------------- INDEX CACHE (Option A meta-version) ----------------
function loadCachedIndex_(){
  const cached = localStorage.getItem(INDEX_KEY);
  if (!cached) return [];
  try { return JSON.parse(cached) || []; } catch(e) { return []; }
}

function storeIndex_(indexArr, versionStr){
  INDEX = Array.isArray(indexArr) ? indexArr : [];
  localStorage.setItem(INDEX_KEY, JSON.stringify(INDEX));
  if (versionStr) localStorage.setItem(INDEX_VER_KEY, String(versionStr));
}

async function ensureFreshIndex_(){
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

// ---------------- INIT ----------------
(async function init(){
  await ensureFreshIndex_();
  hideOverlay();
})();

// ---------------- DROPDOWN HELPERS ----------------
function openDropdown(html){
  elDD.innerHTML = html;
  elDD.style.display = "block";
}
function closeDropdown(){
  elDD.style.display = "none";
  elDD.innerHTML = "";
}

// ---------------- ESCAPE/FORMAT HELPERS ----------------
function esc(s){
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[m]));
}
function fmtNum(x){
  const n = Number(String(x ?? "").replace(/,/g,""));
  return Number.isFinite(n) ? n.toLocaleString() : esc(x);
}

// ---------------- MINIMAL LOGGING (selected only) ----------------
function logSelectionFireAndForget_(sel){
  if (!sel) return;

  api("logSearch", {
    selectedName: sel.DisplayName || "",
    year: sel.year || "",
    sport: sel.sport || ""
  }).catch(() => {});
}

// ---------------- TYPEAHEAD (AUTO SEARCH ON SELECT) ----------------
elQ.addEventListener("input", () => {
  const q = elQ.value.toLowerCase().trim();
  selected = null;

  if (q.length < 2) { closeDropdown(); return; }

  const hits = INDEX
    .filter(i => `${i.DisplayName} ${i.Keywords} ${i.Code}`.toLowerCase().includes(q))
    .slice(0, 10);

  if (!hits.length) { closeDropdown(); return; }

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

      // ✅ log selected product (minimal) + auto-search
      logSelectionFireAndForget_(selected);
      await runSearch();
    };
  });
});

// Click outside closes dropdown
document.addEventListener("click", (e) => {
  // If your HTML wraps search input in .searchWrap (WaxAlert style), this keeps dropdown stable.
  const inSearch = e.target.closest(".searchWrap") || e.target.closest("#dropdown");
  if (!inSearch) closeDropdown();
});

// Enter triggers search
elQ.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    runSearch();
  }
});

// Buttons
document.getElementById("btnSearch").onclick = runSearch;
document.getElementById("btnClear").onclick = () => {
  elQ.value = "";
  selected = null;
  closeDropdown();
  elResults.innerHTML = `<div class="card" style="opacity:.8;">No results yet. Run a search.</div>`;
};

// ---------------- SEARCH ----------------
async function runSearch(){
  // If user typed but didn't click a dropdown result, best-match
  if (!selected) {
    const q = elQ.value.toLowerCase().trim();
    if (!q) return;

    const best = INDEX.find(i => `${i.DisplayName} ${i.Keywords} ${i.Code}`.toLowerCase().includes(q));
    if (best) {
      selected = best;

      // ✅ log selected product (minimal) when search resolves to best match
      logSelectionFireAndForget_(selected);
    } else {
      return;
    }
  }

  elResults.innerHTML = `<div class="card" style="opacity:.8;">Loading…</div>`;

  try {
    const data = await api("getRowsByCode", { code: selected.Code });
    renderResults(data.meta, data.rows || []);
  } catch (e) {
    elResults.innerHTML = `<div class="card" style="opacity:.8;">Error loading data.</div>`;
  }
}

// ---------------- RENDER ----------------
function renderResults(meta, rows){
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

// ---------------- BOTTOM NAV (placeholder home) ----------------
const homeBtn = document.getElementById("btnHome");
if (homeBtn) {
  homeBtn.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    elQ.focus();
  });
}
