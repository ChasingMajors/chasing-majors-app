const test = require('node:test'), assert = require('node:assert/strict');
const {parse, compatible, inspect} = require('../../scripts/csp-policy-guard.cjs');
const hash = "'sha256-" + 'a'.repeat(43) + "='";
const expected = {'default-src': ["'none'"], 'script-src': ["'self'", hash]};
test('CSP guard requires candidate hashes; permits exact old+new transition only', () => {
  assert.deepEqual(compatible("default-src 'none'; script-src 'self' " + hash, expected), []);
  assert(compatible("default-src 'none'; script-src 'self'", expected).length);
  assert(compatible("default-src 'none'; script-src 'self' 'unsafe-inline' " + hash, expected).length);
  assert(compatible("default-src 'none'; script-src * " + hash, expected).length);
  assert.deepEqual(compatible("default-src 'none'; script-src 'self' " + hash + " 'sha256-" + 'b'.repeat(43) + "='", expected), []);
  assert.throws(() => parse("script-src 'self'; script-src *"), /Duplicate/);
});
test('all eight aliases checked; reporting drift cannot silently allow incompatible enforcement', async () => {
  const groups = [['/', '/index.html'], ['/checklists/', '/checklists/index.html'], ['/vault/', '/vault/index.html'], ['/ChatBot/', '/ChatBot/index.html']];
  const candidate = {schema_version: 1, origin: 'https://app.chasingmajors.com', source_sha: 'a'.repeat(40), pages: groups.map(paths => ({paths, directives: expected}))};
  const calls = [];
  const fake = enforcement => async url => {
    calls.push(url.pathname);
    return {ok: true, url: url.href, arrayBuffer: async () => Buffer.from('<!doctype html>'), headers: new Headers({'content-type': 'text/html',
      'content-security-policy-report-only': "default-src 'none'; script-src 'self'",
      ...(enforcement ? {'content-security-policy': enforcement} : {})})};
  };
  let result = await inspect(candidate, {fetchImpl: fake(null)});
  assert.equal(result.status, 'PASS'); assert.equal(calls.length, 8);
  assert(result.results.every(r => r.report_only_problems.length));
  result = await inspect(candidate, {fetchImpl: fake("default-src 'none'; script-src 'self'")});
  assert.equal(result.status, 'BLOCKED');
  await assert.rejects(inspect(candidate, {expectedSha: 'b'.repeat(40), fetchImpl: fake(null)}), /SHA mismatch/);
  result = await inspect(candidate, {fetchImpl: fake("default-src 'none'; script-src 'self' " + hash + ", default-src 'none'; script-src 'self'")});
  assert.equal(result.status, 'BLOCKED');
  const incomplete = structuredClone(candidate); incomplete.pages[3].paths.pop();
  await assert.rejects(inspect(incomplete, {fetchImpl: fake(null)}), /Incomplete/);
  await assert.rejects(inspect(candidate, {fetchImpl: async () => ({ok: true, url: 'https://evil.example', headers: new Headers()})}), /Unexpected/);
});
