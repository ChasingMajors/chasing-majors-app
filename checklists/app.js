/* ======================================================
   Checklist Vault App Script
   ChasingMajors.com
====================================================== */

const API_BASE = "https://script.google.com/macros/s/AKfycbx_1rqxgSCu6aqDc7jEnETYC-KcNxHEf208GWXM23FR7hDT0ey8Y1SZ2i4U1VmXOZgpAg/exec";

const $ = id => document.getElementById(id);

/* ======================================================
   THEME TOGGLE
====================================================== */

const root = document.documentElement;
const themeToggle = $("themeToggle");

function setTheme(mode){
  root.setAttribute("data-theme", mode);
  localStorage.setItem("cm_theme", mode);
}

function initTheme(){
  const saved = localStorage.getItem("cm_theme");
  if(saved){
    setTheme(saved);
  }
}

themeToggle.addEventListener("click", ()=>{
  const current = root.getAttribute("data-theme") || "dark";
  setTheme(current === "dark" ? "light" : "dark");
});

initTheme();

/* ======================================================
   API STATUS CHECK
====================================================== */

async function checkAPI(){
  const pill = $("apiPill");

  try{
    const r = await fetch(API_BASE + "?ping=1");
    if(r.ok){
      pill.textContent = "API: OK";
    }else{
      pill.textContent = "API: Error";
    }
  }catch(e){
    pill.textContent = "API: Offline";
  }
}

checkAPI();

/* ======================================================
   GLOBAL STATE
====================================================== */

let searchResults = [];
let browseResults = [];
let browseIndex = 0;
const BROWSE_PAGE = 20;

/* ======================================================
   TYPEAHEAD SEARCH
====================================================== */

$("search").addEventListener("input", async (e)=>{
  const q = e.target.value.trim();
  const list = $("typeahead");

  if(q.length < 2){
    list.style.display = "none";
    return;
  }

  try{
    const r = await fetch(API_BASE + "?typeahead=" + encodeURIComponent(q));
    const data = await r.json();

    list.innerHTML = "";

    data.forEach(item=>{
      const div = document.createElement("div");
      div.className = "typeaheadItem";

      div.innerHTML = `
        <div class="typeaheadTitle">${item.name}</div>
        <div class="typeaheadSub">${item.year} • ${item.manufacturer}</div>
      `;

      div.onclick = ()=>{
        $("search").value = item.name;
        list.style.display = "none";
        performSearch();
      };

      list.appendChild(div);
    });

    list.style.display = "block";

  }catch(e){
    console.error(e);
  }
});

/* ======================================================
   SEARCH
====================================================== */

$("go").addEventListener("click", performSearch);

async function performSearch(){

  const q = $("search").value.trim();
  if(!q) return;

  const sport = $("sport").value;

  const url = `${API_BASE}?search=${encodeURIComponent(q)}&sport=${sport}`;

  try{

    const r = await fetch(url);
    const data = await r.json();

    searchResults = data;

    renderSearch();

  }catch(e){
    console.error(e);
  }
}

function renderSearch(){

  const box = $("searchResults");

  box.innerHTML = "";

  if(!searchResults.length){
    box.style.display = "none";
    return;
  }

  box.style.display = "block";

  searchResults.forEach(row=>{

    const div = document.createElement("div");
    div.className = "r";

    div.innerHTML = `
      <div class="rTop">${row.name}</div>
      <div class="rSub">${row.year} • ${row.manufacturer}</div>
    `;

    div.onclick = ()=>{
      loadSet(row.code);
    };

    box.appendChild(div);
  });

  $("countPill").style.display = "inline-flex";
  $("countPill").textContent = `${searchResults.length} results`;
}

/* ======================================================
   CLEAR SEARCH
====================================================== */

$("clearBtn").addEventListener("click", ()=>{
  $("search").value = "";
  $("searchResults").style.display = "none";
  $("typeahead").style.display = "none";
});

/* ======================================================
   BROWSE MODAL
====================================================== */

$("browse").addEventListener("click", openBrowse);

$("browseClose").addEventListener("click", closeBrowse);

function openBrowse(){
  $("browseModal").style.display = "block";
  document.body.style.overflow = "hidden";
  loadBrowse();
}

function closeBrowse(){
  $("browseModal").style.display = "none";
  document.body.style.overflow = "";
}

/* ======================================================
   LOAD BROWSE LIST
====================================================== */

async function loadBrowse(){

  try{

    const r = await fetch(API_BASE + "?browse=1");
    browseResults = await r.json();

    browseIndex = 0;

    renderBrowse();

  }catch(e){
    console.error(e);
  }
}

function renderBrowse(){

  const list = $("browseList");

  list.innerHTML = "";

  const slice = browseResults.slice(0, BROWSE_PAGE);

  slice.forEach(item=>{
    const div = document.createElement("div");
    div.className = "r";

    div.innerHTML = `
      <div class="rTop">${item.name}</div>
      <div class="rSub">${item.year} • ${item.manufacturer} • ${item.code}</div>
    `;

    div.onclick = ()=>{
      closeBrowse();
      loadSet(item.code);
    };

    list.appendChild(div);
  });

  browseIndex = BROWSE_PAGE;

  $("browsePill").style.display = "inline-flex";
  $("browsePill").textContent = browseResults.length;

  $("browseMore").style.display =
    browseResults.length > browseIndex ? "inline-flex" : "none";
}

/* ======================================================
   BROWSE MORE
====================================================== */

$("browseMore").addEventListener("click", ()=>{

  const list = $("browseList");

  const slice = browseResults.slice(browseIndex, browseIndex + BROWSE_PAGE);

  slice.forEach(item=>{
    const div = document.createElement("div");
    div.className = "r";

    div.innerHTML = `
      <div class="rTop">${item.name}</div>
      <div class="rSub">${item.year} • ${item.manufacturer}</div>
    `;

    div.onclick = ()=>{
      closeBrowse();
      loadSet(item.code);
    };

    list.appendChild(div);
  });

  browseIndex += BROWSE_PAGE;

  if(browseIndex >= browseResults.length){
    $("browseMore").style.display = "none";
  }
});

/* ======================================================
   FILTER BROWSE
====================================================== */

$("browseFilter").addEventListener("input", ()=>{

  const q = $("browseFilter").value.toLowerCase();

  const rows = $("browseList").querySelectorAll(".r");

  rows.forEach(r=>{
    const txt = r.textContent.toLowerCase();
    r.style.display = txt.includes(q) ? "" : "none";
  });

});

/* ======================================================
   LOAD SET
====================================================== */

async function loadSet(code){

  const url = `${API_BASE}?set=${code}`;

  try{

    const r = await fetch(url);
    const data = await r.json();

    renderSet(data);

  }catch(e){
    console.error(e);
  }
}

function renderSet(data){

  $("setView").style.display = "block";

  $("setTitle").textContent = "Base Checklist";
  $("setMeta").textContent = `${data.year} • ${data.manufacturer}`;
  $("setCode").textContent = data.code;

  const body = $("setBody");

  body.innerHTML = "";

  data.cards.forEach(card=>{

    const div = document.createElement("div");
    div.className = "r";

    div.innerHTML = `
      <div class="rTop">${card.card_no}. ${card.player}</div>
      <div class="rSub">${card.team}</div>
    `;

    body.appendChild(div);

  });

}

/* ======================================================
   HOME BUTTON
====================================================== */

$("homeBtn").addEventListener("click", ()=>{
  window.location.href = "/";
});
