
(function(){
  "use strict";

  // ----------------------------------------------------------------------
  // Original FILLED silhouettes (copied verbatim from the approved mockup).
  // Solid white fill; seams/laces are negative-space cutouts drawn in CARDCOL.
  // ----------------------------------------------------------------------
  const SIL = {
    baseball: `<svg viewBox="0 0 100 100">
      <circle class="SILCLASS" cx="50" cy="50" r="45"/>
      <g fill="none" stroke="CARDCOL" stroke-width="3.2" stroke-linecap="round">
        <path d="M22 13 C33 32 33 68 22 87"/>
        <path d="M78 13 C67 32 67 68 78 87"/>
        <path d="M26 22l5 2.5 M24 32l5.5 1.6 M23 42l5.6 .7 M23 52l5.6 -.7 M24 62l5.5 -1.6 M26 72l5 -2.5"/>
        <path d="M74 22l-5 2.5 M76 32l-5.5 1.6 M77 42l-5.6 .7 M77 52l-5.6 -.7 M76 62l-5.5 -1.6 M74 72l-5 -2.5"/>
      </g></svg>`,
    basketball: `<svg viewBox="0 0 100 100">
      <circle class="SILCLASS" cx="50" cy="50" r="45"/>
      <g fill="none" stroke="CARDCOL" stroke-width="3.6" stroke-linecap="round">
        <path d="M50 5 L50 95"/>
        <path d="M5 50 L95 50"/>
        <path d="M14 18 C34 36 66 36 86 18"/>
        <path d="M14 82 C34 64 66 64 86 82"/>
      </g></svg>`,
    football: `<svg viewBox="0 0 100 100">
      <g transform="rotate(-30 50 50)">
        <path class="SILCLASS" d="
          M9 50
          C20 29 33 22 50 22
          C67 22 80 29 91 50
          C80 71 67 78 50 78
          C33 78 20 71 9 50 Z"/>
        <g fill="none" stroke="CARDCOL" stroke-linecap="round">
          <path d="M25 30 L25 70" stroke-width="5"/>
          <path d="M75 30 L75 70" stroke-width="5"/>
          <path d="M40 50 H60" stroke-width="4.2"/>
          <path d="M43 45.5 V54.5 M49 45 V55 M55 45 V55 M60 45.5 V54.5" stroke-width="4.2"/>
        </g>
      </g></svg>`,
    hockey: `<svg viewBox="0 0 100 100">
      <g>
        <path class="SILCLASS" d="
          M24 12 L31 14
          L63 66
          C66 71 72 74 80 74
          L88 74 L88 82 L76 82
          C66 82 58 78 53 70
          L17 16 Z"/>
        <path class="SILCLASS" transform="scale(-1,1) translate(-100,0)" d="
          M24 12 L31 14
          L63 66
          C66 71 72 74 80 74
          L88 74 L88 82 L76 82
          C66 82 58 78 53 70
          L17 16 Z"/>
        <ellipse class="SILCLASS" cx="50" cy="85" rx="12" ry="5"/>
      </g></svg>`,
    soccer: `<svg viewBox="0 0 100 100">
      <circle class="SILCLASS" cx="50" cy="50" r="45"/>
      <g fill="none" stroke="CARDCOL" stroke-width="3.6" stroke-linejoin="round">
        <path d="M50 30 l16 11.6 -6.1 19.4 h-19.8 l-6.1 -19.4 z"/>
        <path d="M50 30 v-22 M66 41.6 l18 -8 M59.9 60.4 l12 17 M40.1 60.4 l-12 17 M34 41.6 l-18 -8"/>
      </g></svg>`
  };
  function build(key, dim, cardCol){
    return (SIL[key]||SIL.football)
      .replace(/SILCLASS/g, dim ? 'sil-dim' : 'sil')
      .replace(/CARDCOL/g, cardCol);
  }
  const TINT={baseball:'#2f5e3a',basketball:'#7a3d12',football:'#274063',hockey:'#1c3a52',soccer:'#123b2e'};
  const BASECOL='#16263a';

  const $ = (id)=>document.getElementById(id);
  const qBaseball=$('qBaseball'), qBasketball=$('qBasketball'), qFootball=$('qFootball'), qHockey=$('qHockey');

  function paintQuad(){
    qBaseball.innerHTML   = build('baseball', true, BASECOL);
    qBasketball.innerHTML = build('basketball', true, BASECOL);
    qFootball.innerHTML   = build('football', true, BASECOL);
    qHockey.innerHTML     = build('hockey', true, BASECOL);
  }
  paintQuad();

  const el={card:$('heroCard'),mfr:$('hcMfr'),year:$('hcYear'),set:$('hcSet'),sport:$('hcSport'),single:$('single'),input:$('searchInput')};

  function driveHero(s,m,set,y){
    const col = (TINT[s]||'#27405f');
    el.single.innerHTML=build(s,false,col);
    el.mfr.textContent=m; el.set.textContent=set; el.year.textContent=y;
    el.sport.textContent=s.charAt(0).toUpperCase()+s.slice(1);
    el.card.style.background=`radial-gradient(120% 90% at 30% 10%, ${col} 0%, #0b0b0b 62%)`;
    el.card.classList.add('searched');
  }
  function resetHero(){
    el.card.classList.remove('searched');
    el.card.style.background='radial-gradient(120% 90% at 30% 10%, #27405f 0%, #0b0b0b 62%)';
    paintQuad();
  }

  // Demo-grade query parser (ported from the mockup) — drives the hero card.
  const MFRS=['Topps','Bowman','Panini','Donruss','Leaf','Upper Deck','Fleer','Score'];
  const SPORTS=['baseball','basketball','football','hockey','soccer'];
  let scopeSport = ''; // '' = All Sports (sport param omitted).
  let manualSportSelected = false;
  function parseAndSearch(q){
    q=(q||'').trim();
    if(!q){resetHero();return null;}
    const lower=q.toLowerCase();
    // the selected sport chip wins; otherwise infer from the query
    const sport=manualSportSelected ? scopeSport : (SPORTS.find(s=>new RegExp('\\b'+s+'\\b').test(lower))||'');
    const year=(q.match(/\b(19|20)\d{2}(-\d{2})?\b/)||[''])[0];
    const mfr=MFRS.find(m=>lower.includes(m.toLowerCase()))||'';
    let set=q;
    [year,mfr].forEach(t=>{if(t)set=set.replace(new RegExp(t,'i'),'');});
    SPORTS.forEach(s=>set=set.replace(new RegExp(s,'i'),''));
    set=set.replace(/\s+/g,' ').trim()||'—';
    if(sport) driveHero(sport,mfr||'—',set,year||'');
    else resetHero();
    return {sport,mfr,set,year};
  }

  // ----------------------------------------------------------------------
  // Live search plumbing
  // ----------------------------------------------------------------------
  const CV_SEARCH_ENDPOINT = "https://api.chasingmajors.com/cv-search";
  const PRV_INDEX_URL = "/data/v2/vault/index.json";
  const PRV_PRODUCTS_BASE = "/data/v2/vault/products/";

  function esc(v){
    return String(v==null?'':v)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function normKey(v){
    return String(v==null?'':v).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  }

  function buildSearchUrl(q, sport, page = 1){
    const params = new URLSearchParams();
    params.set('q', q);
    if(sport && sport !== 'all') params.set('sport', sport);
    params.set('page', String(page));
    return CV_SEARCH_ENDPOINT + '?' + params.toString();
  }

  let searchToken = 0;

  async function fetchSearch(q, sport, page = 1){
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(),4500);
    try{
      const res = await fetch(buildSearchUrl(q, sport, page), { cache:'no-store', signal:controller.signal });
      if(!res.ok) return null;
      const json = await res.json();
      if(!json || json.ok !== true || !Array.isArray(json.results)) return null;
      return json;
    }catch(err){
      return null;
    } finally { clearTimeout(timer); }
  }

  // --- PRV join (best-effort, product-level, graceful) -------------------
  let prvIndexPromise = null;
  function loadPrvIndex(){
    if(!prvIndexPromise){
      prvIndexPromise = fetch(PRV_INDEX_URL, { cache:'force-cache' })
        .then(r=> r.ok ? r.json() : null)
        .then(d=>{
          const rows = d && Array.isArray(d.index) ? d.index : (Array.isArray(d) ? d : []);
          return rows;
        })
        .catch(()=>[]);
    }
    return prvIndexPromise;
  }

  // Match a CV product to a UNIQUE non-empty PRV entry by DisplayName+sport key.
  async function findPrvEntry(displayName, sport){
    try{
      const rows = await loadPrvIndex();
      if(!rows || !rows.length) return null;
      const key = normKey(displayName) + '|' + normKey(sport);
      const matches = rows.filter(function(e){
        return (normKey(e.DisplayName) + '|' + normKey(e.sport)) === key;
      });
      if(matches.length !== 1) return null;           // must be unique
      const entry = matches[0];
      if(!entry.file || !(Number(entry.row_count) > 0)) return null; // non-empty only
      return entry;
    }catch(err){ return null; }
  }

  async function loadPrvRows(entry){
    try{
      const res = await fetch(PRV_PRODUCTS_BASE + encodeURIComponent(entry.file), { cache:'force-cache' });
      if(!res.ok) return [];
      const data = await res.json();
      const rows = data && Array.isArray(data.rows) ? data.rows : [];
      return rows;
    }catch(err){ return []; }
  }

  // Rarest-first: serial_limit ascending is rarest; else by measurement.value ascending.
  function sortByScarcity(rows){
    return rows.slice().sort(function(a,b){
      const sa = a.serial_limit, sb = b.serial_limit;
      const aHas = typeof sa === 'number' && sa > 0;
      const bHas = typeof sb === 'number' && sb > 0;
      if(aHas && bHas) return sa - sb;
      if(aHas) return -1;
      if(bHas) return 1;
      const va = (a.measurement && typeof a.measurement.value === 'number') ? a.measurement.value : Infinity;
      const vb = (b.measurement && typeof b.measurement.value === 'number') ? b.measurement.value : Infinity;
      return va - vb;
    });
  }

  function renderRarityLadder(rows){
    const top = sortByScarcity(rows).slice(0, 8);
    const items = top.map(function(r){
      const name = esc(r.set_name || r.category || 'Parallel');
      const cat = r.category && r.set_name ? '<small>'+esc(r.category)+'</small>' : '';
      let valHtml;
      if(typeof r.serial_limit === 'number' && r.serial_limit > 0){
        valHtml = '<span class="lVal">/'+esc(r.serial_limit)+'</span>';
      }else if(r.measurement && typeof r.measurement.value === 'number'){
        const kind = r.measurement.kind ? ' '+esc(r.measurement.kind) : '';
        valHtml = '<span class="lVal plain">'+esc(r.measurement.value)+kind+'</span>';
      }else{
        valHtml = '<span class="lVal plain">—</span>';
      }
      return '<li><span class="lName">'+name+cat+'</span>'+valHtml+'</li>';
    }).join('');
    return '<ul class="ladder">'+items+'</ul>';
  }

  // Render print-run area for a product result (async, never blocks the page).
  async function renderPrvInto(container, displayName, sport){
    try{
      const entry = await findPrvEntry(displayName, sport);
      if(!entry){
        container.innerHTML = '<p class="prvEmpty">Print-run data isn\u2019t available for this product yet.</p>';
        return;
      }
      const rows = await loadPrvRows(entry);
      if(!rows.length){
        container.innerHTML = '<p class="prvEmpty">Print-run data isn\u2019t available for this product yet.</p>';
        return;
      }
      container.innerHTML = renderRarityLadder(rows) + '<p style="margin-top:12px"><a class="colLink" href="/vault/?code='+encodeURIComponent(entry.Code)+'&sport='+encodeURIComponent(entry.sport||'')+'">Open in Print Run Vault →</a></p>';
    }catch(err){
      container.innerHTML = '<p class="prvEmpty">Print-run data isn\u2019t available for this product yet.</p>';
    }
  }

  // --- Results rendering --------------------------------------------------
  const resultsEl = $('results');

  function checklistHref(r){
    return '/checklists/?code=' + encodeURIComponent(r.code || '') +
           '&sport=' + encodeURIComponent(r.sport || '') +
           '&q=' + encodeURIComponent(r.displayName || r.term || '');
  }
  function vaultHref(r){
    return '/vault/?code=' + encodeURIComponent(r.code || '') +
           '&sport=' + encodeURIComponent(r.sport || '') +
           '&q=' + encodeURIComponent(r.displayName || r.term || '');
  }
  function titleCase(v){ v=String(v||''); return v ? v.charAt(0).toUpperCase()+v.slice(1) : ''; }

  function renderProduct(r){
    const kicker = [r.year, titleCase(r.sport), r.manufacturer].filter(Boolean).map(esc).join(' · ');
    const name = esc(r.displayName || r.term || r.code || 'Product');
    const prvId = 'prv-' + normKey(r.code || name) + '-' + Math.random().toString(36).slice(2,8);
    const html =
      '<article class="resultCard">' +
        (kicker ? '<p class="resultKicker">'+kicker+'</p>' : '') +
        '<h2 class="resultTitle"><a href="'+esc(checklistHref(r))+'">'+name+'</a></h2>' +
        '<div class="prodCols">' +
          '<div class="prodCol">' +
            '<h3>Checklist</h3>' +
            '<p>Full set checklist with sections, parallels, and player cards.</p>' +
            '<p style="margin-top:8px"><a class="colLink" href="'+esc(checklistHref(r))+'">Open checklist \u2192</a></p>' +
          '</div>' +
          '<div class="prodCol">' +
            '<h3>Print run</h3>' +
            '<div id="'+prvId+'"><p class="loading">Checking print-run data\u2026</p></div>' +
          '</div>' +
        '</div>' +
      '</article>';
    return { html, prvId, displayName: r.displayName || r.term || '', sport: r.sport || '' };
  }

  function renderCardRow(r){
    const player = esc(r.player || r.term || '');
    const no = r.card_no ? '#'+esc(r.card_no) : '';
    const meta = [esc(r.displayName || r.product), esc(r.team), esc(r.section)].filter(Boolean).join(' · ');
    const tag = r.tag ? '<span class="cardTag">'+esc(r.tag)+'</span>' : '';
    const href = checklistHref(r);
    return '<div class="cardRow">' +
      (no ? '<span class="cardNo">'+no+'</span>' : '') +
      '<span class="cardPlayer"><a href="'+esc(href)+'">'+player+'</a></span>' +
      (meta ? '<span class="cardMeta">'+meta+'</span>' : '') +
      tag +
    '</div>';
  }

  function renderNoResults(q){
    resultsEl.innerHTML = '<div class="noResults">No matches in the current search index for <b>'+esc(q)+'</b>. Search coverage is still expanding. You can also browse products through guided search.</div>';
  }

  function renderResults(q, json){
    const results = (json && Array.isArray(json.results)) ? json.results : [];
    if(!results.length){ renderNoResults(q); return; }

    const products = results.filter(function(r){ return r.type === 'product'; });
    const cards = results.filter(function(r){ return r.type === 'card'; });

    let html = '';
    const total = (json && typeof json.total === 'number') ? json.total : results.length;
    html += '<p class="resultsHead">Showing '+results.length+' returned result'+(results.length===1?'':'s')+' for \u201C'+esc(q)+'\u201D</p>';

    const prvTargets = [];
    products.forEach(function(r){
      const built = renderProduct(r);
      html += built.html;
      prvTargets.push(built);
    });

    if(cards.length){
      html += '<h2 class="resultsHead" style="margin-top:24px">Cards</h2>';
      cards.forEach(function(r){ html += renderCardRow(r); });
    }

    resultsEl.innerHTML = html;

    // Lazily hydrate PRV sections per product (best-effort, never blocks).
    prvTargets.forEach(function(t){
      const container = document.getElementById(t.prvId);
      if(container) renderPrvInto(container, t.displayName, t.sport);
    });
  }

  // --- Submit flow --------------------------------------------------------
  async function runSearch(){
    const q = (el.input.value || '').trim();

    if(!q){
      resetHero();
      resultsEl.innerHTML = '';
      return;
    }

    const parsed = parseAndSearch(q);
    scopeSport = parsed.sport;
    updateSportChips();
    resultsEl.innerHTML = '<div class="loading">Searching\u2026</div>';

    const token = ++searchToken;
    const json = await fetchSearch(q, scopeSport); // '' => sport param omitted (All Sports)
    if(token !== searchToken) return;      // a newer search superseded this one

    if(!json){ resultsEl.innerHTML='<div class="noResults">Search is temporarily unavailable. Please try again or <a href="/checklists/">browse checklists</a>.</div>'; return; }
    renderResults(q, json);
  }

  const form = $('searchForm');
  form.addEventListener('submit', function(e){ e.preventDefault(); runSearch(); });
  el.input.addEventListener('input', function(){
    if(!(el.input.value || '').trim()){ resetHero(); resultsEl.innerHTML=''; }
  });

  function updateSportChips(){
    Array.prototype.forEach.call(document.querySelectorAll('.scope'), function(c){
      const active = (c.getAttribute('data-sport') || '') === scopeSport;
      c.classList.toggle('on', active);
      c.setAttribute('aria-pressed', String(active));
    });
  }

  // Sport scope chips: selected chip is the filter; it overrides the inferred
  // sport and, when a query is present, re-runs the search with the new scope.
  Array.prototype.forEach.call(document.querySelectorAll('.scope'), function(c){
    c.addEventListener('click', function(){
      manualSportSelected = true;
      scopeSport = c.getAttribute('data-sport') || '';
      updateSportChips();
      if((el.input.value || '').trim()) runSearch(); // re-run with the new scope
    });
  });

  // On load: default quad state, no search yet.
  el.input.value = '';
  resetHero();
  globalThis.CMHomeHero={set:driveHero,reset:resetHero};
  globalThis.CMHomeSearch={query:fetchSearch,cancel:()=>{searchToken++;}};
})();
