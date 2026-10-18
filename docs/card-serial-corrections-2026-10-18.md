# Verified CV serial corrections — October 18, 2026

All ten priority serial cases from the identity audit were independently reviewed and corrected across four products. Product codes, names, card IDs, card rows, parallel identities/counts, PRV estimates and existing links were preserved.

| Product code | Group | Previous | Corrected |
|---|---|---|---|
| 2023_topps_chrome_platinum_anniversary_baseball | Auto — SuperFractor | Corrupted date | /1 |
| 2025_26_spx_hockey | Base — Gold Spectrum | Corrupted date | /1 |
| 2025_26_spx_hockey | Base Rookies — Gold Spectrum | Corrupted date | /1 |
| 2025_26_spx_hockey | Base Hologram Rookies — Gold | Corrupted date | /1 |
| 2025_26_spx_hockey | Finite Auto — Spectrum | Corrupted date | /1 |
| 2025_26_spx_hockey | Finite — Gold Spectrum | Corrupted date | /1 |
| 2025_26_topps_signature_class_basketball | Base — Yellow | /199 | /399 |
| 2026_Topps_Finest_Premier_League_Soccer | Finest Autographs — Blue Refractor | /150 | /99 |
| 2026_Topps_Finest_Premier_League_Soccer | Finest Autographs — Green Refractor | /99 | /75 |
| 2026_Topps_Finest_Premier_League_Soccer | Finest Moments Autographs — Green Refractor | /99 | /75 |

## Evidence

- Upper Deck manufacturer checklist: https://upperdeck.com/checklist/2025-2026-spx-checklist/ . The relevant Gold Spectrum, Hologram Gold and Finite Spectrum autograph groups carry serial ceiling 1; the review checked the numbered column, not pack odds. Snapshot hash is stored in the hockey correction rule.
- Topps Signature Class manufacturer sales sheet, distributor-hosted copy: https://www.blowoutcards.net/images/ss/25tpsignatureclassBK.pdf . Page 7 paper-base matrix distinguishes Yellow /399 from Chrome Yellow /275; only the paper-base target was changed.
- COMC 2023 Platinum autograph parallel matrix: https://www.comc.com/Cards/Baseball/2023/Topps_Chrome_Platinum_Anniversary_-_Autographs_-_Green_Refractor/CPA-WBR/Will_Brennan/25825940 . Superfractor /1 is corroborated by https://www.tcdb.com/Checklist.cfm/sid/433620/2023-Topps-Chrome-Platinum-Anniversary---Autographs-SuperFractors . No original serial was inferred from the date value itself.
- Finest serial reference: https://www.checklistinsider.com/topps-finest-premier-league , corroborated by https://degreegrading.com/checklists/2025-26-topps-finest-premier-league-soccer/ . It distinguishes Sky Blue /150, Blue /99, Green /75 and Finest Moments Green /75. The prior manufacturer odds/checklist review establishes product and subset identity; odds were not used as serial limits.

## Durable correction rules

Four checksum-pinned inputs in data/cv-reviewed-imports specify exact before/after parallel rows and evidence. The build applies them to the existing mapped shard and the direct CV payload. Corrected source exports are no-ops. If a future export changes or removes the target, the rule preserves that source and reports a conflict; it does not guess or resurrect rows. Duplicate scopes and attempted identity changes fail before files are written. Object property order does not affect matching.

Search rows for the four products were consolidated into the existing reviewed-product search format. Card counts were verified against source rows, and unrelated rows in six affected search shards were preserved. The large textual diff includes moved search entries, not deleted cards.

## Validation

All 69 tests passed. The full repeat audit reports zero date-corrupted serial fields and zero detected CV/PRV serial conflicts. CV card rows remain 762,564 and parallel rows remain 58,683. Applying the rules twice changed no files on the second run and produced no conflicts. Four product payloads match their direct CV copies. Exactly ten serial fields changed; card rows and metadata were unchanged.

The separate naming/player-alias and duplicate-product review remains pending. These changes update published JSON and durable build rules; they do not rewrite the authoring Google Sheets.

## CV display matching

The live check found Base parallels hidden when a source used Base and the UI requested [Base]. The CV matcher now treats those two labels as equivalent within the same section. Named checklists such as Base Blackout and autograph sections remain separate. A regression fixture verifies the corrected list and prevents cross-subset leakage.

## Authoring source alignment

A prepared owner-only preflight/repair can align the ten authoring Sheet cells using reviewed values, plain-text formats, a private recovery snapshot and rollback on verification failure. Local fixtures pass preflight, idempotence, changed-source rejection and rollback. It has not run against the real Sheets: the native Chrome owner connection timed out, and no connected Sheets document session was available. No authoring Sheet or Apps Script source was changed. This source alignment remains pending and matters because an exporter receipt validates the exact source content; a later build correction can differ from that receipt until the source itself is corrected.
