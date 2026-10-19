/**
 * export-player-meta.gs — DEPLOY-ONLY Google Apps Script source.
 *
 * WHAT THIS IS
 * ------------
 * A precomputed publisher for data/v1/players/player-meta.json. It runs the
 * SAME aggregation as the exporter's handlePlayerMetaIndex_ (extractPrimaryPlayerName_,
 * isLikelySoloPlayerName_, isSafeSoloRcRow_, normalize_, sanitizeYearsArray_) and
 * commits the result to GitHub through the atomic PUT-with-sha contents path
 * reused from command-center/static-exporter/Code.gs.
 *
 * WHY IT EXISTS
 * -------------
 * The ChatBot previously resolved player metadata with a per-request scan of the
 * full checklist corpus. That scan routinely took ~20s and tripped 403s, so the
 * feature was effectively dead. This precomputes the index once (on a schedule or
 * after a checklist import) and serves it as a static JSON file, so the live path
 * is a cheap 200 instead of a slow/failing scan.
 *
 * DEPLOY-ONLY — THIS FILE DOES NOT RUN HERE
 * -----------------------------------------
 * This source lives in the chasing-majors-app repo for reference and versioning.
 * It cannot execute against live Google Sheets or GitHub from this repo. To use it,
 * copy it into the exporter's Apps Script project and deploy there. The committed
 * data/v1/players/player-meta.json in this repo was generated locally by
 * scripts/build-player-meta.cjs from the published checklist data — NOT by this script.
 *
 * DEPLOY STEPS
 * ------------
 *   1. Open the exporter Apps Script project (the one holding command-center/static-exporter/Code.gs).
 *   2. Add this file (or paste publishPlayerMetaToGitHub() and the helpers below).
 *      If the project already defines these helpers, drop the duplicates and keep one copy.
 *   3. Set the Script Properties listed under REQUIRED SCRIPT PROPERTIES.
 *   4. Run publishPlayerMetaToGitHub() once manually and authorize the scopes
 *      (External requests / UrlFetchApp).
 *   5. Add a time-driven trigger (e.g. daily) and/or call it at the end of your
 *      checklist-import routine so the index stays current.
 *
 * REQUIRED SCRIPT PROPERTIES (exact names — NOT CM_GITHUB_*)
 * ---------------------------------------------------------
 *   GITHUB_TOKEN   — PAT/fine-grained token with contents:write on the repo.
 *   GITHUB_OWNER   — repo owner (defaults to "ChasingMajors").
 *   GITHUB_REPO    — repo name  (defaults to "chasing-majors-app").
 *   GITHUB_BRANCH  — target branch (defaults to "main").
 *
 * OUTPUT (identical shape to scripts/build-player-meta.cjs)
 * ---------------------------------------------------------
 *   { ok: true, source: "player-meta-export", generated_at: <ISO>,
 *     players: [ { sport, player_key, player_name, checklist_years, rc_year, rc_year_confidence } ] }
 */

/* global PropertiesService, UrlFetchApp, Utilities, Logger */

var PLAYER_META_REPO_PATH = 'data/v1/players/player-meta.json';
var PLAYER_META_PRODUCTS_DIR = 'data/v1/checklists/products';
var CM_GITHUB_API_RETRIES = 5;
var CM_GITHUB_API_RETRY_PAUSE_MS = 750;

/**
 * Entry point. Aggregates the published checklist products into the player-meta
 * index and commits it to GitHub via the atomic PUT-with-sha path.
 */
function publishPlayerMetaToGitHub() {
  var players = buildPlayerMetaIndex_();
  if (!players.length) {
    throw new Error('player-meta aggregation produced 0 players; refusing to publish empty index.');
  }

  var payload = {
    ok: true,
    source: 'player-meta-export',
    generated_at: new Date().toISOString(),
    players: players
  };

  var withRc = players.filter(function (p) { return p.rc_year !== null; }).length;
  var result = putGitHubJsonFileBase_(
    PLAYER_META_REPO_PATH,
    payload,
    'chore: publish player-meta.json (' + players.length + ' players, ' + withRc + ' with rc)'
  );

  Logger.log('Published ' + PLAYER_META_REPO_PATH + ' players=' + players.length + ' withRc=' + withRc + ' commit=' + result.commit);
  return result;
}

