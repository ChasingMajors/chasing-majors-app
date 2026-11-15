# CSP preparation and release compatibility

This implementation generates proposals and checks compatibility. It does **not**
enable enforcement, update Cloudflare, create a reporting sink, or authorize a
production release. Those are separate owner decisions after browser evidence.

`scripts/csp-policy.py` uses Python 3's standard library. The release workflow
generates SHA-256 script/style hashes from the **assembled immutable HTML**, not
from manually maintained hash strings. Its separate `csp-policy` artifact includes
source SHA, original HTML hashes, eight exact path aliases and page-specific
directives. JSON-LD is included conservatively even though it is not executable
JavaScript. CRLF/CR are normalized like HTML before inline hashing; entity text
inside raw script/style blocks is preserved. External scripts remain same-origin.

The generator supports the reviewed static entrypoint syntax. Duplicate attributes,
inline event handlers, JavaScript URLs, unknown script/stylesheet origins, embedded
documents, base/meta-policy tags, templates/noscript, unclosed raw-text blocks and
ambiguous HTML5 double-escaped scripts require explicit review. It fails rather
than trying to interpret those constructs using an incomplete HTML5 parser.

The read-only Node guard runs immediately before Pages deployment, after confirming
that main still matches the source SHA. It checks each of the eight public HTML
aliases. Any **enforcing** header must allow the candidate's exact hashes and the
reviewed source profile. Every comma-separated policy is checked, since browsers
enforce their intersection. Additional sources are rejected, except exact SHA-256
hashes for a reviewed old/new transition. Network errors, unexpected origins,
non-HTML responses, duplicate directives or incomplete coverage block deployment.
Report-only drift is recorded without treating it as an enforcing block.

The guard is not a full browser CSP evaluator. It conservatively requires the
explicit reviewed directive set rather than guessing at fallback equivalence. A
passing header check does not establish clean browser flows, absence of unknown
inbound embeds, or permission to enforce. It has no Cloudflare credentials/write
capability. Its evidence is uploaded as `csp-preflight`, including failed checks.

## Before any enforcement

1. Identify and fix actual report-only violations in normal customer flows. A
   deliberately injected negative control is not a legitimate-flow failure.
2. Confirm legitimate inbound iframe consumers. The proposed `frame-ancestors
   'self'` mirrors report-only; it must not be enforced while external usage is
   unknown. Searching local source cannot prove absence of external consumers.
3. Prove allowed scripts/styles run and disallowed controls are blocked under a
   staged enforcing HTTP header, then observe clean report-only real traffic.
4. Obtain owner approval for the exact policy, paths, delivery and rollback.

Existing Cloudflare rules are static. A generated JSON artifact is **not** a live
header update. Before a later approved HTML change, inspect current rules and use
an explicitly reviewed per-page union of current and candidate hashes, retaining
current allowances while the old page is still served. Run the guard, publish and
verify the immutable release. Keep required old hashes until cached older HTML is
no longer served; do not blindly replace a ruleset or remove old hashes first.
The guard prevents silent drift but does not make independently managed edge rules
and Pages deployment atomic. Header changes remain a separate authorized operation.

Rollback of a problematic enforcement is to remove/disable only the approved
enforcing header operation while retaining existing report-only rules, then verify
the public pages. Rollback of this build preparation restores the prior workflow;
it does not require catalog/D1 changes.

The branch-only `csp-preparation-proof.yml` has no deploy job. It runs the complete
Node suite, Python generator tests, deterministic proposals and read-only static
header checks. A locked test-only Playwright install runs Chromium on Linux. Its
browser requests are all intercepted: actual local HTML/scripts/styles/JSON are
served under the production origin, while API envelopes, Apps Script responses
and Google font CSS are fixtures. No browser request is continued to a remote
endpoint. It exercises normal local-data flows, allowed self-hosted scripts,
disallowed inline scripts/styles under report/enforce, and same/foreign framing.
The report-only cases also mirror the freshly observed public header values;
their HTML hashes must equal the unchanged staged entrypoints. The committed
snapshot lacks generated bounded/compressed search assets, so these are product
and local-data flow checks, not acceptance of broad/player-search delivery.
It does not execute live searches or Apps Script calls, or access D1. A passing
fixture does not establish a clean real-traffic window or that foreign embedding
can safely be blocked. Font rendering is outside this fixture's acceptance.
