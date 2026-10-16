# Print Run Vault read model

The source of truth remains the existing Sheets exporter and data/v1 files. The new data/v2/vault view is additive; no v1 records or source cells are rewritten.

Run `node --test tests/*.test.cjs` and `node scripts/build-vault-data.cjs` after source changes. The GitHub workflow performs this automatically for source exports, publishes only the derived view, and requests an existing GitHub Pages rebuild. It retries from the latest main if an exporter writes concurrently.

Each product has a content-hashed file and an index entry. The index records the original vault_version. The browser checks this revision before using the derived view, falling back to the latest v1 manifest/shard when the view is stale or unavailable. Failed fetches are evicted from the in-memory cache so Search can retry.

A row preserves its complete `raw` record. The additive fields separate count value/kind/scope, nominal serial limit, checklist size, category, source URL and quality flags. Missing provenance stays unspecified. Reported legacy counts are never promoted to exact counts. Serial limits come only from a numeric serial field or an explicit parenthesized /N label; they never replace estimated pack availability. Row IDs identify source positions; group IDs identify matching normalized labels, not a guaranteed checklist parallel identity.

Checklist links require a unique exact normalized product name and sport. Ambiguous/missing matches remain unlinked. This is deliberately conservative; a complete shared set/parallel registry still requires reviewed mappings.

The public interface shows data and concise count labels. Source paragraphs and source links remain in stored records only, per the product owner's preference. Filters, sorting and incremental rendering operate locally. Grading data is fetched only when its section is opened and cannot block print-run results. Search generation checks prevent late responses from replacing a newer result or Clear.

Validation covers all 4,084 existing source rows, average versus serial semantics, bounds, unsafe source URLs, duplicate preservation and out-of-order search completion. Product files have a median uncompressed size of approximately 12 KB versus the prior 1.35 MB shared shard; this is a payload comparison, not a measured wall-clock speed claim.

## Reviewed odds calculations

`data/prv-calculations/*.json` holds reviewed official odds, checklist sizes, nominal serial limits, source URLs/hashes and explicit calibration choices. `scripts/calculate-prv-odds.cjs` converts these inputs to typed PRV records at build time. This is a durable supplemental source: Sheets exports do not overwrite it. A populated v1 product with the same code or normalized name/sport takes precedence; missing or empty products can be filled from reviewed calculations.

The 2026 pilot uses 300-subject Logofractor and 150-subject Bowman Sapphire base parallel anchors. Selected non-autograph tiers must include at least three anchors, each with odds of at least 1:20 and a serial limit above 1; their implied pack totals must span at most 5% of their median. This threshold is a review gate, not a statistical confidence interval or a guarantee of actual production. A common assumption about packed serial copies can bias every anchor together. Other tiers, including one-of-ones and autographs, remain in diagnostics to expose differences rather than force agreement.

Unnumbered estimates use median inferred format packs / pack-odds denominator / checklist subjects, rounded to five copies. Autographs are explicitly checklist averages, because short-print subjects and missing tiers make uniform per-subject claims unsafe. Numbered rows have `measurement.kind=serial_limit`; their displayed count is the nominal stamped limit, not an estimate of packed copies. The public labels stay short and source paragraphs remain hidden.

An unnumbered base entry marked 1:1 is withheld: occurrence odds do not state the number of base cards per pack. Hidden Gems is also withheld because its odds are absent. No standard Chrome cards included in Logofractor boxes are attributed to Logofractor production. The index is refreshed on each visit so adding a calculated product does not depend on the legacy spreadsheet version changing.
