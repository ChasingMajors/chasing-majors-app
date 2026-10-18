# SPx source identity repair

The indexed authoring product and all 718 checklist rows use 2025_26_upper_deck_spx_hockey_card. All 58 source parallel rows used orphan code 2025_26_upper_deck_spx_hockey, with no matching Products row. This made the indexed checklist export omit its parallels.

Read-only capture verified every parallel section/subset exists in the 718-row source. A stable full-row hash matches the stored indexed checklist exactly. A guarded owner repair backed up the 58 rows and changed only their code cells, preserving all serial values, labels, scopes and checklist rows. Post-write verification rebuilt the source product and confirmed 718 rows and 58 unchanged parallels. Private backup: 1-udQbPaiRNeHTm1vyz6q57LjVKm6CNLH.

A checksum-pinned reviewed parallel patch gives exported payloads the same 58 scoped parallel records and survives future source refreshes without overwriting conflicting source values. The older 865-row, 48-parallel legacy payload remains preserved under its existing code. It has unique material and is not blindly merged or redirected. The discoverable indexed checklist retains its existing URL/code.

The repair uses the user's authoring data; the [Upper Deck checklist](https://upperdeck.com/checklist/2025-2026-spx-checklist/) identifies the product. This code alignment does not claim a new manufacturer verification of every serial limit. All 72 app tests pass, and a local owner-helper fixture checks preflight, backup, exact-value preservation, repeated execution, changed-source rejection and rollback.
