/* ================================
   Print Run Vault — app.js (UPDATED)
   - Adds POP jump button
   - Adds Scroll-to-top floating button
================================ */

// ---------------- CONFIG ----------------
const EXEC_URL = "https://script.google.com/macros/s/AKfycbz2GrNPpgls5Q2cwt8IkTGrtbged7J4pxIvec5F0r1JoTo-9m2OMkYvDFFz_MM0LEjOHA/exec";
const LOG_EXEC_URL = "https://script.google.com/macros/s/AKfycbyuTmGksD9ZF89Ij0VmnUeJqP0OcFL5qCe-MUjN0JonJ8QTlfpMsf0XRKZzCwLdFdiF/exec";
const INDEX_KEY = "prv_index_v1";
const INDEX_VER_KEY = "prv_index_ver_v1";
const THEME_KEY = "cm_theme";
const HANDOFF_FLAG_KEY = "cm_handoff_active";
const OVERLAY_MIN_MS = 1200;

// ---------------- DOM ----------------
const elQ = document.getElementById("q");
const elDD = document.getElementById("dropdown");
const elResults = document.getElementById("results");
const elThemeBtn = document.getElementById("themeToggle");
const elBtnSearch = document.getElementById("btnSearch");
const elBtnClear = document.getElementById("btnClear");
const elBootOverlay = document.getElementById("cmBootOverlay");

// ---------------- STATE ----------------
let INDEX = [];
let selected = null;
let initDone = false;
let bootOverlayShownAt = window.__CM_SHOW_BOOT_OVERLAY__ ? Date.now() : 0;

