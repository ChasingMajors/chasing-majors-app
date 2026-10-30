# STAGED bounded-search artifact

Offline derived build only. No network, D1 or source-data writes. Node 24+ is
required for local `node:sqlite`. Use an empty workspace outside this checkout;
set `TMPDIR` and `SQLITE_TMPDIR` to a writable temporary directory there.

```
CM_QUERY_WORK=/absolute/workspace node scripts/search-query/build.cjs
CM_QUERY_WORK=/absolute/workspace node scripts/search-query/grams.cjs
node scripts/search-query/artifact.cjs stamp . /absolute/workspace/derived
```

Then pass `queryDirectory: '/absolute/workspace/derived'` to
`content-release.cjs`'s `assemble` API. This binds the index to every canonical
search source hash, rejects stale/altered chunks and includes only referenced
compressed assets in the immutable release. The optional directory is deliberately
not wired into any production workflow yet (Gate 5 remains blocked).

The directory preserves original normalized variants, source pointers and order.
CV deduplication happens after filtering; ChatBot ownership follows its original
before-filter rule. 1,024-row chunks, compact name/year maps and substring-safe
gram bitmaps avoid complete-sport materialization. The client keeps bounded
weighted caches and a bitset for CV deduplication; deeper pages use repeated scans
rather than allocating an unbounded sorted list.

The full independent coverage proof, old/new output diffs and fixed-budget
acceptance harness are retained in the rollout evidence directory. They are
required before promoting a newly generated directory. This is not a deployment
or a declaration of real-phone certification.
