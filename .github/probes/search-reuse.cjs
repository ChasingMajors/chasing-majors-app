'use strict';
// Isolated full-catalog acceptance. This workflow has no deployment jobs.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const {run, inventory, inputs} = require('../../scripts/search-query/reuse.cjs');
const root = path.resolve(__dirname, '../..');
const temporary = process.env.RUNNER_TEMP;
if (!temporary || process.env.GITHUB_REF !== 'refs/heads/stage/search-artifact-reuse') {
  throw Error('Isolated staging branch and runner workspace required');
}
function discardBuildDatabase(work) {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(path.join(work, 'build.sqlite' + suffix), {force: true});
}
const candidate = JSON.parse(fs.readFileSync(path.join(temporary, 'cm-query/reuse-result.json')));
const warm = run(root, path.join(temporary, 'cm-query-warm'), path.join(temporary, 'cm-search-cache'));
assert.equal(warm.mode, 'reuse');
assert.deepEqual(inventory(path.join(temporary, 'cm-query/derived')), inventory(path.join(temporary, 'cm-query-warm/derived')));
discardBuildDatabase(path.join(temporary, 'cm-query'));

// Start release B from the actual committed canonical dataset, with fresh authoring inputs.
const probeRoot = path.join(temporary, 'cm-search-input-probe');
fs.cpSync(root, probeRoot, {recursive: true, filter: file => file !== path.join(root, '.git') && file !== path.join(root, 'data')});
const archive = path.join(temporary, 'canonical-probe-data.tar');
cp.execFileSync(process.env.CM_PROOF_GIT || 'git', ['-C', root, 'archive', '--format=tar', '--output=' + archive, 'HEAD', 'data']);
cp.execFileSync('tar', ['-xf', archive, '-C', probeRoot]);
fs.unlinkSync(archive);
const prvFile = path.join(probeRoot, 'data/prv-calculations/bowman-sapphire-2023.json');
const prvSource = JSON.parse(fs.readFileSync(prvFile));
prvSource.meta.keywords += ' [non-production PRV-only fixture]';
fs.writeFileSync(prvFile, JSON.stringify(prvSource));
const releaseTime = new Date(Date.parse(process.env.CM_RELEASE_BUILD_TIME) + 3600000).toISOString();
assert(Number.isFinite(Date.parse(releaseTime)));
const buildStarted = performance.now();
cp.execFileSync(process.execPath, [path.join(probeRoot, 'scripts/build-content-release.cjs')], {
  cwd: probeRoot, stdio: 'inherit', env: {...process.env, GITHUB_SHA: 'b'.repeat(40), CM_RELEASE_BUILD_TIME: releaseTime, NODE_OPTIONS: ''}
});
const canonicalBuildMs = performance.now() - buildStarted;
const originalInputs = inputs(root), nextInputs = inputs(probeRoot);
assert.equal(nextInputs.fingerprint, originalInputs.fingerprint);
assert.notEqual(nextInputs.canonical_sha256, originalInputs.canonical_sha256);
const prvOnly = run(probeRoot, path.join(temporary, 'cm-query-prv-only'), path.join(temporary, 'cm-search-cache'));
assert.equal(prvOnly.mode, 'reuse');
const forced = run(probeRoot, path.join(temporary, 'cm-query-forced'), path.join(temporary, 'cm-search-absent'));
assert.equal(forced.mode, 'rebuild');
assert.deepEqual(inventory(path.join(temporary, 'cm-query-prv-only/derived')), inventory(path.join(temporary, 'cm-query-forced/derived')));
discardBuildDatabase(path.join(temporary, 'cm-query-forced'));

const searchRoot = path.join(probeRoot, 'data/v1/checklists/search-index');
const sport = JSON.parse(fs.readFileSync(path.join(searchRoot, 'baseball.json')));
const sourceFile = sport.sharded ? sport.shards[0] : 'baseball.json';
const inputFile = path.join(searchRoot, sourceFile);
const data = JSON.parse(fs.readFileSync(inputFile));
const row = data.rows.find(row => row.player && row.subset);
assert(row, 'Real canonical card row required for isolated invalidation fixture');
const original = structuredClone(row), marker = ' [non-production invalidation probe]';
row.subset += marker;
row.search_blob = (row.search_blob || '') + marker;
fs.writeFileSync(inputFile, JSON.stringify(data));
const changed = run(probeRoot, path.join(temporary, 'cm-query-cv-changed'), path.join(temporary, 'cm-search-cache'));
assert.equal(changed.mode, 'rebuild');
assert.notEqual(changed.fingerprint, candidate.fingerprint);
const changedDirectory = path.join(temporary, 'cm-query-cv-changed/derived');
const meta = JSON.parse(fs.readFileSync(path.join(changedDirectory, 'index.json')));
let reflected = false;
for (const entry of meta.streams) {
  const chunk = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(changedDirectory, path.basename(entry.url)))));
  if (chunk.rows.some(record => record[0].code === original.code && record[0].player === original.player &&
      record[0].subset === original.subset + marker)) { reflected = true; break; }
}
assert(reflected, 'Changed subset must be present in rebuilt output');
discardBuildDatabase(path.join(temporary, 'cm-query-cv-changed'));
const report = {state: 'STAGED', source_sha: process.env.GITHUB_SHA, candidate, warm, prvOnly, forced, changed,
  release_times: {first: process.env.CM_RELEASE_BUILD_TIME, second: releaseTime}, canonical_build_ms: canonicalBuildMs,
  original_canonical_sha256: originalInputs.canonical_sha256, next_canonical_sha256: nextInputs.canonical_sha256,
  committed_canonical_snapshot: true, changed_output_reflected: reflected, synthetic_probe_only: true,
  changed_input: {file: sourceFile, code: original.code, player: original.player, card_no: original.card_no},
  parity: 'PASS', d1_reads: 0, d1_writes: 0};
fs.writeFileSync(path.join(temporary, 'search-reuse-proof.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
