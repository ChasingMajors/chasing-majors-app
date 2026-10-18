# Distinct product name review — October 18, 2026

Two duplicate display-name groups are distinct products and were corrected without merges or code changes.

| Code | Correct name | Distinguishing evidence |
|---|---|---|
| 2021_bowman_mega_box_chrome_baseball | 2021 Bowman Mega Box Chrome Baseball | Spring release: BCP-1 Bobby Witt Jr., Futurist and Rookie of the Year Favorites. The separate Chrome Mega Box release starts BCP-151 Victor Acosta and includes Dawn of Glory. |
| 2025_Panini_Prizm_Black_Football | 2025 Panini Prizm Black Football | Base Prospects/Extended, Prizmatrix, Manga and Color Blast match Prizm Black. Separate Black product includes Capstones, Vanta and Smokescreen. |

References: [Bowman Mega Box Chrome](https://www.checklistcenter.com/2021-bowman-mega-box-chrome-baseball-card-checklist/), [Bowman Chrome Mega Box](https://www.beckett.com/news/2021-bowman-chrome-mega-box-baseball-cards/), [Prizm Black checklist](https://www.checklistinsider.com/2025-panini-prizm-black-football), [Prizm Black corroboration](https://www.beckett.com/news/2025-panini-prizm-black-football-cards/).

Checksum-pinned metadata rules update display names, product labels and keywords across mapped payloads, direct payloads, the global index and search. Old keywords are retained. Codes, seasons, manufacturer, card IDs, rows and parallels stay unchanged. A later source metadata change is preserved and reported for review. Rules cannot change code, sport or year.

Validation: 71 tests passed. Hashes verify all 903 affected card rows and 127 parallel rows unchanged. Forty-four unrelated products and unrelated rows in three search shards were preserved. A second apply changed no files and reported no conflicts. The identity audit now reports zero duplicate normalized CV names; stored catalog counts remain 762,564 cards and 58,683 parallels. This is not a catalog-wide manufacturer or COMC certification.

## SPx held for reconciliation

The active legacy SPx payload has 865 stored rows and 48 parallels; the indexed _card version has 718 rows and no parallels. Comparing unique card-number/player/team triples gives 565 shared, 181 legacy-only and 34 _card-only triples. These are comparison keys, not physical-card or checklist-size estimates. The current authoring Sheet uses a third code, 2025_26_upper_deck_spx_hockey. Do not collapse these versions or redirect old codes until current source rows, subset scopes and parallel coverage have been reconciled. No SPx records were removed or merged in this pass.

The remaining eight CV/PRV display-name differences, player alias candidates and manifest/index discrepancies remain separate review work.

## Authoring sources

The owner preflight uniquely matched both Products rows (Baseball 2021 row 77; Football 2025 row 3). A verified private Drive snapshot was saved before changing six cells: display_name, product and keywords for each product. Backup ID: 1B2UQlebPgZqPXmrQuXpeZIHxgthVlsc1. The apply receipt verified all six values and plain-text formats. No card or parallel Sheet row was edited. Temporary owner repair functions are isolated from Code.gs; the deployed exporter version is unchanged.
