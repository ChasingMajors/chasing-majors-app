const EXEC_URL = "https://script.google.com/macros/s/AKfycbxFfMn0bc5Q7WIUQwo0RijoeKOQWAZX_RsipvYlFrvPAmo392ql9fSSgq_G_mgJGeBRSQ/exec";
const LS_KEY = "prv_index_v1";
const THEME_KEY = "cm_theme";

const elQ = document.getElementById("q");
const elDD = document.getElementById("dropdown");
const elResults = document.getElementById("results");
const elStatus = document.getElementById("status");
const elOverlay = document.getElementById("overlay");
const elTheme = document.getElementById("themeToggle");

let INDEX = [];
let selected = null;

/* THEME */
function applyTheme(t){
  document.documentElement.setAttribute("data-theme", t);
  localStorage.setItem(THEME_KEY, t);
  elTheme.textContent = t === "light" ? "🌙" : "☀️";
}
applyTheme(localStorage.getItem(THEME_KEY) || "dark");
elTheme.onclick = () => applyTheme(
  document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark"
);

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
  const q = elQ.value.toLowerCase().trim();
  if(q.length<2){elDD.style.display="none";return;}
  const hits = INDEX.filter(i =>
    `${i.DisplayName} ${i.Keywords}`.toLowerCase().includes(q)
  ).slice(0,8);

  elDD.innerHTML = hits.map(i=>`
    <div class="ddItem" data-code="${i.Code}">
      <div class="ddTitle">${i.DisplayName}</div>
      <div class="ddMeta">${i.year} • ${i.sport} • ${i.manufacturer}</div>
    </div>
  `).join("");

  elDD.style.display = hits.length?"block":"none";
  [...elDD.children].forEach(n=>{
    n.onclick=()=>{
      selected = INDEX.find(x=>x.Code===n.dataset.code);
      elQ.value = selected.DisplayName;
      elDD.style.display="none";
      runSearch();
    };
  });
};

document.getElementById("btnSearch").onclick = runSearch;
document.getElementById("btnClear").onclick = ()=>{
  elQ.value="";
  selected=null;
  elResults.textContent="No results yet. Run a search.";
};

async function runSearch(){
  if(!selected) return;
  elOverlay.style.display="flex";
  const d = await api("getRowsByCode",{code:selected.Code});
  render(d.meta,d.rows);
  elOverlay.style.display="none";
}

function render(meta,rows){
  elResults.innerHTML = `
    <strong>${meta.displayName}</strong><br/>
    <span style="color:var(--muted)">${meta.year} • ${meta.sport} • ${meta.manufacturer}</span>
    <table>
      <thead><tr><th>Set Type</th><th>Set Line</th><th>Print Run</th><th>Serial</th></tr></thead>
      <tbody>
        ${rows.map(r=>`
          <tr>
            <td>${r.setType}</td>
            <td>${r.setLine}</td>
            <td>${Number(r.printRun).toLocaleString()}</td>
            <td>${r.serial||""}</td>
          </tr>`).join("")}
      </tbody>
    </table>
  `;
}