/* =========================
   Aggregation (mirrors handlePlayerMetaIndex_)
========================= */

function buildPlayerMetaIndex_() {
  var products = readPublishedProducts_();
  var agg = {};

  products.forEach(function (product) {
    var meta = (product && product.meta) || {};
    var sport = normalize_(meta.sport || '');
    var year = String(meta.year == null ? '' : meta.year).trim();
    if (!year) return;

    var rows = (product && product.rows) || [];
    rows.forEach(function (row) {
      var playerName = extractPrimaryPlayerName_(row.player || '');
      if (!playerName) return;

      var playerKey = normalize_(playerName);
      if (!playerKey) return;

      var aggKey = sport + '|' + playerKey;

      if (!agg[aggKey]) {
        agg[aggKey] = {
          sport: sport,
          player_key: playerKey,
          player_name: playerName,
          checklist_years: {},
          rc_year_candidates: {},
          // Count of base-RC-token rows per product year. The COUNT (not just
          // the presence of a year) is what lets the confidence rule tell a
          // genuine rookie year (dozens of RC-tagged products) from a stray
          // late insert still tagged bare `RC` (one or two rows years after the
          // player debuted). See the confidence rule below.
          rc_year_counts: {}
        };
      }

      agg[aggKey].checklist_years[year] = true;
      if (isSafeSoloRcRow_(row)) {
        agg[aggKey].rc_year_candidates[year] = true;
        var rcYearNum = toYearNumber_(year);
        if (rcYearNum !== null) {
          agg[aggKey].rc_year_counts[rcYearNum] = (agg[aggKey].rc_year_counts[rcYearNum] || 0) + 1;
        }
      }
    });
  });

  var players = Object.keys(agg).map(function (aggKey) {
    var p = agg[aggKey];

    var checklistYears = uniqueArray_(
      sanitizeYearsArray_(Object.keys(p.checklist_years))
        .map(toYearNumber_)
        .filter(function (y) { return y !== null; })
    ).sort(function (a, b) { return b - a; });

    var rcCandidates = sanitizeYearsArray_(Object.keys(p.rc_year_candidates))
      .map(toYearNumber_)
      .filter(function (y) { return y !== null; })
      .sort(function (a, b) { return a - b; });

    // rc_year + confidence rule. The candidate year is the earliest product
    // year that carries a genuine base-RC TOKEN (the token gate in
    // isSafeSoloRcRow_ already removes the old `PRC`/`Rookie …` insert false
    // positives). But a whole-token `RC` tag alone is not proof of the true
    // rookie year: a star's rookie card is frequently reprinted as a bare `RC`
    // insert years after he debuted. The confidence rule must therefore mark
    // 'high' ONLY for a clear base-RC signal and otherwise drop the datum,
    // preferring NOT-WRONG over coverage (the ChatBot consumer prints rc_year
    // verbatim — ChatBot/app.js:4975 — and ignores confidence, so a non-null
    // low-confidence year would still surface the wrong claim; the only way to
    // suppress a wrong year is to null it).
    //
    // A candidate is a CLEAR base-RC signal UNLESS it is both:
    //   (a) THIN — the RC year has at most RC_TOKEN_THIN_MAX base-RC-token rows
    //       (a true rookie year is tagged across dozens of products: Ohtani
    //       2018 = 303 rows, Julio Rodríguez 2022 = 69, Gunnar Henderson 2023 =
    //       61, Paul Skenes 2024 = 46, Alek Manoah 2021 = 11), AND
    //   (b) LATE — it trails the player's first checklist appearance by at least
    //       RC_GAP_MIN years (a genuine rookie year is at/near first appearance).
    // Only the intersection is demoted: a thin-but-early RC (small/niche set at
    // the true rookie year) stays 'high', and a late-but-thick RC (a real
    // prospect's first base RC, e.g. Henderson's 61-row 2023 four years after a
    // 2019 Bowman prospect appearance) stays 'high'. This is why the rule does
    // NOT over-prune legitimate prospect RCs the way a bare first-appearance gap
    // heuristic would.
    //
    // When a candidate is both thin and late it is a stray late insert, not the
    // rookie year, so rc_year is nulled and confidence is 'none' (e.g. Aaron
    // Judge: his only solo base-RC token is 2 bare `RC` rows on 2018 Topps
    // Chrome, two years after his 2016 first appearance, while his true 2017 RC
    // rows are untagged in local data — so the correct outcome is to DROP the
    // wrong 2018 claim, not to assert it at 'high' and not to fabricate 2017).
    // MIRRORS scripts/build-player-meta.cjs buildPlayers() exactly.
    var RC_TOKEN_THIN_MAX = 2;
    var RC_GAP_MIN = 2;

    var rcYear = rcCandidates.length ? rcCandidates[0] : null;
    var rcConfidence = rcYear !== null ? 'high' : 'none';

    if (rcYear !== null) {
      var rcRowCount = p.rc_year_counts[rcYear] || 0;
      var earliestChecklistYear = checklistYears.length
        ? checklistYears[checklistYears.length - 1]
        : rcYear;
      var gap = rcYear - earliestChecklistYear;
      if (rcRowCount <= RC_TOKEN_THIN_MAX && gap >= RC_GAP_MIN) {
        rcYear = null;
        rcConfidence = 'none';
      }
    }

    return {
      sport: p.sport,
      player_key: p.player_key,
      player_name: p.player_name,
      checklist_years: checklistYears,
      rc_year: rcYear,
      rc_year_confidence: rcConfidence
    };
  });

  players.sort(function (a, b) {
    var sportCompare = String(a.sport || '').localeCompare(String(b.sport || ''));
    if (sportCompare !== 0) return sportCompare;
    return String(a.player_name || '').localeCompare(String(b.player_name || ''));
  });

  return players;
}

