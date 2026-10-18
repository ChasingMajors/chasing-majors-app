# SPx source identity repair

The indexed authoring product and all 718 checklist rows use 2025_26_upper_deck_spx_hockey_card. All 58 source parallel rows used orphan code 2025_26_upper_deck_spx_hockey, with no matching Products row. This made the indexed checklist export omit its parallels.

Read-only capture verified every parallel section/subset exists in the 718-row source. A stable full-row hash matches the stored indexed checklist exactly. A guarded owner repair backed up the 58 rows and changed only their code cells, preserving all serial values, labels, scopes and checklist rows. Post-write verification rebuilt the source product and confirmed 718 rows and 58 unchanged parallels. Private backup: 1-udQbPaiRNeHTm1vyz6q57LjVKm6CNLH.

A checksum-pinned reviewed parallel patch gives exported payloads the same 58 scoped parallel records and survives future source refreshes without overwriting conflicting source values. The older 865-row, 48-parallel legacy payload remains preserved under its existing code. It has unique material and is not blindly merged or redirected. The discoverable indexed checklist retains its existing URL/code.

The repair uses the user's authoring data; the [Upper Deck checklist](https://upperdeck.com/checklist/2025-2026-spx-checklist/) identifies the product. This code alignment does not claim a new manufacturer verification of every serial limit. All 72 app tests pass, and a local owner-helper fixture checks preflight, backup, exact-value preservation, repeated execution, changed-source rejection and rollback.

## Full source import and publishing verification

The v7-r3 read-only preview contains 965 real card records and 58 parallels. Every card-number/player pair matches Upper Deck's published checklist (`https://upperdeck.com/checklist/2025-2026-spx-checklist/`). The previous 718-row payload omitted 247 real update cards. Nested headings are now preserved as distinct year/subset scopes; odds and serial headings are excluded as cards. The source's stated seven 2022-23 UD Black update cards resolve to six listed cards, matching Upper Deck; no seventh card was invented.

Owner execution validated exactly one Products record, 965 ChecklistRows and 58 Parallels, with recoverable snapshot `1pDa2RoEMWaVmS08pLkkn5djKWmJhikjfXcS4YuH7f18`. Job `owner-spx-alignment-20261018-a` committed on attempt one as `58f53c7a2c4375e540476e7974ebd33620714969`. GitHub exact release/content verification succeeded. Expected product SHA-256: `53ea6226bf140d9c17c31ac7164e4cb933510f8b8c5e9a0adac466f7b794ced2`.

The original parallel alignment patch was refreshed to the same verified 58 parallels after the full import changed the subset display labels. This keeps the direct product and search copies synchronized with the authoritative mapped source and prevents the older review snapshot from blocking derived builds. Legacy SPx data and links remain available.

A fresh publish also exposed a derived-build compatibility defect: the reviewed-checklist builder recreated search records with fewer fields and a shorter search blob. The card data remained correct, but the publish job's exact search hash then failed after CI ran. `buildSearchRows` now retains the publisher's full search schema and metadata. All 966 SPx search records reproduce the original release's stable hash exactly (`3c65f2fb873f37fc9fe4b576dca0ed4f8de8207e82ba34ddf4e67224dc2c68ac`). Regression coverage checks complete fields, blank-player behavior, tags and source-row preservation; all 74 app tests pass.
