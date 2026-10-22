const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

// Slice pure helpers (and searchViaEndpoint_) out of checklists/app.js and run
// them in a vm sandbox (same pattern as tests/cv-sport-gate.test.cjs). No DOM,
// no real network: fetch is stubbed per-test.
const script = fs.readFileSync('checklists/app.js', 'utf8');

function sliceFn(name) {
  const start = script.indexOf(name);
  if (start < 0) throw new Error('could not find ' + name);
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

const buildCvSearchUrl = sliceFn('function buildCvSearchUrl_(');
const shouldFallback = sliceFn('function shouldFallbackFromEndpointResult_(');
const searchViaEndpoint = sliceFn('async function searchViaEndpoint_(');

function makeCtx(overrides = {}) {
  const ctx = Object.assign({
    encodeURIComponent,
    Number,
    parseInt,
    Math,
    Array,
    Boolean,
    setTimeout,
    clearTimeout,
    AbortController,
    BROAD_PAGE_SIZE: 50,
    CV_SEARCH_ENDPOINT: 'https://api.chasingmajors.com/cv-search',
    CV_SEARCH_TIMEOUT_MS: 4500,
    normalizeSearchRows_: rows => (Array.isArray(rows) ? rows : [])
  }, overrides);
  vm.createContext(ctx);
  vm.runInContext(buildCvSearchUrl, ctx);
  vm.runInContext(shouldFallback, ctx);
  vm.runInContext(searchViaEndpoint, ctx);
  return ctx;
}

test('buildCvSearchUrl_ encodes q and includes a chosen sport + page', () => {
  const ctx = makeCtx();
  const url = ctx.buildCvSearchUrl_('https://api.chasingmajors.com/cv-search', 'mike trout', 'basketball', 2);
  assert.ok(url.includes('q=mike%20trout'), 'q should be URL-encoded: ' + url);
  assert.ok(url.includes('sport=basketball'), 'sport should be present: ' + url);
  assert.ok(url.includes('page=2'), 'page should be present: ' + url);
});

test('buildCvSearchUrl_ OMITS sport when sport is empty/falsy', () => {
  const ctx = makeCtx();
  const url = ctx.buildCvSearchUrl_('https://api.chasingmajors.com/cv-search', 'foo', '', 1);
  assert.ok(!/[?&]sport=/.test(url), 'sport param must be omitted: ' + url);
  const url2 = ctx.buildCvSearchUrl_('https://api.chasingmajors.com/cv-search', 'foo', null, 1);
  assert.ok(!/[?&]sport=/.test(url2), 'sport param must be omitted for null: ' + url2);
});

test('buildCvSearchUrl_ includes sport=all for the all-sports search', () => {
  const ctx = makeCtx();
  const url = ctx.buildCvSearchUrl_('https://api.chasingmajors.com/cv-search', 'foo', 'all', 1);
  assert.ok(url.includes('sport=all'), 'sport=all should be present: ' + url);
});

test('buildCvSearchUrl_ defaults page to 1 when invalid', () => {
  const ctx = makeCtx();
  assert.ok(ctx.buildCvSearchUrl_('https://x/cv', 'q', 'baseball', 'abc').includes('page=1'));
  assert.ok(ctx.buildCvSearchUrl_('https://x/cv', 'q', 'baseball', 0).includes('page=1'));
  assert.ok(ctx.buildCvSearchUrl_('https://x/cv', 'q', 'baseball', -5).includes('page=1'));
  assert.ok(ctx.buildCvSearchUrl_('https://x/cv', 'q', 'baseball', undefined).includes('page=1'));
});

test('shouldFallbackFromEndpointResult_ flags bad/empty/non-ok responses', () => {
  const ctx = makeCtx();
  assert.equal(ctx.shouldFallbackFromEndpointResult_(null), true);
  assert.equal(ctx.shouldFallbackFromEndpointResult_(undefined), true);
  assert.equal(ctx.shouldFallbackFromEndpointResult_('nope'), true);
  assert.equal(ctx.shouldFallbackFromEndpointResult_({ ok: false }), true, 'ok:false => fallback');
  assert.equal(ctx.shouldFallbackFromEndpointResult_({ ok: false, status: 503 }), true, '503-style => fallback');
  assert.equal(ctx.shouldFallbackFromEndpointResult_({ ok: true }), true, 'missing results => fallback');
  assert.equal(ctx.shouldFallbackFromEndpointResult_({ ok: true, results: 'x' }), true, 'non-array results => fallback');
});

test('shouldFallbackFromEndpointResult_ accepts a well-formed response', () => {
  const ctx = makeCtx();
  assert.equal(
    ctx.shouldFallbackFromEndpointResult_({ ok: true, results: [{ term: 'a' }] }),
    false
  );
});

test('searchViaEndpoint_ returns a normalized result on a healthy response', async () => {
  const ctx = makeCtx({
    fetch: async () => ({
      ok: true,
      json: async () => ({ ok: true, results: [{ term: 'a' }, { term: 'b' }], total: 2, page: 1, pageSize: 50, totalPages: 1 })
    })
  });
  const out = await ctx.searchViaEndpoint_('foo', 'baseball', 1);
  assert.ok(out && out.ok === true);
  assert.equal(out.results.length, 2);
  assert.equal(out.total, 2);
});

// Fallback-triggers test: simulate endpoint failure three ways and assert
// searchViaEndpoint_ resolves to null, which the decision logic then treats as
// "fall back" — proving the 3-tier chain drops to searchStaticCards_.
test('searchViaEndpoint_ returns null on network error (fallback triggers)', async () => {
  const ctx = makeCtx({
    fetch: async () => { throw new Error('bad url / network down'); }
  });
  const out = await ctx.searchViaEndpoint_('foo', 'baseball', 1);
  assert.equal(out, null, 'network error must yield null');
  assert.equal(ctx.shouldFallbackFromEndpointResult_(out), true, 'null must trigger fallback');
});

test('searchViaEndpoint_ returns null on non-ok HTTP (fallback triggers)', async () => {
  const ctx = makeCtx({
    fetch: async () => ({ ok: false, status: 503, json: async () => ({ ok: false }) })
  });
  const out = await ctx.searchViaEndpoint_('foo', 'all', 1);
  assert.equal(out, null, 'HTTP 503 must yield null');
  assert.equal(ctx.shouldFallbackFromEndpointResult_(out), true, 'null must trigger fallback');
});

test('searchViaEndpoint_ returns null on a 503-style ok:false payload (fallback triggers)', async () => {
  const ctx = makeCtx({
    fetch: async () => ({ ok: true, json: async () => ({ ok: false, error: 'backend down' }) })
  });
  const out = await ctx.searchViaEndpoint_('foo', 'baseball', 1);
  assert.equal(out, null, 'ok:false payload must yield null');
  assert.equal(ctx.shouldFallbackFromEndpointResult_(out), true, 'null must trigger fallback');
});
