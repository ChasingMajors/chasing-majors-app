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
  if (btnTheme) btnTheme.innerHTML = isLight ? iconSun() : iconMoon();
}

applyTheme(localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark");

if (btnTheme) {
  btnTheme.addEventListener("click", () => {
    const next = document.body.classList.contains("light") ? "dark" : "light";
    applyTheme(next);
  });
}

/* -------- API -------- */
async function api(action, payload) {
  const res = await fetch(EXEC_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, payload })
  });
  const text = await res.text();
  try { return JSON.parse(text); }
  catch (e) { return { ok:false, error:"Non-JSON response", preview:text.slice(0,300) }; }
}

/* -------- INIT INDEX -------- */
(async function initIndex() {
  try {
    const cached = localStorage.getItem(LS_KEY);
    if (cached) {
      INDEX = JSON.parse(cached) || [];
      if (elStatus) elStatus.textContent = `Index ready (${INDEX.length})`;
      if (elOverlay) elOverlay.style.display = "none";
      return;
    }

    const d = await api("index", {});
    if (!d || !d.ok) throw new Error((d && d.error) ? d.error : "Index load failed");
    INDEX = d.index || [];
    localStorage.setItem(LS_KEY, JSON.stringify(INDEX));
    if (elStatus) elStatus.textContent = `Index ready (${INDEX.length})`;
  } catch (err) {
    if (elStatus) elStatus.textContent = "Index error";
    // keep overlay from trapping user
  } finally {
    if (elOverlay) elOverlay.style.display = "none";
  }
})();

/* -------- Dropdown hide on outside click -------- */
document.addEventListener("click", (e) => {
  if (!elDD) return;
  if (e.target === elQ) return;
  if (!elDD.contains(e.target)) {
    elDD.style.display = "none";
    elDD.innerHTML = "";
  }
});

/* -------- SEARCH UX -------- */
function normalize(s){ return String(s || "").toLowerCase().trim(); }

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

function bestMatchByQuery(q){
  const t = normalize(q);
  if (!t) return null;

  // exact DisplayName match first
  let m = INDEX.find(i => normalize(i.DisplayName) === t);
  if (m) return m;

  // token includes
  const tokens = t.split(/\s+/).filter(Boolean);
  const scored = [];
  for (const i of INDEX) {
    const hay = normalize(`${i.DisplayName || ""} ${i.Keywords || ""} ${i.Code || ""}`);
    let ok = true;
    for (const tok of tokens) {
      if (!hay.includes(tok)) { ok = false; break; }
    }
    if (ok) scored.push(i);
  }
  return scored.length ? scored[0] : null;
}

if (elQ) {
  elQ.addEventListener("input", () => {
    selected = null;
    const q = normalize(elQ.value);
    if (q.length < 2) {
      elDD.style.display = "none";
      elDD.innerHTML = "";
      return;
    }

    const hits = [];
    for (const i of INDEX) {
      const hay = normalize(`${i.DisplayName || ""} ${i.Keywords || ""} ${i.Code || ""}`);
      if (hay.includes(q)) hits.push(i);
      if (hits.length >= 8) break;
    }

    elDD.innerHTML = hits.map(i => `
      <div class="ddItem" data-code="${escapeHTML(i.Code)}">
        <div class="ddTitle">${escapeHTML(i.DisplayName || "")}</div>
        <div class="ddMeta">${escapeHTML(i.year || "")} • ${escapeHTML(i.sport || "")} • ${escapeHTML(i.manufacturer || "")}</div>
      </div>
    `).join("");

    elDD.style.display = hits.length ? "block" : "none";

    [...elDD.querySelectorAll(".ddItem")].forEach(node => {
      node.addEventListener("click", () => {
        const code = node.getAttribute("data-code");
        selected = INDEX.find(x => String(x.Code) === String(code)) || null;
        if (!selected) return;

        elQ.value = selected.DisplayName || "";
        elDD.style.display = "none";
        elDD.innerHTML = "";
        runSearch();
      });
    });
  });

  elQ.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!selected) selected = bestMatchByQuery(elQ.value);
      runSearch();
    }
  });
}

const btnSearch = document.getElementById("btnSearch");
if (btnSearch) {
  btnSearch.addEventListener("click", () => {
    if (!selected) selected = bestMatchByQuery(elQ.value);
    runSearch();
  });
}

const btnClear = document.getElementById("btnClear");
if (btnClear) {
  btnClear.addEventListener("click", () => {
    if (elQ) elQ.value = "";
    selected = null;
    if (elDD) { elDD.style.display = "none"; elDD.innerHTML = ""; }
    if (elResults) elResults.textContent = "No results yet. Run a search.";
  });
}

/* -------- RUN SEARCH -------- */
async function runSearch(){
  if (!selected || !selected.Code) return;

  if (elOverlay) elOverlay.style.display = "flex";

  try {
    const d = await api("getRowsByCode", { code: selected.Code });
    if (!d || !d.ok) throw new Error((d && d.error) ? d.error : "Search failed");

    render(d.meta || {}, Array.isArray(d.rows) ? d.rows : []);
  } catch (err) {
    if (elResults) {
      elResults.innerHTML = `
        <div style="font-weight:700;">Error</div>
        <div style="opacity:.75;margin-top:6px;">${escapeHTML(String(err))}</div>
      `;
    }
  } finally {
    if (elOverlay) elOverlay.style.display = "none";
  }
}

function render(meta, rows){
  const title = meta.displayName || selected?.DisplayName || "Selected Product";
  const metaLine = [meta.year, meta.sport, meta.manufacturer].filter(Boolean).join(" • ");

  if (!elResults) return;

  elResults.innerHTML = `
    <strong>${escapeHTML(title)}</strong><br/>
    <span style="color:var(--muted)">${escapeHTML(metaLine)}</span>
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
            <td>${escapeHTML(r.setType || "")}</td>
            <td>${escapeHTML(r.setLine || "")}</td>
            <td>${formatNumber(r.printRun)}</td>
            <td>${escapeHTML(r.serial || "")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}
