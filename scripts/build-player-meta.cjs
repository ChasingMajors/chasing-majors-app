// Build data/v1/players/player-meta.json from published checklist products.
//
// Static producer for the player-meta index. This replicates the Apps Script
// aggregation handlePlayerMetaIndex_ (and its helpers) from the live exporter,
// but reads the already-published local checklist product bundles instead of
// scanning Sheets per request. The committed JSON makes the static
// /data/v1/players/player-meta.json URL return 200 instead of 404.
//
// Conventions follow scripts/build-vault-data.cjs: node:fs / node:path, resolve
// the repo root via path.resolve(__dirname,'..'), read product bundles, and end
// with a single console.log(JSON.stringify(summary)).

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const productsDir = path.join(root, 'data/v1/checklists/products');
const outDir = path.join(root, 'data/v1/players');
const outFile = path.join(outDir, 'player-meta.json');

/* =========================
   Ported helpers (behavior-preserving) from
   CM_Intel/proposals/cm-routing/primary-code.gs
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
  const raw = String(playerText == null ? '' : playerText).trim();
  if (!raw) return false;

  const rawLower = raw.toLowerCase();
  const p = normalize_(raw);
  if (!p) return false;
  if (/^\$/.test(raw)) return false;
  if (/gift card/i.test(raw)) return false;
  if (/graded/i.test(raw)) return false;
  if (/card\s*#?\d+/i.test(raw)) return false;

  const blockedRawPatterns = [' / ', ' & ', ' and ', ' with ', ' vs ', ' versus '];
  for (let i = 0; i < blockedRawPatterns.length; i++) {
    if (rawLower.includes(blockedRawPatterns[i])) return false;
  }

  const blockedNormalizedPhrases = [
    'duo',
    'combo',
    'pair',
    'teammates',
    'leaders',
    'best of the best',
    'dynamic duo',
    'postseason prominence',
    'superstar greeting',
    'lineup stays dangerous',
    'motivated in',
    'careful in',
    'prior teammates reunite'
  ];

  for (let i = 0; i < blockedNormalizedPhrases.length; i++) {
    if (p.includes(blockedNormalizedPhrases[i])) return false;
  }

  if (/^\d+\s/.test(raw)) return false;
  if (/^\/\d+/.test(raw)) return false;

  const words = raw.replace(/[."']/g, '').split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.length <= 4;
}

function extractPrimaryPlayerName_(playerText) {
  let raw = String(playerText == null ? '' : playerText).trim();
  if (!raw) return '';

  raw = raw.replace(/^["']+|["']+$/g, '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';

  const rawNorm = normalize_(raw);
  const rawLower = raw.toLowerCase();

  if (/^\$/.test(raw)) return '';
  if (/gift card/i.test(raw)) return '';
  if (/graded/i.test(raw)) return '';
  if (/card\s*#?\d+/i.test(raw)) return '';

  const blockedPhrases = [
    'best of the best',
    'dynamic duo',
    'postseason prominence',
    'superstar greeting',
    'lineup stays dangerous',
    'motivated in',
    'careful in',
    'prior teammates reunite'
  ];

  for (let i = 0; i < blockedPhrases.length; i++) {
    if (rawNorm.includes(blockedPhrases[i])) return '';
  }

  let firstPiece = raw;
  const splitters = [' / ', ' & ', ' and ', ' with ', ' vs ', ' versus '];
  for (let i = 0; i < splitters.length; i++) {
    const idx = rawLower.indexOf(splitters[i]);
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
function isSafeSoloRcRow_(row) {
  const tag = normalize_(row.tag || '');
  const rawPlayer = String(row.player == null ? '' : row.player).trim();
  const player = extractPrimaryPlayerName_(rawPlayer);
  const tagTokens = tag.split(' ');
  if (tagTokens.indexOf('rc') === -1) return false;
  if (!player) return false;

  const rawLower = rawPlayer.toLowerCase();
  return !(
    rawLower.includes(' / ') ||
    rawLower.includes(' & ') ||
    rawLower.includes(' and ') ||
    rawLower.includes(' with ') ||
    rawLower.includes(' vs ') ||
    rawLower.includes(' versus ')
  );
}

function uniqueArray_(arr) {
  const seen = Object.create(null);
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (!seen[v]) {
      seen[v] = true;
      out.push(v);
    }
  }
  return out;
}

function extractComparableYear_(token) {
  const m = String(token || '').match(/(19|20)\d{2}/);
  return m ? parseInt(m[0], 10) : 0;
}

// Local product years may be season ranges (e.g. "2025-26"). sanitizeYearsArray_
// keeps those as string tokens (matching the Apps Script helper), so collapse
// each token to its leading 4-digit year for the numeric output shape.
function toYearNumber_(token) {
  const m = String(token || '').match(/(19|20)\d{2}/);
  return m ? parseInt(m[0], 10) : null;
}

function sanitizeYearsArray_(years) {
  const arr = Array.isArray(years) ? years : [years];

  const clean = arr
    .map(function (v) { return String(v == null ? '' : v).trim(); })
    .reduce(function (out, v) {
      const matches = v.match(/\b(19|20)\d{2}(?:-\d{2})?\b/g);
      return out.concat(matches || []);
    }, [])
    .filter(Boolean);

  const uniqYears = uniqueArray_(clean);
  return uniqYears.sort(function (a, b) {
    return extractComparableYear_(b) - extractComparableYear_(a);
  });
}

/* =========================
   Aggregation
========================= */

