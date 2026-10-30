# STAGED exact recovery, Option 1

This recipe reconstructs the existing accepted artifact. It never deploys and
never changes its expected hash. Kiro must verify the two independent cold proofs
before this is called qualified recovery. Production actions remain owner-only.

## Inputs preserved in Git

`target.json` pins the complete source commit (not just its canonical-data base),
Node 24.22.1, canonical search digest, original build timestamp, manifest hash,
logical size/file count and **unchanged** accepted tree hash `6a4bbf51…`.
The reference JSON files are original reviewed consumer outputs, not fabricated
product data. The recipe records its own Git commit and file-content digest.

The original gzip frame's informational OS byte was 19 on macOS versus 3 on Linux.
Normalizing only that byte in the original 3,348 local gzip files reproduced ALL
3,348 hosted content-addressed hashes: compressed payloads were already equal.
`canonical-runtime.cjs` standardizes the accepted legacy header (zero mtime,
fixed OS=19) and binary directory enumeration. It changes no decoded data.

For this historical format only, the recipe restores the original root directory
key order with `canonical_sha256` last. It rejects extra/missing fields rather
than dropping any. It also uses the original timestamp and exact source SHA;
otherwise a byte-exact artifact including its release manifest cannot match.

## Run under pressure

1. Clone this recipe's reviewed Git commit from the isolated staging branch (or
   its eventual approved main commit). Install the pinned Node 24.22.1 runtime.
   Use a machine with Git/network access to the existing public repository,
   several GB of free build space and sufficient memory for offline assembly.
2. Run from that checkout, choosing a NEW path OUTSIDE it:

   ```sh
   node .github/recovery/rebuild.cjs /absolute/new-recovery-workspace
   ```

   On the Codex Mac, `CM_RECOVERY_GIT` can point at the bundled Git binary and
   `GIT_EXEC_PATH` at its matching libexec directory. These are executable paths,
   not credentials. No write credential is needed for the fresh public fetch.
3. The command fetches **exact commit 2666602… from remote Git**, creates fresh
   SQLite/index state, generates compressed files, applies the historical framing
   and serialization rules, assembles at the pinned timestamp, and verifies:
   - exact tree `6a4bbf51e5e9f596096d92354ca09f0bda32e357002d64ee2903333de1238495`;
   - manifest `e95e3972b55ce2b9fce7b9b7ecde5fc4ed9faa1da277672cf44df2090ab0c5cd`;
   - 544,097,991 logical bytes / 5,570 files, below the UNCHANGED 1 GB guard;
   - actual restored HTTP consumer outputs byte-identical to reviewed references
     (Trout years incl. 2018, full 2018 rows 508, Owen 54/page-two 4, Topps 470,710).
4. Require `recovery-proof.json` AND `parity.json` to say PASS. A missing/mismatched
   hash, count, source, field or fixture stops recovery. Do not change the target
   receipt, reuse cached derived data or publish after a failure.
5. Only after the owner explicitly approves a recovery deployment may Codex deploy
   the resulting `site/` through the validated artifact route; Kiro verifies live.

An existing local archive is an optional faster path, not an off-machine backup.
This recipe is for the historical bootstrap target, not permission to overwrite
newer production data. Each future recovery target must pin its own source and
receipt. Freshness reconciliation remains required before a first cutover.

The staged normal build workflow also uses the canonical gzip runtime, after
checkout only, and pins Node 24.22.1. The runtime is kept under `.github/`, excluded
from served assets. No D1, Sheets, billing/auth or deployment operation is present.
