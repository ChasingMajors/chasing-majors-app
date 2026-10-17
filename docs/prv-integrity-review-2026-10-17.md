# PRV integrity review — 2026-10-17

## Changes

- Restored 47 numbered parallel labels: Hoops 22, Bowman Basketball 8, Signature Class 11, Three 4, Flagship Basketball 2.
- Split two populated article records into NBL Basketball (18 entries), Finest UEFA Soccer (32), Pristine Premier League (12), and Merlin Premier League (20).
- Split two empty article records into separate Inception Baseball/Basketball and Tier One/Dynasty Baseball products. They remain empty; this does not create print-run evidence.
- Existing combined-product URLs offer a choice of the two actual products. Article titles no longer appear as products in search.
- Quarantined 14 rows: eight prose/total rows in the two Sapphire products; two NBL/Finest introduction/heading rows; two duplicate base rows misclassified as autographs; two combined Pristine/Merlin base-production rows whose ownership could not be independently confirmed.
- Corrected clear Base/Autograph/Relic category mistakes. Original numeric values, stamps, checklist counts, and raw source records are unchanged.
- Show “Numbered only” for entries with a serial limit and no production count. The stamp remains in the Numbered column; it does not become a print-run estimate.
- Recalculate duplicate warnings using both identity and serial limit. Missing identities receive their own review flag.

## Evidence and limits

Reviewed parallel labels and serial specifications:

- https://www.checklistinsider.com/2025-26-topps-nba-hoops-basketball
- https://www.checklistinsider.com/2025-26-bowman-basketball
- https://www.checklistinsider.com/2025-26-topps-signature-class-basketball
- https://www.checklistinsider.com/2025-26-topps-3-basketball
- https://www.checklistinsider.com/2025-26-topps-basketball

Hoops' two complete serial ladders retain their separate hobby/retail context. Identical Bowman /99 and /10 entries and Signature Class /25 and /10 entries are held. Signature /175 is Indigo, not the cached CV label Lime. Three's existing /50 conflicts with the Red /5 specification; its limit is not silently rewritten. Flagship entries sharing the same stamp are held when the raw row cannot distinguish the parallel.

Topps' official Pristine and Merlin product pages establish product identity. CV's Merlin code uses 2025-26; Topps markets it as Merlin Premier League 2026. The established CV code is retained, with the public title using 2026. Existing production values are reorganized, not independently recalculated in this pass.

The combined articles' raw record boundaries and product-specific subset names support the split. A fresh anonymous request to the NBL/Finest article did not expose its full paid table, so no missing production values were reconstructed from that response. Ambiguous base-production ownership remains held for source-table review.

## Rebuild protection and validation

`data/prv-integrity-reviews.json` stores exact source-row fingerprints and reviewed actions. A changed export invalidates its positional corrections and produces a stale-review record rather than applying them to different rows. `data/v2/vault/integrity-review.json` records applied actions, quarantined original rows, stale reviews, and unresolved identities. It is a review artifact and is not fetched or rendered by the public PRV UI.

The public raw v1 source is preserved. Corrections run after checklist-size enrichment and before hashed v2 publication. The workflow includes the correction catalog so a future rebuild retains the reviewed fixes when source rows are unchanged.

49 automated tests pass, including numeric/raw preservation, complete split accounting, stale-review rejection, unresolved identities, old-link routing, and search response ordering. Browser checks cover a separated NBL result and the legacy combined-product chooser.

## Remaining work

114 rows still have unresolved generic identities (including generic Chrome and other labels beyond the original 95 Base-style rows). These are recorded in the integrity review. Production accuracy is not established merely by fixing a label. The six originally empty priority products still need evidence-backed PRV records. Stale reviews are recorded in build output; operator notifications and stricter source-import validation are separate follow-up work.

## Live verification

Feature commit `9471516`. GitHub Pages run `39039537814` and structured-data run `39039538177` both succeeded. The live structured index and all 11 affected nonempty product payloads match the reviewed local JSON exactly. Browser validation confirms restored Hoops parallel labels, numbered-only presentation, and retained checklist counts. The source export and CV data were not modified.
