# PRV source replacement reconciliation

The user confirmed the replacement PRV export is intentional and finished. Preserve its deletions and changed rows. Do not restore prior rows or reuse stale positional label corrections.

Three reviewed snapshots changed. Four reviewed actions were remapped by unique, complete raw-row fingerprints: two Hoops labels and two Topps Basketball entries. Twenty Hoops actions match multiple identical raw rows; those measurements remain intact with an unresolved-identity flag rather than an inferred parallel label. Historical rules remain archived with their evidence. Cleared combined NBL/Finest content yields empty canonical product choices, retaining old links without resurrecting discarded production data.

Historical correction/split tests now use a fixed, checksum-addressable source snapshot from commit a18d00e, rather than assuming the mutable production export has unchanged row positions. Separate current-source tests still require zero stale fingerprints, preservation of every input row across output/quarantine, no guessed ambiguous labels, and no restored cleared rows. The converter test checks every source row and unique generated identity; an obsolete absolute requirement for more than 4,000 source records was removed after the user-approved reduction.

Validation: 72 tests pass. The rebuilt catalog has 124 product targets and 3,176 stored rows. The raw source files were not modified. Count changes reflect the accepted replacement export. Twenty ambiguous Hoops label mappings remain explicit source-review work.
