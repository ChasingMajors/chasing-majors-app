# Lean CSP release preparation

Owner's 2026-11-15 lean decision supersedes the reporting-service/externalization plan.
This branch changes tooling only. Customer HTML, scripts, styles and data stay at
50edd27. Enforcement is proposed only for ChatBot, Checklists and Vault. Homepage
stays report-only; schedule remains outside the rules.

Generator excludes inert JSON-LD/data scripts and retains hashes for executable
inline blocks. Proposed script-src adds only the path prefix
https://static.cloudflareinsights.com/beacon.min.js/ . The pinned injected beacon
with version 2024.11.0 sends to same-origin /cdn-cgi/rum. No external analytics
connect source, reporting destination, or frame-ancestors is proposed. Existing
style-src-attr 'unsafe-inline' is an explicit compromise for dynamic styling.

CSP tests, generator, predeployment compatibility check and dual-header live audit
are advisory unless repository variable CM_CSP_ENFORCEMENT_APPROVED is exactly
true. Failures retain receipts, emit GitHub warning annotations, and write the job
summary. The workflow test permits continue-on-error only on the eleven reviewed
CSP evidence steps; original content/build/deploy gates remain blocking. Turn the
variable on only with approval for the first enforcing page. The live audit records
whether each browser-like response contains the expected reviewed beacon and checks
executable inline/style hashes and script allowances. Current report-only headers
missing the beacon allowance produce an expected advisory warning, not a clean audit.

Branch-only proof has no deploy job. It runs all Node and Python CSP tests and
Chromium, WebKit and Firefox. Public read-only fixture capture requires exact source
HTML identity and only the observed beacon injection difference, redacts the analytics
token, validates script SRI, and captures real font CSS/WOFF2. Browsers use source
HTML/scripts/data with intercepted API/logging/analytics and a deny-all proxy. Proof
must check real source-data flows, same-origin beacon reporting, actual Apps Script
logging transports/302 target, font rendering, allowed self script and inline script/
style negative controls. Homepage uses its actual observed report-only header;
its known beacon warning is classified separately. This is not live API acceptance,
physical-device testing, or visibility into other visitors' browsers.

Approval sequence:
1. Kiro independently reviews exact final SHA and evidence; owner supplies console
   checks (extensions-off Incognito, reload/use each page; copy CSP warning lines).
2. Owner approves tooling/workflow merge to main as a normal release (advisory).
3. Owner separately approves exact ChatBot header + blocking guard variable + one
   rollback rehearsal. Verify header and browser smoke; Kiro independently verifies.
4. Repeat separate approval/live verification for Checklists, then Vault.
5. Optional separate approval adds the beacon allowance to homepage report-only.

Rollback: disable only the affected enforcing rule, retaining its report-only rule;
verify header and page again. Keep the guard blocking while any enforcing page remains.
Never drop a currently needed bootstrap hash: approve a header with both old and new
hashes, publish the new HTML, then approve removing the old hash. Additional hashes
are the guard's only tolerated transition; broader origins/wildcards remain rejected.

Parked work: local branch parked/csp-externalization-and-reporting at d174f5f preserves
the entire unfinished full-plan tree. Do not merge services or externalized assets.
If revived, externalization needs content-hash cache-busting and paint/performance
proof. Reporting needs bounded storage costs, cap/drop visibility, real per-engine
delivery, quota analysis, pre-Worker filtering/kill switch, and owner hosting approval.
Seven-day sink observation, hash-free policies, homepage enforcement and framing
changes are parked. No D1, billing/auth, Sheets/Apps Script deployment or backfill.
