const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {inputs, inventory, run, save, validate} = require('../scripts/search-query/reuse.cjs');
function fixture(t) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-search-reuse-'));
  t.after(() => fs.rmSync(temporary, {recursive: true, force: true}));
  const root = path.join(temporary, 'app');
  for (const file of inputs(process.cwd()).files.filter(file => !file.path.startsWith('data/'))) {
    const target = path.join(root, file.path);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.copyFileSync(path.join(process.cwd(), file.path), target);
  }
  const source = path.join(root, 'data/v1/checklists/search-index');
  fs.mkdirSync(source, {recursive: true});
  const row = {sport: 'baseball', code: '2018_test', displayName: '2018 Test', year: '2018',
    section: 'Base', subset: 'Base', card_no: '1', player: 'Mike Trout', team: 'Angels', search_blob: 'Mike Trout Angels'};
  for (const sport of ['baseball', 'basketball', 'football', 'hockey', 'soccer']) {
    fs.writeFileSync(path.join(source, sport + '.json'), JSON.stringify({rows: sport === 'baseball' ? [row] : []}));
  }
  fs.mkdirSync(path.join(source, 'sources'));
  fs.writeFileSync(path.join(source, 'sources/historical.json'), JSON.stringify({rows: [{...row, code: '2011_test', year: '2011'}]}));
  fs.writeFileSync(path.join(source, 'sources.json'), JSON.stringify({sources: {baseball: [{path: 'sources/historical.json'}]}}));
  return {root, source, at: name => path.join(temporary, name)};
}
test('fingerprint covers historical shards, normalizers, builders and runtime, while PRV-only changes reuse', t => {
  const f = fixture(t), baseline = inputs(f.root).fingerprint;
  fs.writeFileSync(path.join(f.root, 'prv-only.json'), '{"estimate":32}');
  assert.equal(inputs(f.root).fingerprint, baseline);
  for (const file of ['data/v1/checklists/search-index/sources/historical.json', 'ChatBot/api.js',
    'ChatBot/config.js', 'ChatBot/cache.js', 'ChatBot/utils.js', 'checklists/app.js',
    'scripts/search-query/grams.cjs', '.github/recovery/canonical-runtime.cjs']) {
    const target = path.join(f.root, file), bytes = fs.readFileSync(target);
    if (file.endsWith('historical.json')) {
      const data = JSON.parse(bytes);
      data.rows[0].player = 'Historical input change';
      fs.writeFileSync(target, JSON.stringify(data));
    } else fs.appendFileSync(target, '\n');
    assert.notEqual(inputs(f.root).fingerprint, baseline, file);
    fs.writeFileSync(target, bytes);
  }
  const previous = process.env.NODE_OPTIONS;
  try {
    process.env.NODE_OPTIONS = (previous || '') + ' --no-warnings';
    assert.notEqual(inputs(f.root).fingerprint, baseline);
  } finally {
    if (previous === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previous;
  }
});
test('offline builder proves byte parity, invalidation, fresh release stamp and damaged-cache rebuilds', t => {
  const f = fixture(t), cache = f.at('cache');
  assert.equal(run(f.root, f.at('initial'), cache).mode, 'rebuild');
  save(f.root, f.at('initial'), cache);
  fs.writeFileSync(path.join(f.root, 'prv-only.json'), '{"estimate":21}');
  assert.equal(run(f.root, f.at('reused'), cache).mode, 'reuse');
  assert.equal(run(f.root, f.at('forced'), f.at('missing')).mode, 'rebuild');
  assert.deepEqual(inventory(f.at('reused/derived')), inventory(f.at('forced/derived')));
  const {plan} = require('../scripts/search-query/artifact.cjs');
  const oldRelease = plan(f.root, f.at('initial/derived'), 'a'.repeat(40));
  const newRelease = plan(f.root, f.at('reused/derived'), 'b'.repeat(40));
  assert.equal(JSON.parse(newRelease.bodies.get('data/search-query/index.json')).release_sha, 'b'.repeat(40));
  for (const [file, bytes] of oldRelease.bodies) if (file.endsWith('.gz')) assert(bytes.equals(newRelease.bodies.get(file)));
  const originalReceipt = fs.readFileSync(path.join(cache, 'receipt.json'));
  const shard = inventory(path.join(cache, 'derived')).find(file => file.path.endsWith('.gz')).path;
  const shardFile = path.join(cache, 'derived', shard), originalShard = fs.readFileSync(shardFile);
  const damages = [
    () => fs.writeFileSync(path.join(cache, 'receipt.json'), '{'),
    () => fs.writeFileSync(path.join(cache, 'receipt.json'), JSON.stringify({...JSON.parse(originalReceipt), fingerprint: 'wrong'})),
    () => fs.writeFileSync(shardFile, 'corrupt'),
    () => fs.unlinkSync(shardFile)
  ];
  for (const [number, damage] of damages.entries()) {
    damage();
    assert.equal(run(f.root, f.at('damaged-' + number), cache).mode, 'rebuild');
    fs.writeFileSync(path.join(cache, 'receipt.json'), originalReceipt);
    fs.writeFileSync(shardFile, originalShard);
  }
  const builder = path.join(f.root, 'scripts/search-query/grams.cjs');
  const builderBytes = fs.readFileSync(builder);
  fs.appendFileSync(builder, '\n// Test builder-version invalidation.\n');
  assert.equal(run(f.root, f.at('builder-changed'), cache).mode, 'rebuild');
  fs.writeFileSync(builder, builderBytes);
  const oldOptions = process.env.NODE_OPTIONS;
  try {
    process.env.NODE_OPTIONS = (oldOptions || '') + ' --no-warnings';
    assert.equal(run(f.root, f.at('runtime-changed'), cache).mode, 'rebuild');
  } finally {
    if (oldOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = oldOptions;
  }
  const baseball = path.join(f.source, 'baseball.json'), data = JSON.parse(fs.readFileSync(baseball));
  const buildSearchRows = require('../scripts/apply-reviewed-checklists.cjs').buildSearchRows;
  const authored = buildSearchRows({meta: {code: '2018_test', sport: 'baseball', displayName: '2018 Test', year: '2018'},
    rows: [{...data.rows[0], player: 'New Player', section: 'Autographs', subset: 'Rookie Autographs'}]});
  data.rows.push(...authored.filter(row => row.type === 'card'));
  fs.writeFileSync(baseball, JSON.stringify(data));
  const changed = run(f.root, f.at('changed'), cache);
  assert.equal(changed.mode, 'rebuild');
  assert.notEqual(changed.fingerprint, JSON.parse(originalReceipt).fingerprint);
  const meta = JSON.parse(fs.readFileSync(f.at('changed/derived/index.json')));
  const zlib = require('node:zlib');
  const rows = meta.streams.flatMap(entry => JSON.parse(zlib.gunzipSync(fs.readFileSync(f.at('changed/derived/' + path.basename(entry.url))))).rows);
  assert(rows.some(row => row[0].player === 'New Player' && row[0].subset === 'Rookie Autographs'));
  assert.throws(() => validate(f.root, cache, inputs(f.root)), /Fingerprint mismatch/);
});
test('workflow fingerprints after canonical rebuild and saves only after blocking qualification', () => {
  const workflow = fs.readFileSync('.github/workflows/vault-data.yml', 'utf8');
  assert(workflow.indexOf('Deterministically rebuild') < workflow.indexOf('Fingerprint complete'));
  assert(workflow.indexOf('Assemble one immutable') < workflow.indexOf('Save qualified bounded'));
  assert(!workflow.includes('restore-keys:'));
  assert(workflow.includes('actions/cache/restore@v4'));
  assert(workflow.includes('actions/cache/save@v4'));
});

test('new delivery timestamp reuses verified content with current canonical binding and forced-build parity', t => {
  const f = fixture(t), cache = f.at('cache');
  const first = inputs(f.root);
  run(f.root, f.at('first-release'), cache);
  save(f.root, f.at('first-release'), cache);
  const file = path.join(f.source, 'baseball.json'), data = JSON.parse(fs.readFileSync(file));
  data.generated_at = '2030-01-02T00:00:00Z';
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  const next = inputs(f.root);
  assert.equal(first.fingerprint, next.fingerprint);
  assert.notEqual(first.canonical_sha256, next.canonical_sha256);
  assert.equal(run(f.root, f.at('next-release'), cache).mode, 'reuse');
  assert.equal(run(f.root, f.at('next-forced'), f.at('missing-cache')).mode, 'rebuild');
  assert.deepEqual(inventory(f.at('next-release/derived')), inventory(f.at('next-forced/derived')));
  const artifact = require('../scripts/search-query/artifact.cjs');
  assert.throws(() => artifact.plan(f.root, f.at('first-release/derived'), 'a'.repeat(40)), /stale or unbound/);
  const planned = artifact.plan(f.root, f.at('next-release/derived'), 'b'.repeat(40));
  assert.equal(JSON.parse(planned.bodies.get('data/search-query/index.json')).canonical_sha256, next.canonical_sha256);
  data.rows[0].generated_at = 'Nested row value is a search input';
  fs.writeFileSync(file, JSON.stringify(data));
  assert.notEqual(inputs(f.root).fingerprint, next.fingerprint);
});
