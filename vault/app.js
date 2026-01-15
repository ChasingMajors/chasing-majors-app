/* ================================
   CONFIG
================================ */
const EXEC_URL = "https://script.google.com/macros/s/AKfycbxFfMn0bc5Q7WIUQwo0RijoeKOQWAZX_RsipvYlFrvPAmo392ql9fSSgq_G_mgJGeBRSQ/exec";
const INDEX_KEY = "prv_index_v1";
const THEME_KEY = "cm_theme";

/* ================================
   DOM
================================ */
const elQ = document.getElementById("q");
const elDD = document.getElementById("dropdown");
const elResults = document.getElementById("results");
const elOverlay = document.getElementById("overlay");
const elThemeBtn = document.getElementById("themeToggle");

/* ================================
   STATE
================================ */
let INDEX = [];
let selected = null;

/* ================================
   THEME (WaxAlert parity)
================================ */
function iconMoon(){
  return `
    <svg class="themeIcon" viewBox="0 0 24 24" fill="none">
      <path d="M21 14.5A8.5 8.5 0 0 1 9.5 3a7 7 0 1 0 11.5 11.5Z"
        stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
}
function iconSun(){
  return `
    <svg class="themeIcon" viewBox="0 0 24 24" fill="none">
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

/* ================================
   API
================================ */
async function api(action, payload = {}) {
  const res = await fetch(EXEC_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, payload })
  });
  return res.json();
}

/* ================================
   INIT INDEX
================================ */
(async function init(){
  const cached = localStorage.getItem(INDEX_KEY);
  if (cached) {
    INDEX = JSON.parse(cached);
    hideOverlay();
    return;
  }

  try {
    const data = await api("index");
    INDEX = data.index || [];
    localStorage.setItem(INDEX_KEY, JSON.stringify(INDEX));
  } catch (e) {
    console.error("Index load failed", e);
  }

  hideOverlay();
})();

function hideOverlay(){
  setTimeout(() => {
    elOverlay.style.opacity = "0";
    setTimeout(() => elOverlay.style.display = "none", 300);
  }, 500);
}

/* ================================
   SEARCH DROPDOWN
================================ */
elQ.addEventListener("input", () => {
  const q = elQ.value.toLowerCase().trim();
  selected = null;

  if (q.length < 2) {
    elDD.style.display = "none";
    return;
  }

  const hits = INDEX.filter(i =>
    `${i.DisplayName} ${i.Keywords}`.toLowerCase().includes(q)
  ).slice(0, 8);

  if (!hits.length) {
    elDD.style.display = "none";
    return;
  }

  elDD.innerHTML = hits.map(i => `
    <div class="ddItem" data-code="${i.Code}">
      <div class="ddTitle">${i.DisplayName}</div>
      <div class="ddMeta">${i.year} • ${i.sport} • ${i.manufacturer}</div>
    </div>
  `).join("");

  elDD.style.display = "block";

  [...elDD.children].forEach(node => {
    node.onclick = () => {
      selected = INDEX.find(x => x.Code === node.dataset.code);
      elQ.value = selected.DisplayName;
      elDD.style.display = "none";
    };
  });
});

/* ================================
   SEARCH ACTION
================================ */
document.getElementById("btnSearch").onclick = runSearch;
document.getElementById("btnClear").onclick = () => {
  elQ.value = "";
  selected = null;
  elResults.innerHTML = `<div class="empty">No results yet. Run a search.</div>`;
};

async function runSearch(){
  if (!selected) return;

  elResults.innerHTML = `<div class="empty">Loading…</div>`;

  try {
    const data = await api("getRowsByCode", { code: selected.Code });
    renderResults(data.meta, data.rows || []);
  } catch (e) {
    elResults.innerHTML = `<div class="empty">Error loading data.</div>`;
  }
}

/* ================================
   RENDER
================================ */
function renderResults(meta, rows){
  if (!rows.length) {
    elResults.innerHTML = `<div class="empty">No print run rows found.</div>`;
    return;
  }

  elResults.innerHTML = `
    <div style="font-weight:900;margin-bottom:6px;">
      ${meta.displayName}
    </div>
    <div style="opacity:.7;font-size:13px;margin-bottom:10px;">
      ${meta.year} • ${meta.sport} • ${meta.manufacturer}
    </div>

    <table>
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
            <td>${r.setType || ""}</td>
            <td>${r.setLine || ""}</td>
            <td>${Number(r.printRun || 0).toLocaleString()}</td>
            <td>${r.serial || ""}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

/* ================================
   BOTTOM NAV (placeholder)
================================ */
const homeBtn = document.getElementById("btnHome");
if (homeBtn) {
  homeBtn.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}
