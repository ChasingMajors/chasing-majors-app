const EXEC_URL = "https://script.google.com/macros/s/AKfycbxFfMn0bc5Q7WIUQwo0RijoeKOQWAZX_RsipvYlFrvPAmo392ql9fSSgq_G_mgJGeBRSQ/exec";
const LS_KEY = "prv_index_v1";
const THEME_KEY = "cm_prv_theme";

const elQ = document.getElementById("q");
const elDD = document.getElementById("dropdown");
const elResults = document.getElementById("results");
const elStatus = document.getElementById("status");
const elOverlay = document.getElementById("overlay");

const btnTheme = document.getElementById("themeToggle");

let INDEX = [];
let selected = null;

/* -------- WaxAlert EXACT moon/sun icons -------- */
function iconMoon() {
  return `
    <svg class="themeIcon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M21 14.5A8.5 8.5 0 0 1 9.5 3a7 7 0 1 0 11.5 11.5Z"
        stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
}
function iconSun() {
  return `
    <svg class="themeIcon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z"
        stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"
        stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
  `;
}

/* -------- Theme (WaxAlert-style: body.light) -------- */
function applyTheme(mode) {
  const isLight = mode === "light";
  document.body.classList.toggle("light", isLight);
  localStorage.setItem(THEME_KEY, isLight ? "light" : "dark");
  btnTheme.innerHTML = isLight ? iconSun() : iconMoon();
}

applyTheme(localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark");

btnTheme.addEventListener("click", () => {
  const next = document.body.classList.contains("light") ? "dark" : "light";
  applyTheme(next);
});

/* API */
async function api(action, payload){
  const r = await fetch(EXEC_URL,{
    method:"POST",
    headers:{"Content-Type":"text/plain;charset=utf-8"},
    body:JSON.stringify({action,payload})
  });
  return r.json();
}

/* INIT */
(async ()=>{
  const cached = localStorage.getItem(LS_KEY);
  if(cached){
    INDEX = JSON.parse(cached);
    elStatus.textContent = `Index ready (${INDEX.length})`;
    elOverlay.style.display="none";
    return;
  }

  const d = await api("index");
  INDEX = d.index || [];
  localStorage.setItem(LS_KEY, JSON.stringify(INDEX));
  elStatus.textContent = `Index ready (${INDEX.length})`;
  elOverlay.style.display="none";
})();

/* SEARCH UX */
elQ.oninput = ()=>{
  const q = String(elQ.value || "").toLowerCase().trim();
  if(q.length < 2){ elDD.style.display="none"; return; }

  const hits = INDEX.filter(i =>
    `${i.DisplayName || ""} ${i.Keywords || ""}`.toLowerCase().includes(q)
  ).slice(0, 8);

  elDD.innerHTML = hits.map(i => `
    <div class="ddItem" data-code="${escapeHTML(i.Code)}">
      <div class="ddTitle">${escapeHTML(i.DisplayName || "")}</div>
      <div class="ddMeta">${escapeHTML(i.year || "")} • ${escapeHTML(i.sport || "")} • ${escapeHTML(i.manufacturer || "")}</div>
    </div>
  `).join("");

  elDD.style.display = hits.length ? "block" : "none";

  [...elDD.children].forEach(n => {
    n.onclick = () => {
      const code = n.dataset.code;
      selected = INDEX.find(x => String(x.Code) === String(code)) || null;
      if (!selected) return;
      elQ.value = selected.DisplayName || "";
      elDD.style.display = "none";
      runSearch();
    };
  });
};

document.getElementById("btnSearch").addEventListener("click", runSearch);

document.getElementById("btnClear").addEventListener("click", ()=>{
  elQ.value="";
  selected=null;
  elDD.style.display="none";
  elResults.textContent="No results yet. Run a search.";
});

/* run search */
async function runSearch(){
  if(!selected) return;
  elOverlay.style.display="flex";

  try {
    const d = await api("getRowsByCode", { code: selected.Code });
    if (!d || !d.ok) throw new Error((d && d.error) ? d.error : "Search failed");

    render(d.meta || {}, Array.isArray(d.rows) ? d.rows : []);
  } catch (err) {
    elResults.innerHTML = `<div style="opacity:.8;font-weight:700;">Error</div><div style="opacity:.75;margin-top:6px;">${escapeHTML(String(err))}</div>`;
  } finally {
    elOverlay.style.display="none";
  }
}

function render(meta, rows){
  const title = meta.displayName || selected?.DisplayName || "Selected Product";
  const metaLine = [meta.year, meta.sport, meta.manufacturer].filter(Boolean).join(" • ");

  elResults.innerHTML = `
    <strong>${escapeHTML(title)}</strong><br/>
    <span style="color:var(--muted)">${escapeHTML(metaLine)}</span>
    <table>
      <thead><tr><th>Set Type</th><th>Set Line</th><th>Print Run</th><th>Serial</th></tr></thead>
      <tbody>
        ${rows.map(r=>`
          <tr>
            <td>${escapeHTML(r.setType || "")}</td>
            <td>${escapeHTML(r.setLine || "")}</td>
            <td>${formatNumber(r.printRun)}</td>
            <td>${escapeHTML(r.serial || "")}</td>
          </tr>`).join("")}
      </tbody>
    </table>
  `;
}

/* helpers */
function escapeHTML(s){
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[m]));
}

function formatNumber(v){
  if (v === null || v === undefined || v === "") return "";
  const n = Number(String(v).replace(/,/g,""));
  return Number.isFinite(n) ? n.toLocaleString() : escapeHTML(String(v));
}
