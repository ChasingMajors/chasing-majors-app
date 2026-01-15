const EXEC_URL = "https://script.google.com/macros/s/AKfycbxFfMn0bc5Q7WIUQwo0RijoeKOQWAZX_RsipvYlFrvPAmo392ql9fSSgq_G_mgJGeBRSQ/exec";

const elQ = document.getElementById("q");
const elResults = document.getElementById("results");
const btnSearch = document.getElementById("btnSearch");
const btnClear = document.getElementById("btnClear");

btnSearch.addEventListener("click", run);
btnClear.addEventListener("click", () => {
  elQ.value = "";
  elResults.textContent = "Cleared. No search yet.";
});

async function api(action, payload = {}) {
  const res = await fetch(EXEC_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, payload })
  });
  return res.json();
}

async function run() {
  const q = (elQ.value || "").trim().toLowerCase();
  if (!q) return;

  elResults.textContent = "Loading index…";

  // 1) load index
  const idx = await api("index");
  if (!idx.ok) {
    elResults.textContent = "Error loading index: " + (idx.error || "unknown error");
    return;
  }

  // 2) find first match (V0)
  const match = (idx.index || []).find(i => {
    const hay = ((i.DisplayName || "") + " " + (i.Keywords || "")).toLowerCase();
    return hay.includes(q);
  });

  if (!match) {
    elResults.textContent = "No match found. Try different keywords.";
    return;
  }

  elResults.textContent = "Found: " + (match.DisplayName || match.Code) + " — fetching rows…";

  // 3) fetch rows for that code
  const rowsData = await api("getRowsByCode", { code: match.Code });
  if (!rowsData.ok) {
    elResults.textContent = "Error fetching rows: " + (rowsData.error || "unknown error");
    return;
  }

  const rows = rowsData.rows || [];
  const meta = rowsData.meta || {};
  const title = meta.displayName || match.DisplayName || "Selected";

  // 4) render basic output
  let out = `${title}\n\n`;
  out += `Rows: ${rows.length}\n\n`;

  for (const r of rows) {
    out += `${r.setType || ""} | ${r.setLine || ""} | ${r.printRun || ""} | ${r.serial || ""}\n`;
  }

  elResults.textContent = out;
}
