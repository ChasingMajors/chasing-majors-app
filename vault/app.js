/* ================================
   Print Run Vault — app.js (FULL)
   - Homepage search handoff support
   - Uses Checklist Vault theme system (html[data-theme], icons)
   - Bottom nav handled in HTML (3 buttons)
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
const elThemeBtn = document.getElementById("themeToggle");

// ---------------- STATE ----------------
let INDEX = [];
let selected = null;
let initDone = false;

// ---------------- THEME (Checklist Vault parity) ----------------
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

// ---------------- API ----------------
async function api(action, payload = {}) {
  const res = await fetch(EXEC_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, payload })
  });
  return res.json();
}

// ---------------- INDEX CACHE ----------------
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
  loadTheme();
  await ensureFreshIndex_();
  initDone = true;
  runHomepageHandoffIfPresent();
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

// ---------------- MINIMAL LOGGING ----------------
function logSelectionFireAndForget_(sel){
  if (!sel) return;

  api("logSearch", {
    selectedName: sel.DisplayName || "",
    year: sel.year || "",
    sport: sel.sport || ""
  }).catch(() => {});
}

// ---------------- SEARCH HELPERS ----------------
function findBestMatch(query) {
  const q = String(query || "").toLowerCase().trim();
  if (!q || !INDEX.length) return null;

  const exactDisplay = INDEX.find(i =>
    String(i.DisplayName || "").toLowerCase() === q
  );
  if (exactDisplay) return exactDisplay;

  const exactCode = INDEX.find(i =>
    String(i.Code || "").toLowerCase() === q
  );
  if (exactCode) return exactCode;

  const startsWithDisplay = INDEX.find(i =>
    String(i.DisplayName || "").toLowerCase().startsWith(q)
  );
  if (startsWithDisplay) return startsWithDisplay;

  const includesMatch = INDEX.find(i =>
    `${i.DisplayName || ""} ${i.Keywords || ""} ${i.Code || ""}`.toLowerCase().includes(q)
  );
  if (includesMatch) return includesMatch;

  return null;
}

// ---------------- HOMEPAGE HANDOFF ----------------
function runHomepageHandoffIfPresent() {
  if (!initDone || !INDEX.length) return;

  let savedQuery = "";
  let savedTarget = "";

  try {
    savedQuery = sessionStorage.getItem("cm_home_search") || "";
    savedTarget = sessionStorage.getItem("cm_home_target") || "";
  } catch (e) {}

  if (!savedQuery || savedTarget !== "vault") return;

  if (!elQ) return;

  elQ.value = savedQuery;
  closeDropdown();

  const best = findBestMatch(savedQuery);
  if (!best) {
    try {
      sessionStorage.removeItem("cm_home_search");
      sessionStorage.removeItem("cm_home_target");
    } catch (e) {}
    return;
  }

  selected = best;
  elQ.value = best.DisplayName;
  logSelectionFireAndForget_(selected);
  runSearch().finally(() => {
    try {
      sessionStorage.removeItem("cm_home_search");
      sessionStorage.removeItem("cm_home_target");
    } catch (e) {}
  });
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

      logSelectionFireAndForget_(selected);
      await runSearch();
    };
  });
});

// Click outside closes dropdown
document.addEventListener("click", (e) => {
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
  if (!initDone) {
    elResults.innerHTML = `<div class="card" style="opacity:.8;">Loading…</div>`;
    return;
  }

  if (!selected) {
    const q = elQ.value.toLowerCase().trim();
    if (!q) return;

    const best = findBestMatch(q);
    if (best) {
      selected = best;
      elQ.value = best.DisplayName;
      logSelectionFireAndForget_(selected);
    } else {
      elResults.innerHTML = `<div class="card" style="opacity:.8;">No matching product found.</div>`;
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
}  localStorage.setItem(INDEX_KEY, JSON.stringify(INDEX));
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
  loadTheme();
  await ensureFreshIndex_();
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

      logSelectionFireAndForget_(selected);
      await runSearch();
    };
  });
});

// Click outside closes dropdown
document.addEventListener("click", (e) => {
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
  if (!selected) {
    const q = elQ.value.toLowerCase().trim();
    if (!q) return;

    const best = INDEX.find(i => `${i.DisplayName} ${i.Keywords} ${i.Code}`.toLowerCase().includes(q));
    if (best) {
      selected = best;
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