/**
 * Read every published checklist product bundle from the repo and return the
 * deduped product objects (first-seen wins per meta.code). Mirrors the local
 * builder's source set: top-level data/v1/checklists/products/*.json only.
 */
function readPublishedProducts_() {
  var entries = listGitHubDir_(PLAYER_META_PRODUCTS_DIR);
  var seenCodes = {};
  var products = [];

  entries.forEach(function (entry) {
    if (entry.type !== 'file') return;
    if (!/\.json$/.test(entry.name)) return;

    var bundle = fetchGitHubJsonFileBase_(PLAYER_META_PRODUCTS_DIR + '/' + entry.name);
    var map = bundle && bundle.products;
    if (!map || typeof map !== 'object') return;

    Object.keys(map).forEach(function (code) {
      if (seenCodes[code]) return;
      seenCodes[code] = true;
      products.push(map[code]);
    });
  });

  return products;
}

/* =========================
   Ported aggregation helpers (behavior-preserving)
   Source: CM_Intel/proposals/cm-routing/primary-code.gs
========================= */

function normalize_(text) {
  return String(text == null ? '' : text)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\w\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLikelySoloPlayerName_(playerText) {
  var raw = String(playerText == null ? '' : playerText).trim();
  if (!raw) return false;

  var rawLower = raw.toLowerCase();
  var p = normalize_(raw);
  if (!p) return false;
  if (/^\$/.test(raw)) return false;
  if (/gift card/i.test(raw)) return false;
  if (/graded/i.test(raw)) return false;
  if (/card\s*#?\d+/i.test(raw)) return false;

  var blockedRawPatterns = [' / ', ' & ', ' and ', ' with ', ' vs ', ' versus '];
  for (var i = 0; i < blockedRawPatterns.length; i++) {
    if (rawLower.indexOf(blockedRawPatterns[i]) !== -1) return false;
  }

  var blockedNormalizedPhrases = [
    'duo', 'combo', 'pair', 'teammates', 'leaders',
    'best of the best', 'dynamic duo', 'postseason prominence',
    'superstar greeting', 'lineup stays dangerous', 'motivated in',
    'careful in', 'prior teammates reunite'
  ];
  for (var j = 0; j < blockedNormalizedPhrases.length; j++) {
    if (p.indexOf(blockedNormalizedPhrases[j]) !== -1) return false;
  }

  if (/^\d+\s/.test(raw)) return false;
  if (/^\/\d+/.test(raw)) return false;

  var words = raw.replace(/[."']/g, '').split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.length <= 4;
}

function extractPrimaryPlayerName_(playerText) {
  var raw = String(playerText == null ? '' : playerText).trim();
  if (!raw) return '';

  raw = raw.replace(/^["']+|["']+$/g, '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';

  var rawNorm = normalize_(raw);
  var rawLower = raw.toLowerCase();

  if (/^\$/.test(raw)) return '';
  if (/gift card/i.test(raw)) return '';
  if (/graded/i.test(raw)) return '';
  if (/card\s*#?\d+/i.test(raw)) return '';

  var blockedPhrases = [
    'best of the best', 'dynamic duo', 'postseason prominence',
    'superstar greeting', 'lineup stays dangerous', 'motivated in',
    'careful in', 'prior teammates reunite'
  ];
  for (var i = 0; i < blockedPhrases.length; i++) {
    if (rawNorm.indexOf(blockedPhrases[i]) !== -1) return '';
  }

  var firstPiece = raw;
  var splitters = [' / ', ' & ', ' and ', ' with ', ' vs ', ' versus '];
  for (var k = 0; k < splitters.length; k++) {
    var idx = rawLower.indexOf(splitters[k]);
    if (idx > -1) {
      firstPiece = raw.slice(0, idx).trim();
      break;
    }
  }

  firstPiece = firstPiece
    .replace(/^#?\d+\s+/, '')
    .replace(/^[-\u2011\u2012\u2013\u2014\u2015][A-Z]{2,3}\s+/, '')
    .replace(/^[-\u2011\u2012\u2013\u2014\u2015]+\s*/, '')
    .replace(/\s+card\s*#?.*$/i, '')
    .replace(/\s+graded.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!firstPiece) return '';
  return isLikelySoloPlayerName_(firstPiece) ? firstPiece : '';
}

// RC-candidate gate. A row contributes its PRODUCT year as an rc_year candidate
// ONLY when the tag denotes a genuine base/true Rookie Card.
//
// Rule (grounded in the real tag vocabulary of data/v1/checklists/products,
// 801 distinct tags): require the standalone, whitespace-delimited token `rc`
// in the normalized tag — NOT the `rc` substring. normalize_ turns the real
// delimiters (`|`, `,`, `/`, `-`) into spaces, so every true base-RC tag keeps
// `rc` as its own token: "RC", "RC /99"->"rc 99", "RC | SP"->"rc sp",
// "DP, RC"->"dp rc", "YG - RC"->"yg - rc", "Rookie Short Print RC"->
// "rookie short print rc". The whole-token test REJECTS the tags that merely
// CONTAIN the letters r-c but are not a base RC:
//   - "PRC" / "PRC /40" -> "prc" / "prc 40" (promo/parallel code, not a base RC)
//   - "Rookie", "RY" ("Rookie Year" subset), "Rookie Patch Autographs"
//     (+ Emerald/Platinum/Black/... variants), "Rookie Dual Patch Autographs",
//     "Rookie Stars", "Rookie of the Year Award" (inserts / autos / relics /
//     awards — none carry the `rc` token).
// `Rookie`/`RY` are deliberately NOT in the allow-set: they are broad, ambiguous
// labels attached to inserts, parallels, and subsets, so admitting them would
// re-introduce the over-claiming this fix removes. Prefer NOT-WRONG over coverage.
// MIRRORS scripts/build-player-meta.cjs isSafeSoloRcRow_ exactly.
function isSafeSoloRcRow_(row) {
  var tag = normalize_(row.tag || '');
  var rawPlayer = String(row.player == null ? '' : row.player).trim();
  var player = extractPrimaryPlayerName_(rawPlayer);
  var tagTokens = tag.split(' ');
  if (tagTokens.indexOf('rc') === -1) return false;
  if (!player) return false;

  var rawLower = rawPlayer.toLowerCase();
  return !(
    rawLower.indexOf(' / ') !== -1 ||
    rawLower.indexOf(' & ') !== -1 ||
    rawLower.indexOf(' and ') !== -1 ||
    rawLower.indexOf(' with ') !== -1 ||
    rawLower.indexOf(' vs ') !== -1 ||
    rawLower.indexOf(' versus ') !== -1
  );
}

function uniqueArray_(arr) {
  var seen = {};
  var out = [];
  for (var i = 0; i < arr.length; i++) {
    var v = arr[i];
    if (!seen[v]) {
      seen[v] = true;
      out.push(v);
    }
  }
  return out;
}

function extractComparableYear_(token) {
  var m = String(token || '').match(/(19|20)\d{2}/);
  return m ? parseInt(m[0], 10) : 0;
}

// Season ranges (e.g. "2025-26") sanitize to string tokens; collapse each to
// its leading 4-digit year for the numeric output shape.
function toYearNumber_(token) {
  var m = String(token || '').match(/(19|20)\d{2}/);
  return m ? parseInt(m[0], 10) : null;
}

function sanitizeYearsArray_(years) {
  var arr = Array.isArray(years) ? years : [years];

  var clean = arr
    .map(function (v) { return String(v == null ? '' : v).trim(); })
    .reduce(function (out, v) {
      var matches = v.match(/\b(19|20)\d{2}(?:-\d{2})?\b/g);
      return out.concat(matches || []);
    }, [])
    .filter(Boolean);

  var uniqYears = uniqueArray_(clean);
  return uniqYears.sort(function (a, b) {
    return extractComparableYear_(b) - extractComparableYear_(a);
  });
}

/* =========================
   GitHub helpers — atomic PUT-with-sha path
   Reused from command-center/static-exporter/Code.gs
   (getGitHubConfig_/githubRequest_/getGitHubFileSha_/putGitHubJsonFileBase_).
   Script Properties: GITHUB_TOKEN/GITHUB_OWNER/GITHUB_REPO/GITHUB_BRANCH.
========================= */

function value_(v) {
  return String(v == null ? '' : v).trim();
}

function getGitHubConfig_() {
  var props = PropertiesService.getScriptProperties();
  var token = value_(props.getProperty('GITHUB_TOKEN'));
  var owner = value_(props.getProperty('GITHUB_OWNER')) || 'ChasingMajors';
  var repo = value_(props.getProperty('GITHUB_REPO')) || 'chasing-majors-app';
  var branch = value_(props.getProperty('GITHUB_BRANCH')) || 'main';

  if (!token) throw new Error('Missing Script Property: GITHUB_TOKEN');
  if (!owner) throw new Error('Missing Script Property: GITHUB_OWNER');
  if (!repo) throw new Error('Missing Script Property: GITHUB_REPO');
  if (!branch) throw new Error('Missing Script Property: GITHUB_BRANCH');

  return { token: token, owner: owner, repo: repo, branch: branch };
}

function encodeGitHubPath_(repoPath) {
  return String(repoPath || '')
    .split('/')
    .map(function (part) { return encodeURIComponent(part); })
    .join('/');
}

function githubRequest_(method, path, payload, muteHttpExceptions) {
  var cfg = getGitHubConfig_();
  var url = 'https://api.github.com' + path;
  var options = {
    method: method,
    muteHttpExceptions: muteHttpExceptions !== false,
    headers: {
      Authorization: 'Bearer ' + cfg.token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  };

  if (payload !== undefined && payload !== null) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(payload);
  }

  var lastErr = null;

  for (var attempt = 1; attempt <= CM_GITHUB_API_RETRIES; attempt++) {
    try {
      var res = UrlFetchApp.fetch(url, options);
      var code = res.getResponseCode();
      var text = res.getContentText();
      var json = {};
      try { json = text ? JSON.parse(text) : {}; } catch (e) { json = { raw: text }; }

      if (code >= 200 && code < 300) return json;

      var transient = code === 429 || code === 500 || code === 502 || code === 503 || code === 504;
      var err = new Error('GitHub API ' + method + ' ' + path + ' failed with ' + code + ': ' + text);

      if (!transient) {
        err.nonRetryable = true;
        throw err;
      }
      if (attempt === CM_GITHUB_API_RETRIES) throw err;

      lastErr = err;
      Utilities.sleep(CM_GITHUB_API_RETRY_PAUSE_MS * attempt);
    } catch (err2) {
      lastErr = err2;
      if (err2 && err2.nonRetryable) throw err2;
      if (attempt === CM_GITHUB_API_RETRIES) break;
      Utilities.sleep(CM_GITHUB_API_RETRY_PAUSE_MS * attempt);
    }
  }

  throw lastErr;
}

function listGitHubDir_(repoPath) {
  var cfg = getGitHubConfig_();
  var path = '/repos/' + encodeURIComponent(cfg.owner)
    + '/' + encodeURIComponent(cfg.repo)
    + '/contents/' + encodeGitHubPath_(repoPath)
    + '?ref=' + encodeURIComponent(cfg.branch);

  var data = githubRequest_('get', path, null, true);
  return Array.isArray(data) ? data : [];
}

function getGitHubFileSha_(repoPath) {
  var cfg = getGitHubConfig_();
  var path = '/repos/' + encodeURIComponent(cfg.owner)
    + '/' + encodeURIComponent(cfg.repo)
    + '/contents/' + encodeGitHubPath_(repoPath)
    + '?ref=' + encodeURIComponent(cfg.branch);

  try {
    var data = githubRequest_('get', path, null, true);
    return data && data.sha ? data.sha : '';
  } catch (err) {
    var msg = String(err && err.message ? err.message : err);
    if (msg.indexOf(' 404:') !== -1 || msg.indexOf('Not Found') !== -1) return '';
    throw err;
  }
}

function fetchGitHubJsonFileBase_(repoPath) {
  var cfg = getGitHubConfig_();
  var url = 'https://api.github.com/repos/'
    + encodeURIComponent(cfg.owner)
    + '/' + encodeURIComponent(cfg.repo)
    + '/contents/' + encodeGitHubPath_(repoPath)
    + '?ref=' + encodeURIComponent(cfg.branch);

  var res = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true,
    headers: {
      Authorization: 'Bearer ' + cfg.token,
      Accept: 'application/vnd.github.raw+json'
    }
  });

  var code = res.getResponseCode();
  if (code === 404) return null;
  if (code < 200 || code >= 300) {
    throw new Error('GitHub content fetch failed with ' + code + ' for ' + repoPath + ': ' + res.getContentText());
  }

  var text = res.getContentText();
  return text ? JSON.parse(text) : null;
}

function putGitHubJsonFileBase_(repoPath, obj, message) {
  var cfg = getGitHubConfig_();
  var prettyJson = JSON.stringify(obj, null, 2) + '\n';
  var path = '/repos/' + encodeURIComponent(cfg.owner)
    + '/' + encodeURIComponent(cfg.repo)
    + '/contents/' + encodeGitHubPath_(repoPath);

  var lastErr = null;

  for (var attempt = 1; attempt <= CM_GITHUB_API_RETRIES; attempt++) {
    try {
      var sha = getGitHubFileSha_(repoPath);
      var payload = {
        message: message || ('Update ' + repoPath),
        content: Utilities.base64Encode(prettyJson, Utilities.Charset.UTF_8),
        branch: cfg.branch
      };

      if (sha) payload.sha = sha;

      var data = githubRequest_('put', path, payload, true);

      return {
        path: repoPath,
        sha: data && data.content && data.content.sha ? data.content.sha : '',
        commit: data && data.commit && data.commit.sha ? data.commit.sha : ''
      };
    } catch (err) {
      lastErr = err;
      var msg = String(err && err.message ? err.message : err);
      var isShaConflict = msg.indexOf(' failed with 409:') !== -1 || msg.indexOf('"status":"409"') !== -1;

      if (!isShaConflict || attempt === CM_GITHUB_API_RETRIES) throw err;
      Utilities.sleep(CM_GITHUB_API_RETRY_PAUSE_MS * attempt);
    }
  }

  throw lastErr;
}
