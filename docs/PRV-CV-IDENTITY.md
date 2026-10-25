# CV-backed PRV product identity

The approved CV index is authoritative for shared product identity: Code,
DisplayName, year, sport, manufacturer and product family. PRV owns its print-run,
serial, checklist-size and provenance records. Those values are not copied from CV.

`shared/prv-cv-identity.cjs` runs after PRV source conversion, calculations,
checklist-size enrichment and integrity review. Keeping that order preserves
existing source-code/hash-scoped review rules. The raw v1 export and authoring
Sheets remain intact; canonical identities are applied to the public v2 view.
Do not bulk-rename source Sheet codes until source-scoped reviews and enrichment
lookups have been migrated and legacy aliases persisted independently.

A product may adopt CV metadata only with one exact sport/code match or one exact
name/year/sport match. Same-code name conflicts, duplicate targets, missing CV
metadata and explicitly held CV records remain `identity_status: needs_review`.
No fuzzy match is automatically promoted. Passing records carry
`identity_status: compliant`, with their metadata and structured row identifiers
using the CV code. Original raw row evidence remains untouched.

The additive `data/v2/vault/identity-review.json` report separates compliant,
changed and held records. Held products remain available under existing identifiers
while review proceeds. Their presence is not a claim of full catalog compliance.

Old codes resolve through one-target aliases in the structured index. Existing
multi-product split aliases retain their selection behavior. New canonical aliases
must not shadow current codes or point to missing products.

The second reviewed pass resolves the 27 initial exceptions: four CV metadata
repairs and 23 explicitly guarded identity mappings. Of 127 PRV product identities,
116 are CV-indexed and 11 have reviewed metadata-only catalog identities. Those 11
do not acquire invented CV checklist rows, links or counts. The published registry
is `data/v2/vault/product-registry.json`; `cv_indexed: false` and `identity_only: true`
identify those coverage gaps. All 5,612 PRV rows survive.

The general Cactus Jack release remains separate from its NBA All-Star edition.
Mars Attacks Christmas is non-sport. Samurai Japan's analysis-article label maps to
the Chrome collection after matching the official 74-card base, six short prints
and named inserts. Source maintenance may replace metadata with the complete
canonical metadata while retaining legacy source codes as aliases; partial changes
to reviewed identities are held for another review.
