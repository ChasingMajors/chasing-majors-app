'use strict';
// Read-only predeployment check. Never writes Cloudflare configuration or D1.
const fs = require('node:fs');
const crypto = require('node:crypto');
function parse(value) {
  const directives = {};
  for (const clause of value.split(';')) {
    const [name, ...tokens] = clause.trim().split(/\s+/);
    if (!name) continue;
    if (directives[name]) throw Error('Duplicate CSP directive: ' + name);
    directives[name] = tokens;
  }
  return directives;
}
function compatible(value, expected) {
  const actual = parse(value), problems = [];
  for (const [name, required] of Object.entries(expected)) {
    const supplied = actual[name] || [];
    if (required.some(token => !supplied.includes(token))) problems.push(name + ': missing required source');
    // Permit only exact additional hashes for a reviewed old+new transition.
    // No wildcard, unsafe script, nonce or additional origin permission is inferred.
    if (supplied.some(token => !required.includes(token) &&
        !(['script-src', 'style-src'].includes(name) && /^'sha256-[A-Za-z0-9+/]{43}='$/.test(token)))) {
      problems.push(name + ': unreviewed additional source');
    }
  }
  for (const name of Object.keys(actual)) if (!expected[name]) problems.push(name + ': unreviewed directive');
  return problems;
}
async function inspect(candidate, {fetchImpl = fetch, expectedSha} = {}) {
  if (candidate.schema_version !== 1 || candidate.origin !== 'https://app.chasingmajors.com' ||
      !/^[a-f0-9]{40}$/.test(candidate.source_sha || '') || candidate.pages.length !== 4) throw Error('Invalid CSP candidate');
  if (expectedSha && candidate.source_sha !== expectedSha) throw Error('CSP candidate release SHA mismatch');
  const allowed = new Set(['/', '/index.html', '/checklists/', '/checklists/index.html',
    '/vault/', '/vault/index.html', '/ChatBot/', '/ChatBot/index.html']);
  const seen = new Set(), results = [];
  for (const page of candidate.pages) for (const pathname of page.paths) {
    if (!allowed.has(pathname) || seen.has(pathname)) throw Error('Unexpected/duplicate CSP path');
    seen.add(pathname);
    const url = new URL(pathname, candidate.origin);
    url.searchParams.set('csp_preflight', candidate.source_sha);
    const response = await fetchImpl(url, {cache: 'no-store', signal: AbortSignal.timeout(20000)});
    if (!response.ok || new URL(response.url).origin !== candidate.origin ||
        !/text\/html/i.test(response.headers.get('content-type') || '')) throw Error('Unexpected CSP HTML response: ' + pathname);
    const enforcement = response.headers.get('content-security-policy');
    const reporting = response.headers.get('content-security-policy-report-only');
    const check = value => {
      try { return value ? value.split(',').flatMap(policy => compatible(policy, page.directives)) : []; }
      catch (error) { return [error.message]; }
    };
    const problems = check(enforcement);
    const body = Buffer.from(await response.arrayBuffer());
    results.push({path: pathname, enforcing: Boolean(enforcement), report_only: Boolean(reporting),
      enforcing_value: enforcement, report_only_value: reporting,
      live_html_sha256: crypto.createHash('sha256').update(body).digest('hex'),
      enforcing_problems: problems, report_only_problems: check(reporting)});
  }
  if (seen.size !== allowed.size) throw Error('Incomplete CSP path coverage');
  const blocked = results.some(result => result.enforcing_problems.length);
  return {source_sha: candidate.source_sha, status: blocked ? 'BLOCKED' : 'PASS',
    scope: 'Read-only header compatibility; not browser-flow or inbound-embed acceptance', results};
}
module.exports = {parse, compatible, inspect};
if (require.main === module) (async () => {
  const candidate = JSON.parse(fs.readFileSync(process.argv[2]));
  const result = await inspect(candidate, {expectedSha: process.env.GITHUB_SHA});
  fs.writeFileSync(process.argv[3], JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
  if (result.status !== 'PASS') process.exitCode = 1;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
