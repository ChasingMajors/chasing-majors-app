'use strict';
// Non-production parity evidence. This entry point has no deployment capability.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {run, inventory, inputs} = require('../../scripts/search-query/reuse.cjs');
const zlib = require('node:zlib');
const root = path.resolve(__dirname, '../..');
const temporary = process.env.RUNNER_TEMP;
if (!temporary || process.env.GITHUB_REF !== 'refs/heads/stage/search-artifact-reuse') {
  throw Error('Isolated staging branch and runner workspace required');
}
const candidate = JSON.parse(fs.readFileSync(path.join(temporary, 'cm-query/reuse-result.json')));
const warm = run(root, path.join(temporary, 'cm-query-warm'), path.join(temporary, 'cm-search-cache'));
const forced = run(root, path.join(temporary, 'cm-query-forced'), path.join(temporary, 'cm-search-absent'));
assert.equal(warm.mode, 'reuse');
assert.equal(forced.mode, 'rebuild');
for (const directory of ['cm-query', 'cm-query-warm']) {
  assert.deepEqual(inventory(path.join(temporary, directory, 'derived')),
    inventory(path.join(temporary, 'cm-query-forced/derived')));
}
// Copy the fingerprinted inputs to an isolated, explicitly synthetic probe checkout.
const probeRoot = path.join(temporary, 'cm-search-input-probe');
for (const file of inputs(root).files) {
  const target = path.join(probeRoot, file.path);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.copyFileSync(path.join(root, file.path), target);
}
fs.mkdirSync(path.join(probeRoot, 'data/prv-calculations'), {recursive: true});
fs.writeFileSync(path.join(probeRoot, 'data/prv-calculations/non-production-probe.json'),
  JSON.stringify({probe_only: true, description: 'PRV-only exclusion proof'}));
const prvOnly = run(probeRoot, path.join(temporary, 'cm-query-prv-only'), path.join(temporary, 'cm-search-cache'));
assert.equal(prvOnly.mode, 'reuse');
assert.deepEqual(inventory(path.join(temporary, 'cm-query-prv-only/derived')),
  inventory(path.join(temporary, 'cm-query-forced/derived')));
const searchRoot = path.join(probeRoot, 'data/v1/checklists/search-index');
const sport = JSON.parse(fs.readFileSync(path.join(searchRoot, 'baseball.json')));
const sourceFile = sport.sharded ? sport.shards[0] : 'baseball.json';
const inputFile = path.join(searchRoot, sourceFile);
const data = JSON.parse(fs.readFileSync(inputFile));
const row = data.rows.find(row => row.player && row.subset);
assert(row, 'Real canonical card row required for the isolated invalidation probe');
const original = structuredClone(row);
const marker = ' [non-production invalidation probe]';
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
assert(reflected, 'Changed subset must be present in the rebuilt output');
const report = {state: 'STAGED', source_sha: process.env.GITHUB_SHA, candidate, warm, forced, prvOnly, changed,
  changed_input: {source_file: sourceFile, code: original.code, player: original.player, card_no: original.card_no},
  changed_output_reflected: reflected, synthetic_probe_only: true,
  parity: 'PASS', d1_reads: 0, d1_writes: 0};
fs.writeFileSync(path.join(temporary, 'search-reuse-proof.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
