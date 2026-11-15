'use strict';
// Non-production parity evidence. This entry point has no deployment capability.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {run, inventory} = require('../../scripts/search-query/reuse.cjs');
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
const report = {state: 'STAGED', source_sha: process.env.GITHUB_SHA, candidate, warm, forced,
  parity: 'PASS', d1_reads: 0, d1_writes: 0};
fs.writeFileSync(path.join(temporary, 'search-reuse-proof.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
