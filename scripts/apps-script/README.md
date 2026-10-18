# Apps Script — player-meta exporter (deploy-only)

`export-player-meta.gs` is **deploy-only source**. It is stored in this repo for
reference and versioning; it does **not** run from here. It cannot execute against
live Google Sheets or GitHub in this working copy. To use it, copy it into the
exporter's Apps Script project (the one that hosts
`command-center/static-exporter/Code.gs`) and deploy it there.

## What it does

`publishPlayerMetaToGitHub()` runs the same aggregation as the exporter's
`handlePlayerMetaIndex_` (helpers `extractPrimaryPlayerName_`,
`isLikelySoloPlayerName_`, `isSafeSoloRcRow_`, `normalize_`,
`sanitizeYearsArray_`) and commits the result to
`data/v1/players/player-meta.json` through the atomic GitHub PUT-with-sha
contents path (`getGitHubFileSha_` + `putGitHubJsonFileBase_`).

Output shape (identical to the local builder):

```json
{
  "ok": true,
  "source": "player-meta-export",
  "generated_at": "<ISO 8601>",
  "players": [
    {
      "sport": "baseball",
      "player_key": "aaron judge",
      "player_name": "Aaron Judge",
      "checklist_years": [2026, 2025],
      "rc_year": 2017,
      "rc_year_confidence": "high"
    }
  ]
}
```

## Why it is precomputed

Player metadata used to be resolved by a per-request scan of the full checklist
corpus. That scan routinely ran ~20s and tripped 403s, so the feature was
effectively dead. Precomputing the index to a static JSON file replaces that
scan with a cheap static `200`, and the ChatBot falls back silently if the file
is missing.

Run it **on a schedule** (e.g. a daily time-driven trigger) and/or **after each
checklist import** so the index stays current.

## Required Script Properties

Set these exact names (NOT `CM_GITHUB_*`) in the Apps Script project
(Project Settings → Script Properties):

| Property        | Purpose                                             | Default           |
| --------------- | --------------------------------------------------- | ----------------- |
| `GITHUB_TOKEN`  | Token with `contents:write` on the repo. Required.  | — (required)      |
| `GITHUB_OWNER`  | Repo owner.                                          | `ChasingMajors`   |
| `GITHUB_REPO`   | Repo name.                                           | `chasing-majors-app` |
| `GITHUB_BRANCH` | Target branch.                                       | `main`            |

## Deploy steps

1. Open the exporter Apps Script project.
2. Add `export-player-meta.gs` (or paste `publishPlayerMetaToGitHub()` and its
   helpers). If the project already defines the GitHub helpers or the
   aggregation helpers, keep a single copy and remove the duplicates.
3. Set the Script Properties above.
4. Run `publishPlayerMetaToGitHub()` once to authorize scopes
   (external requests / `UrlFetchApp`).
5. Add a time-driven trigger and/or call it at the end of the checklist-import
   routine.

## The committed JSON in this repo

`data/v1/players/player-meta.json` checked into this repo was generated
**locally** by `scripts/build-player-meta.cjs` from the published checklist data
under `data/v1/checklists/products/`. It was **not** produced by this Apps Script.
Regenerate it locally with:

```sh
export PATH="/Users/chasingmajors/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
node scripts/build-player-meta.cjs
```
