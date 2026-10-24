const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const homepage = fs.readFileSync('index.html', 'utf8');
const checklist = fs.readFileSync('checklists/app.js', 'utf8');
const sports = ['baseball', 'basketball', 'football', 'hockey', 'soccer'];
const tick = () => new Promise(resolve => setImmediate(resolve));

function element(attrs = {}) {
  const handlers = {};
  const classes = new Set();
  return {
    value: '', innerHTML: '', textContent: '', style: {}, handlers,
    classList: {
      add: c => classes.add(c), remove: c => classes.delete(c),
      toggle: (c, on) => on ? classes.add(c) : classes.delete(c),
      contains: c => classes.has(c)
    },
    addEventListener: (event, cb) => { handlers[event] = cb; },
    getAttribute: key => attrs[key],
    setAttribute: (key, value) => { attrs[key] = value; }
  };
}
function functionSource(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, signature);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('Unbalanced function ' + signature);
}
function homeHarness() {
  const nodes = new Map();
  const chips = [...sports, ''].map(s => element({'data-sport': s}));
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id);
  };
  const calls = [];
  const ctx = vm.createContext({
    document: {getElementById: get, querySelectorAll: () => chips},
    URLSearchParams,
    fetch: async url => {
      if (url.includes('/cv-search')) calls.push(new URL(url));
      return {ok: true, json: async () => ({ok: true, results: [], items: []})};
    }
  });
  vm.runInContext(homepage.match(/<script>([\s\S]*?)<\/script>/)[1], ctx);
  return {
    calls, chips,
    async type(q) { get('searchInput').value = q; get('searchInput').handlers.input(); await tick(); },
    async submit() { get('searchForm').handlers.submit({preventDefault(){}}); await tick(); },
    async choose(sport) { chips.find(c => c.getAttribute('data-sport') === sport).handlers.click(); await tick(); }
  };
}

function checklistHarness({endpointFails = false} = {}) {
  const calls = [], staticCalls = [], renders = [], elQ = element(), elSport = element();
  elSport.value = 'all';
  const ctx = vm.createContext({
    STATIC_SPORTS: sports, elQ, elSport, elResults: element(), elBtnSearch: element(),
    norm: s => String(s || '').trim(), lower: s => String(s || '').trim().toLowerCase(),
    URLSearchParams, URL, setTimeout, clearTimeout, AbortController, console,
    CV_SEARCH_ENDPOINT: 'https://api.chasingmajors.com/cv-search', CV_SEARCH_TIMEOUT_MS: 4500,
    BROAD_PAGE_SIZE: 50,
    fetch: async url => {
      calls.push(new URL(url));
      if (endpointFails) throw new Error('Endpoint unavailable');
      return {ok: true, json: async () => ({ok: true, results: [], total: 0, page: 1, pageSize: 50, hasMore: false})};
    },
    normalizeSearchRows_: rows => rows,
    shouldFallbackFromEndpointResult_: () => false,
    searchStaticCards_: async (q, sport) => {staticCalls.push({q, sport}); return {results: [], total: 0};},
    getStaticPlayerStats_: async () => ({found: false}),
    renderBroadResults: (q, rows, sport) => renders.push({q, rows, sport}),
    esc: s => s, setLoadingState(){}, hideBootOverlay(){}, showSportHint_(){}, showAllSportsWarning_(){},
    logEventFireAndForget_(){}, normalizeQuery_: s => s, inferSearchKind_: () => 'search',
    closeDropdown(){}, findBestLocalProductMatch: () => null,
    // Exercise real local typeahead and its real input/change listeners.
    debounce: fn => fn(), makeExactSearchSuggestion_: () => null,
    makeProductHitsFromLocalIndex: () => [], renderDropdownItems(){},
    prioritizeTypeaheadResults_: rows => rows, mergeTypeaheadResults: rows => rows,
    makeMlbPlayerTypeaheadHits_: async () => [], makeChecklistPlayerTypeaheadHits_: async () => []
  });
  vm.runInContext(`let manualSearchSport = null, selected = null, initDone = true;
    let currentProductMeta, currentProductRows, currentProductParallels, currentProductTab, currentPlayerStats;
    let activeTypeaheadToken = 0;
    const broadSearchState = {};`, ctx);
  for (const signature of ['function getSportValue(', 'function isSportChosen_(', 'function resolveSearchSport_(',
    'function buildCvSearchUrl_(', 'async function searchViaEndpoint_(', 'async function runBroadSearch(',
    'async function runSearch(', 'async function runTypeahead(']) {
    vm.runInContext(functionSource(checklist, signature), ctx);
  }
  vm.runInContext(checklist.slice(checklist.indexOf('elQ.addEventListener("input"'), checklist.indexOf('document.addEventListener("click"')), ctx);
  vm.runInContext(checklist.slice(checklist.indexOf('if (elSport) {\n  elSport.addEventListener("change"'), checklist.indexOf('// ---------------- SEARCH ROUTER')), ctx);
  return {
    calls, staticCalls, renders, elSport,
    async type(q) { elQ.value = q; elQ.handlers.input(); await tick(); },
    async submit() { await ctx.runSearch(); },
    async choose(sport) { elSport.value = sport || 'all'; elSport.handlers.change(); await tick(); }
  };
}

for (const [name, harness] of [['homepage', homeHarness], ['checklists', checklistHarness]]) {
  test(`${name}: explicit searches infer each sport case-insensitively and update the visible filter`, async () => {
    const h = harness();
    for (const sport of sports) {
      await h.type(`2026 topps ${sport.toUpperCase()}`);
      const before = h.calls.length;
      await h.submit();
      assert.equal(h.calls.length, before + 1);
      assert.equal(h.calls.at(-1).searchParams.get('sport'), sport);
      if (h.chips) {
        const chip = h.chips.find(c => c.getAttribute('data-sport') === sport);
        assert.equal(chip.classList.contains('on'), true);
        assert.equal(chip.getAttribute('aria-pressed'), 'true');
      } else assert.equal(h.elSport.value, sport);
    }
  });
  test(`${name}: a new query without a sport clears earlier inference and omits sport`, async () => {
    const h = harness();
    await h.type('2026 topps football'); await h.submit();
    for (const q of ['Shohei Ohtani', '2026 Topps Chrome', 'footballer']) {
      await h.type(q); await h.submit();
      assert.equal(h.calls.at(-1).searchParams.has('sport'), false);
      if (h.chips) assert.equal(h.chips.find(c => c.getAttribute('data-sport') === '').classList.contains('on'), true);
      else assert.equal(h.elSport.value, 'all');
    }
  });
  test(`${name}: manual sport and explicit All Sports override inference`, async () => {
    const h = harness();
    await h.choose('baseball');
    await h.type('2026 topps football'); await h.submit();
    assert.equal(h.calls.at(-1).searchParams.get('sport'), 'baseball');
    await h.choose(''); await h.submit();
    assert.equal(h.calls.at(-1).searchParams.has('sport'), false);
  });
  test(`${name}: typing makes zero endpoint calls`, async () => {
    const h = harness();
    for (const q of ['202', '2026 topps', '2026 topps football', 'Shohei Ohtani']) await h.type(q);
    assert.equal(h.calls.length, 0);
  });
}

test('checklists: endpoint failure keeps the inferred scope in the static fallback', async () => {
  const h = checklistHarness({endpointFails: true});
  await h.type('2026 topps football'); await h.submit();
  assert.equal(h.calls[0].searchParams.get('sport'), 'football');
  assert.deepEqual(h.staticCalls, [{q: '2026 topps football', sport: 'football'}]);
  assert.equal(h.renders[0].sport, 'football');
});
