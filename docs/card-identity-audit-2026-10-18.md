# CV / PRV identity audit — October 18, 2026

## Scope

Scanned active manifests: 1,043 CV product targets, 762,564 card rows, 58,683 parallel rows, 124 structured PRV products and 4,946 PRV rows. These are stored row counts, not distinct physical-card counts. Historical orphan files were excluded. No mapped CV payload was missing. The global CV index contains 1025 entries and is not identical to the sport-manifest inventory.

## Applied correction

Two 2026 Topps Chrome Sapphire Baseball Padparadscha autograph rows had raw serial 1/1 but null structured serial limits. Both now normalize to numeric 1 and display /1. All 26 source records, record IDs, names, checklist sizes and measurement values/kinds were preserved. No source Sheet or v1 row was rewritten.

The shared PRV converter now accepts only positive integer catalog limits and explicit one-of-one forms. Specimen numbers such as 23/99, odds such as 1:99, fractional/nonpositive limits, footnotes and qualified maximums are not silently turned into exact limits. Conflicting exact field/label serials are flagged. Raw evidence remains intact.

## Review backlog

| Finding | Count | Interpretation |
|---|---:|---|
| CV serial fields containing dates | 6 | Source corruption; do not infer the original serial from January 1 |
| Candidate CV/PRV serial conflicts | 4 | Exact parent/parallel label candidates disagree; verify eligibility and manufacturer references |
| Different CV/PRV product display names | 8 | Includes capitalization, punctuation, omitted sport and a year/season difference |
| Duplicate normalized CV product names | 2 groups | Distinct codes need identity review before merging |
| Candidate player spelling/punctuation aliases | 1,741 groups | Includes accents and trailing commas; not confirmed player-identity errors |
| PRV products without an exact CV match | 17 | Not proof of absent checklists; reviewed crosswalk needed |
| CV manifest entries absent from global index | 28 | Reconcile aliases and inventory before claiming missing content |
| CV global-index entries absent from sport manifests | 10 | Reconcile direct/legacy routing and source availability |

The six dates affect 2023 Topps Chrome Platinum Anniversary SuperFractor (Auto) and five 2025–26 SPx Hockey groups. The four serial conflicts affect Signature Class Basketball Base Yellow (CV /199 vs PRV /399), and three Finest Premier League autograph parallels. Duplicate-name groups are 2021 Bowman Chrome Mega Box and 2025 Panini Black Football; the latter includes a code containing Prizm Black, so an automatic merge would be unsafe.

CV serial formats include 752 footnoted values, 256 decorated values, 18 print-run labels in serial fields and 7 other unparsed values. Footnotes and ceilings may carry valid meaning and are not all errors.

## Naming policy for reviewed cleanup

Use manufacturer checklist/odds terminology for products, subsets, parallel scope and serial ceilings. Use COMC as an independent cross-reference and alias source. Retain stable product codes and card IDs; store canonical display names and aliases separately. Preserve player accents and Jr./Sr. suffixes, product season/year, language, edition and league. Keep parent subset and parallel separate internally; display can combine them. Keep nominal serial ceilings separate from estimated copies reaching packs.

COMC's [Green Refractor example](https://www.comc.com/Cards/Baseball/2025/Topps_Chrome_Black_-_Base_-_Green_Refractor/4/Rafael_Devers/29062882) illustrates a product → base → parallel → player → /99 display. This is a format reference, not verification of every catalog record. The catalog-wide COMC/manufacturer reconciliation is still pending; this audit did not scrape or certify all external names. Existing manufacturer-reviewed [Finest odds](https://cdn.shopify.com/s/files/1/0739/2015/1805/files/PL_FINEST_ODDS_Official.pdf?v=1774262754) and [checklist](https://cdn.shopify.com/s/files/1/0739/2015/1805/files/Finest_Premier_League_Checklist.pdf?v=1774359572) are the starting references for its serial conflicts.

## Repeatability and validation

Run node scripts/audit-card-identities.cjs <report.json>. The data workflow runs this read-only audit and uploads a card-identity-audit artifact for future exports. Candidates are not automatic merges or release-blocking errors. All 64 tests passed, including exact/ambiguous serial handling, source preservation, conflicting serial flags, suffix/year identity distinctions and non-Latin name preservation.

The machine reports contain the full candidate lists. This pass fixes the two unambiguous PRV serial conversions; the flagged CV names, player variants, index discrepancies and serial conflicts remain review work.
