const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

// Slice the relevant functions out of checklists/app.js and run them in a vm
// sandbox (same pattern as tests/vault-search.test.cjs). We verify ONLY the
// download-scoping decision in the no-sport typeahead hot path; the scoring
// internals are stubbed so this test does not depend on the fuzzy matcher.
const script = fs.readFileSync('checklists/app.js', 'utf8');

function sliceFn(name) {
  const start = script.indexOf(name);
  if (start < 0) throw new Error('could not find ' + name);
  // Walk braces from the first "{" after the signature to find the body end.
  let i = script.indexOf('{', start);
  let depth = 0;
  for (; i < script.length; i++) {
    const ch = script[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return script.slice(start, i + 1);
    }
  }
  throw new Error('unbalanced braces slicing ' + name);
}

const normalizeSearchRows = sliceFn('function normalizeSearchRows_(');
const loadCached = sliceFn('function loadCachedChecklistSearchRows_(');
const makePlayerHits = sliceFn('async function makeChecklistPlayerTypeaheadHits_(');

function makeContext(cache) {
  let allLoads = 0;         // count of loadStaticChecklistSearchRows_ calls
  const loadedSports = [];  // sport args passed to the loader

  const ctx = {
    STATIC_CACHE: cache,
    STATIC_SPORTS: ['baseball', 'basketball', 'football', 'hockey', 'soccer'],
    normalizeQuery_: s => String(s || '').trim().toLowerCase(),
    lower: s => String(s || '').trim().toLowerCase(),
    norm: s => String(s ?? '').trim(),
    // Any row whose player name contains the needle is "helpful" for the test.
    looksLikeHelpfulPlayerSuggestion_: (needle, row) =>
      !!row.player && String(row.player).toLowerCase().includes(String(needle).toLowerCase()),
    scoreNameLikeMatch_: (needle, name) =>
      String(name || '').toLowerCase().includes(String(needle).toLowerCase()) ? 100 : -1,
    // Tracked loader: records the call and returns rows for the asked sport only.
    async loadStaticChecklistSearchRows_(sport) {
      allLoads++;
      loadedSports.push(sport);
      const data = cache['checklist_search_' + sport];
      return ctx.normalizeSearchRows_(data && data.rows ? data.rows : []);
    }
  };

  vm.createContext(ctx);
  vm.runInContext(
    normalizeSearchRows + '\n' + loadCached + '\n' + makePlayerHits,
    ctx
  );

  return { ctx, stats: () => ({ allLoads, loadedSports }) };
}

const BASEBALL_ROWS = {
  rows: [
    { player: 'Mike Trout', sport: 'baseball', displayName: 'Mike Trout' },
    { player: 'Shohei Ohtani', sport: 'baseball', displayName: 'Shohei Ohtani' }
  ]
};

test('no sport + empty cache: zero fetches, no results', async () => {
  const { ctx, stats } = makeContext({});
  const hits = await ctx.makeChecklistPlayerTypeaheadHits_('trout', '', 5);
  assert.equal(hits.length, 0);
  assert.equal(stats().allLoads, 0, 'must not call the all-sports loader');
});

test('no sport + cached sport rows: returns cached cross-sport hits without fetching', async () => {
  const { ctx, stats } = makeContext({ checklist_search_baseball: BASEBALL_ROWS });
  const hits = await ctx.makeChecklistPlayerTypeaheadHits_('trout', '', 5);
  assert.equal(stats().allLoads, 0, 'must read cache only, issue no loads');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].player, 'Mike Trout');
});

test('sport selected: uses the per-sport loader path', async () => {
  const { ctx, stats } = makeContext({ checklist_search_baseball: BASEBALL_ROWS });
  const hits = await ctx.makeChecklistPlayerTypeaheadHits_('ohtani', 'baseball', 5);
  const s = stats();
  assert.equal(s.allLoads, 1, 'should load exactly once for the selected sport');
  assert.deepEqual(s.loadedSports, ['baseball'], 'should load only the selected sport, not "all"');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].player, 'Shohei Ohtani');
});