function readProductBundles() {
  // Match the documented source glob: top-level data/v1/checklists/products/*.json.
  // Subdirectories (e.g. products/baseball/) are intentionally excluded.
  const files = fs
    .readdirSync(productsDir)
    .filter(function (f) { return f.endsWith('.json'); })
    .sort();

  // Dedupe product bundles by meta.code (first-seen wins): the same code can
  // appear in both a sharded file and a named product file.
  const seenCodes = Object.create(null);
  const products = [];

  files.forEach(function (file) {
    const abs = path.join(productsDir, file);
    const stat = fs.statSync(abs);
    if (!stat.isFile()) return;

    let json;
    try {
      json = JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch (err) {
      throw new Error('Failed to parse product bundle ' + file + ': ' + err.message);
    }

    const map = json && json.products;
    if (!map || typeof map !== 'object') return;

    Object.keys(map).forEach(function (code) {
      if (seenCodes[code]) return;
      seenCodes[code] = true;
      products.push(map[code]);
    });
  });

  return products;
}

function buildPlayers(productsOverride) {
  const products = Array.isArray(productsOverride) ? productsOverride : readProductBundles();
  const agg = Object.create(null);

  products.forEach(function (product) {
    const meta = (product && product.meta) || {};
    const sport = normalize_(meta.sport || '');
    const year = String(meta.year == null ? '' : meta.year).trim();
    if (!year) return;

    const rows = Array.isArray(product && product.rows) ? product.rows : [];

    rows.forEach(function (row) {
      const playerName = extractPrimaryPlayerName_(row.player || '');
      if (!playerName) return;

      const playerKey = normalize_(playerName);
      if (!playerKey) return;

      const aggKey = sport + '|' + playerKey;

      if (!agg[aggKey]) {
        agg[aggKey] = {
          sport: sport,
          player_key: playerKey,
          player_name: playerName,
          checklist_years: new Set(),
          rc_year_candidates: new Set()
        };
      }

      agg[aggKey].checklist_years.add(year);

      if (isSafeSoloRcRow_(row)) {
        agg[aggKey].rc_year_candidates.add(year);
      }
    });
  });

  const players = Object.keys(agg).map(function (aggKey) {
    const p = agg[aggKey];

    const checklistYears = uniqueArray_(
      sanitizeYearsArray_(Array.from(p.checklist_years))
        .map(toYearNumber_)
        .filter(function (y) { return y !== null; })
    ).sort(function (a, b) { return b - a; });

    const rcCandidates = sanitizeYearsArray_(Array.from(p.rc_year_candidates))
      .map(toYearNumber_)
      .filter(function (y) { return y !== null; })
      .sort(function (a, b) { return a - b; });

    // rc_year + confidence rule. rcYear is the earliest genuine base-RC-token
    // candidate year (the product year, as before). The accuracy work for B1
    // lives entirely in the base-RC TOKEN gate (isSafeSoloRcRow_): only a real
    // whole-token `rc` tag can produce a candidate, which removes the old
    // `PRC`/`Rookie …` insert false positives. Given a candidate, confidence is
    // 'high'; with no candidate it is 'none' and rc_year is null.
    //
    // We deliberately do NOT demote a base-RC token when a player first appears
    // in checklists earlier than that token year. Such a "first-appearance gap"
    // cannot distinguish a late/insert RC (where the true rookie year precedes
    // the tag) from a PROSPECT who legitimately appears in Bowman/prospect sets
    // before a correct base-RC tag at his true rookie year (e.g. Gunnar
    // Henderson: prospect 2019, genuine `RC` at 2023; Julio Rodríguez: prospect
    // 2017, genuine `RC` at 2022). A gap rule erased ~1000 correctly base-RC-
    // tagged rookie years, so it is intentionally omitted. The known residual
    // limitation is a source-tagging gap: a player whose ONLY base-RC token is a
    // late insert still tagged bare `RC` (e.g. Aaron Judge — his sole solo `RC`
    // token is 2018 Topps Chrome, while his untagged 2016/2017 rows carry no RC
    // signal) will report that later year. Fixing that requires correcting the
    // source tags, not a heuristic that discards correct data.
    const rcYear = rcCandidates.length ? rcCandidates[0] : null;
    const rcConfidence = rcYear !== null ? 'high' : 'none';

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
    const sportCompare = String(a.sport || '').localeCompare(String(b.sport || ''));
    if (sportCompare !== 0) return sportCompare;
    return String(a.player_name || '').localeCompare(String(b.player_name || ''));
  });

  return players;
}

function main() {
  const players = buildPlayers();
  const withRc = players.filter(function (p) { return p.rc_year !== null; }).length;

  const payload = {
    ok: true,
    source: 'player-meta-export',
    generated_at: new Date().toISOString(),
    players: players
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2) + '\n');

  console.log(JSON.stringify({ players: players.length, with_rc: withRc }));
}

if (require.main === module) {
  main();
}

module.exports = { extractPrimaryPlayerName_, buildPlayers };