// ---------------- HELPERS ----------------
function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));}
function fmtNum(x){const n=Number(String(x??"").replace(/,/g,""));return Number.isFinite(n)?n.toLocaleString():esc(x);}
function cleanQuery(v){return String(v||"").replace(/\u2019/g,"'").replace(/\s+/g," ").trim();}
function normalizeQuery_(v){return cleanQuery(v).toLowerCase().replace(/[^\w\s']/g," ").replace(/\s+/g," ").trim();}

// ---------------- THEME ----------------
function setTheme(theme){
  const t=theme==="light"?"light":"dark";
  document.documentElement.setAttribute("data-theme",t);
  localStorage.setItem(THEME_KEY,t);
}
function loadTheme(){
  const saved=localStorage.getItem(THEME_KEY);
  setTheme(saved==="light"||saved==="dark"?saved:"dark");
}
if(elThemeBtn){
  elThemeBtn.addEventListener("click",()=>{
    const cur=document.documentElement.getAttribute("data-theme")||"dark";
    setTheme(cur==="dark"?"light":"dark");
  });
}

// ---------------- API ----------------
async function api(action,payload={}){
  const res=await fetch(EXEC_URL,{
    method:"POST",
    headers:{"Content-Type":"text/plain;charset=utf-8"},
    body:JSON.stringify({action,payload})
  });
  const data=await res.json();
  if(!data||data.ok===false) throw new Error(data?.error||"Request failed");
  return data;
}

// ---------------- INDEX ----------------
function loadCachedIndex_(){
  try{return JSON.parse(localStorage.getItem(INDEX_KEY)||"[]");}catch(e){return [];}
}
function storeIndex_(arr,ver){
  INDEX=Array.isArray(arr)?arr:[];
  localStorage.setItem(INDEX_KEY,JSON.stringify(INDEX));
  if(ver) localStorage.setItem(INDEX_VER_KEY,String(ver));
}
async function ensureFreshIndex_(){
  INDEX=loadCachedIndex_();
  try{
    const meta=await api("meta");
    const remoteVer=meta?.indexVersion||"";
    const localVer=localStorage.getItem(INDEX_VER_KEY)||"";
    if(!INDEX.length||remoteVer!==localVer){
      const d=await api("index");
      storeIndex_(d.index||[],remoteVer);
    }
  }catch(e){}
}

// ---------------- SEARCH ----------------
function findBestMatch(q){
  const nq=normalizeQuery_(q);
  return INDEX.find(i=>normalizeQuery_(i.DisplayName||"")===nq)
    || INDEX.find(i=>normalizeQuery_(i.Code||"")===nq)
    || INDEX.find(i=>normalizeQuery_(i.DisplayName||"").startsWith(nq))
    || INDEX.find(i=>normalizeQuery_(`${i.DisplayName} ${i.Keywords} ${i.Code}`).includes(nq));
}

// ---------------- POP RENDER ----------------
function renderPopInsights(pop){
  if(!pop||!pop.data) return "";
  const d=pop.data;
  const pct=(Number(d.weighted_gem_rate||0)*100).toFixed(1)+"%";

  return `
    <div class="card" style="margin-top:12px;">
      <div style="font-weight:800;margin-bottom:8px;">POP Insights</div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;">
        <div>Total Graded<br><b>${fmtNum(d.total_graded)}</b></div>
        <div>Gem Rate<br><b>${pct}</b></div>
        <div>Past Month<br><b>${fmtNum(d.graded_past_month)}</b></div>
        <div>Prior Month<br><b>${fmtNum(d.graded_prior_month)}</b></div>
      </div>
    </div>
  `;
}

// ---------------- JUMP BUTTON ----------------
function bindPopJumpButton(){
  const btn=document.getElementById("jumpToPopBtn");
  const target=document.getElementById("popInsightsCard");
  if(!btn||!target) return;
  btn.onclick=()=>target.scrollIntoView({behavior:"smooth"});
}

// ---------------- SCROLL TO TOP ----------------
function injectScrollTopButton(){
  if(document.getElementById("scrollTopBtn")) return;

  const btn=document.createElement("button");
  btn.id="scrollTopBtn";
  btn.innerHTML="↑";
  btn.style.cssText=`
    position:fixed;
    right:16px;
    bottom:90px;
    width:44px;
    height:44px;
    border-radius:50%;
    border:none;
    background:#ffffff;
    color:#000;
    font-size:20px;
    font-weight:800;
    cursor:pointer;
    display:none;
    z-index:9999;
  `;

  btn.onclick=()=>window.scrollTo({top:0,behavior:"smooth"});
  document.body.appendChild(btn);

  window.addEventListener("scroll",()=>{
    if(window.scrollY>400) btn.style.display="block";
    else btn.style.display="none";
  });
}

// ---------------- RENDER ----------------
function renderResults(meta,rows,pop){
  if(!rows.length){
    elResults.innerHTML=`<div class="card">No data</div>`;
    return;
  }

  const title=esc(meta?.displayName||selected?.DisplayName||"Results");

  elResults.innerHTML=`
    <div class="card">
      <div style="display:flex;justify-content:space-between;">
        <div style="font-weight:800;">${title}</div>
        ${pop?`<button id="jumpToPopBtn">See POP Data</button>`:""}
      </div>

      <table>
        <thead>
          <tr>
            <th>Set</th>
            <th>Subset</th>
            <th>Print Run</th>
            <th>Cards</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r=>`
            <tr>
              <td>${esc(r.setType)}</td>
              <td>${esc(r.setLine)}</td>
              <td>${fmtNum(r.printRun)}</td>
              <td>${fmtNum(r.subSetSize)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>

    <div id="popInsightsCard">
      ${renderPopInsights(pop)}
    </div>
  `;

  bindPopJumpButton();
  injectScrollTopButton();
}

// ---------------- RUN SEARCH ----------------
async function runSearch(){
  if(!initDone) return;

  const q=cleanQuery(elQ.value||"");
  if(!q) return;

  let best=findBestMatch(q);
  if(!best){
    elResults.innerHTML=`<div class="card">No match</div>`;
    return;
  }

  selected=best;

  elResults.innerHTML=`<div class="card">Loading…</div>`;

  try{
    const [data,pop]=await Promise.all([
      api("getRowsByCode",{code:selected.Code}),
      api("getPopSummary",{sport:selected.sport,code:selected.Code}).catch(()=>null)
    ]);

    renderResults(data.meta,data.rows,pop);

  }catch(e){
    elResults.innerHTML=`<div class="card">Error loading data</div>`;
  }
}

// ---------------- INIT ----------------
(async function init(){
  loadTheme();
  await ensureFreshIndex_();
  initDone=true;
})();
