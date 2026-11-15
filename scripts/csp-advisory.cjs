'use strict';
// Evidence-only until the owner-approved repository flag is exactly "true".
const fs = require('node:fs'), cp = require('node:child_process');
const [receipt, command, ...args] = process.argv.slice(2);
if (!receipt || !command) throw Error('Usage: csp-advisory RECEIPT COMMAND [ARGS]');
const blocking = process.env.CM_CSP_ENFORCEMENT_APPROVED === 'true';
const result = cp.spawnSync(command, args, {encoding: 'utf8', maxBuffer: 4 * 1024 * 1024});
const code = result.status === null ? 1 : result.status;
fs.writeFileSync(receipt, JSON.stringify({mode: blocking ? 'blocking' : 'advisory', tool_exit: code,
  outcome: code === 0 ? 'PASS' : 'FAIL', error: result.error?.message || null,
  stdout: (result.stdout || '').slice(-200000), stderr: (result.stderr || '').slice(-200000)}, null, 2) + '\n');
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
console.log(JSON.stringify({csp_mode: blocking ? 'blocking' : 'advisory', tool_exit: code}));
if (code !== 0) {
  console.log('::warning title=CSP evidence failed::' + (blocking ? 'Blocking' : 'Advisory') + ' command failed; inspect ' + receipt.replace(/[\r\n]/g, ''));
}
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
  `CSP evidence: **${code === 0 ? 'PASS' : 'FAIL'}** (${blocking ? 'blocking' : 'advisory'}); receipt: ${receipt}\n\n`);
process.exitCode = blocking ? code : 0;
