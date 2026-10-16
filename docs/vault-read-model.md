# Print Run Vault read model

The source of truth remains the existing Sheets exporter and data/v1 files. The new data/v2/vault view is additive; no v1 records or source cells are rewritten.

Run `node --test tests/*.test.cjs` and `node scripts/build-vault-data.cjs` after source changes. The GitHub workflow performs this automatically for source exports, publishes only the derived view, and requests an existing GitHub Pages rebuild. It retries from the latest main if an exporter writes concurrently.

Each product has a content-hashed file and an index entry. The index records the original vault_version. The browser checks this revision before using the derived view, falling back to the latest v1 manifest/shard when the view is stale or unavailable. Failed fetches are evicted from the in-memory cache so Search can retry.

A row preserves its complete `raw` record. The additive fields separate count value/kind/scope, nominal serial limit, checklist size, category, source URL and quality flags. Missing provenance stays unspecified. Reported legacy counts are never promoted to exact counts. Serial limits come only from a numeric serial field or an explicit parenthesized /N label; they never replace estimated pack availability. Row IDs identify source positions; group IDs identify matching normalized labels, not a guaranteed checklist parallel identity.

Checklist links require a unique exact normalized product name and sport. Ambiguous/missing matches remain unlinked. This is deliberately conservative; a complete shared set/parallel registry still requires reviewed mappings.

The public interface shows data and concise count labels. Source paragraphs and source links remain in stored records only, per the product owner's preference. Filters, sorting and incremental rendering operate locally. Grading data is fetched only when its section is opened and cannot block print-run results. Search generation checks prevent late responses from replacing a newer result or Clear.

Validation covers all 4,084 existing source rows, average versus serial semantics, bounds, unsafe source URLs, duplicate preservation and out-of-order search completion. Product files have a median uncompressed size of approximately 12 KB versus the prior 1.35 MB shared shard; this is a payload comparison, not a measured wall-clock speed claim.
