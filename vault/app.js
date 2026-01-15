// ====== CONFIG ======
const EXEC_URL = "https://script.google.com/macros/s/AKfycbxFfMn0bc5Q7WIUQwo0RijoeKOQWAZX_RsipvYlFrvPAmo392ql9fSSgq_G_mgJGeBRSQ/exec";
const MAX_SUGGESTIONS = 10;

// ====== STATE ======
let INDEX = [];
let selectedItem = null;

// ====== DOM ======
const elQ = document.getElementById("q");
const elDD = document.getElementById("dropdown");
const elResults = document.getElementById("results");
const elError = document.getElementById("error");
const elStatus = document.getElementById("statusPill");
const elDebug = document.getElementById("debug");

document.getElementById("btnSearch").addEventListener("click", onSearchClick);
document.getElementById("btnClear").addEventListener("click", onClear);

elQ.addEventListener("input", onType);
elQ.addEventListener("keydown", (e) => {
  if (e.key === "Enter") onSearchClick();
});

document.addEventListener("click", (e) => {
  if (!elDD.contains(e.target) && e.target !== elQ) hideDropdown();
});

// ====== HELPERS ======
function setStatus(t){ elStatus.textContent = t; }
function dbg(t){ if (elDebug) elDebug.textContent = t; }
function showError(msg){ elError.textContent = msg; elError.style.display = "block"; }
function hideError(){ elError.textContent = ""; elError.style.display = "none"; }

function normalize(s){ return (s || "").toString().toLowerCase().trim(); }
function buildHay(item){
  return normalize([item.DisplayName, item.Keywords, item.year, item.sport, item.manufacturer, item.product].join(" "));
}
function escapeHtml(s){
  return String(s ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}
function escapeAttr(s){ return String(s ?? "").replace(/'/g,"%27"); }
function formatNumber(v){
  if (v === null || v === undefined || v === "") return "";
  const n = Number(String(v).replace(/,/g,""));
  if (Number.isFinite(n)) return n.toLocaleString();
  return escapeHtml(String(v));
}

// ====== API with timeout ======
async function api(action, payload = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000); // 12s timeout

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
(async function init(){
  // Prove JS loaded
  setStatus("JS loaded… fetching index");
  dbg("JS loaded ✅ Trying to fetch index…");

  try {
    const data = await api("index");
    if (!data.ok) throw new Error(data.error || "Index load failed");

    INDEX = data.index || [];
    setStatus(`Index ready (${INDEX.length})`);
    dbg(`Index loaded ✅ Count: ${INDEX.length}`);

  } catch (err) {
    setStatus("Index error");
    dbg(`Index failed ❌ ${String(err)}`);
    showError(`Index failed: ${String(err)}`);
  }
})();

// ====== DROPDOWN ======
function onType(){
  hideError();
  selectedItem = null;

  const q = normalize(elQ.value);
  if (!q || q.length < 2) return hideDropdown();

  const hits = [];
  for (const item of INDEX) {
    if (buildHay(item).includes(q)) hits.push(item);
    if (hits.length >= MAX_SUGGESTIONS) break;
  }
  renderDropdown(hits);
}

function renderDropdown(items){
  if (!items.length) return hideDropdown();

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
      runSearchByCode(item.Code);
    });
  });

  elDD.style.display = "block";
}

function hideDropdown(){
  elDD.style.display = "none";
  elDD.innerHTML = "";
}

// ====== SEARCH ======
function onSearchClick(){
  hideError();
  hideDropdown();

  const q = normalize(elQ.value);
  if (!q) return;

  let match = INDEX.find(i => normalize(i.DisplayName) === q);
  if (!match) match = INDEX.find(i => buildHay(i).includes(q));

  if (!match) {
    showError("No matching product found. Try different keywords or pick from the dropdown.");
    return;
  }

  selectedItem = match;
  runSearchByCode(match.Code);
}

function onClear(){
  hideError();
  hideDropdown();
  selectedItem = null;
  elQ.value = "";
  elResults.innerHTML = `<div class="metaRow">Cleared. Search above.</div>`;
}

async function runSearchByCode(code){
  elResults.innerHTML = `<div class="metaRow">Loading results…</div>`;

  try {
    const data = await api("getRowsByCode", { code });
    if (!data.ok) throw new Error(data.error || "Search failed");
    renderResults(data.meta || {}, data.rows || []);
  } catch (err) {
    showError(String(err));
    elResults.innerHTML = `<div class="metaRow">No results.</div>`;
  }
}

function renderResults(meta, rows){
  const title = meta.displayName || selectedItem?.DisplayName || "Selected Product";
  const metaLine = [meta.year, meta.sport, meta.manufacturer, meta.product].filter(Boolean).join(" • ");
  const cmURL = meta.cmURL || selectedItem?.cmURL || "";

  const btn = cmURL
    ? `<button onclick="window.open('${escapeAttr(cmURL)}','_blank')">View on ChasingMajors</button>`
    : "";

  const table = rows.length ? `
    <table class="table">
      <thead>
        <tr><th>Set Type</th><th>Set Line</th><th>Print Run</th><th>Serial</th></tr>
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
