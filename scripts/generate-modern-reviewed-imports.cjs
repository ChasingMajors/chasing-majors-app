#!/usr/bin/env node
// Deterministic generator for the staged modern 2024-football CV subset.
//
// Reads the owner-approved staged CSV (net-new.csv) and, for each loadable
// product, emits a reviewed-import input file under data/cv-reviewed-imports/
// in the EXACT shape apply-reviewed-checklists.cjs validates, then appends a
// catalog entry (mode:"new") whose content_sha256 is the sha256 of the written
// file bytes (matching the importer's digest(fs.readFileSync(file)) semantics).
//
// Mirrors scripts/generate-vintage-reviewed-imports.cjs with one critical
// behavioral difference resolved in the implementation plan:
//   The CSV keys products with UNDERSCORES (2024_panini_prizm_football) but the
//   LIVE index keys the 2024 shells with HYPHENS (2024-panini-prizm-football).
//   The importer keys products by the raw entry.code and does NOT normalize
//   separators, so an underscore code would create a SECOND, duplicate product
//   alongside the empty live shell. We therefore canonicalize every code to the
//   live hyphen form and assert it exists in the live index (except the one
//   genuinely net-new product, 2024-panini-luminance-football).
//
// Scope (resolved in the plan):
//   LOAD 24 products (23 empty hyphen shells + 1 net-new luminance) = 21056 rows.
//   EXCLUDE 12 MANGLED products (never generate) and 2 already-POPULATED
//   products (cosmic-chrome 783 live, inception 541 live) whose CSV rows are
//   delta-only and cannot be appended via the whole-product reviewed-import path
//   without creating a duplicate catalog entry — refer those to owner review.
//
// Identity safety mirrors the importer: every row needs a non-empty subset and
// card_no, string player/team, code==canonical code, sport=='football', and a
// unique (subset\0card_no) per product. A loadable product that still fails
// after dropping the known junk row is MOVED to the exclusion report (never
// force-mangled).

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const digest = s => crypto.createHash('sha256').update(s).digest('hex');

const REPO = path.resolve(__dirname, '..');
const STAGING = '/Users/chasingmajors/Documents/CM_Intel/.agents/tasks/cv-modern-staging';
const SOURCE_CSV = path.join(STAGING, 'net-new.csv');
const IMPORTS_DIR = path.join(REPO, 'data/cv-reviewed-imports');
const CATALOG = path.join(IMPORTS_DIR, 'catalog.json');
const LIVE_INDEX = path.join(REPO, 'data/v1/checklists/index.json');
const EXCLUDED_MD = path.join(STAGING, 'modern-load-excluded.md');

// --- Exact scope (underscore CSV codes). ---
const LOAD_CODES = [
  '2024_clearly_donruss_football',
  '2024_donruss_elite_football',
  '2024_donruss_optic_football',
  '2024_panini_absolute_football',
  '2024_panini_encore_football',
  '2024_panini_gold_standard_football',
  '2024_panini_impeccable_football',
  '2024_panini_luminance_football', // net-new (no live shell)
  '2024_panini_mosaic_football',
  '2024_panini_obsidian_football',
  '2024_panini_origins_football',
  '2024_panini_phoenix_football',
  '2024_panini_photogenic_football',
  '2024_panini_prestige_football',
  '2024_panini_prizm_deca_football',
  '2024_panini_prizm_draft_picks_football',
  '2024_panini_prizm_football',
  '2024_panini_rookies_stars_football',
  '2024_panini_select_football',
  '2024_panini_spectra_football',
  '2024_panini_totally_certified_football',
  '2024_score_a_treat_football',
  '2024_score_football',
  '2024_topps_now_rookie_campaign_quarterbacks_football',
];

// The one product with no live shell: the importer creates it, so metadata is derived.
const NET_NEW_CODE = '2024-panini-luminance-football';

const EXCLUDE_MANGLED = [
  '2024_donruss_football',
  '2024_panini_black_football',
  '2024_panini_certified_football',
  '2024_panini_contenders_football',
  '2024_panini_contenders_optic_football',
  '2024_panini_eminence_football',
  '2024_panini_flawless_football',
  '2024_panini_immaculate_collection_football',
  '2024_panini_national_treasures_collegiate_football',
  '2024_panini_national_treasures_football',
  '2024_panini_one_football',
  '2024_topps_finest_football',
];
const MANGLED_REASON = 'scrape flattened autograph/insert structure: duplicate (subset,card_no) identities and/or card_no stored as a year; needs restructuring before load';

const EXCLUDE_POPULATED = [
  '2024_topps_cosmic_chrome_football',
  '2024_topps_inception_football',
];
const POPULATED_REASON = 'already populated live; net-new.csv holds only delta rows (cosmic 2, inception 4) which the whole-product reviewed-import path cannot append without a catalog duplicate — refer to owner (consider a scoped patch) rather than duplicate';

// Known junk row to DROP defensively (lives under cosmic, which is excluded anyway).
const JUNK_ROW = {
  code: '2024_topps_cosmic_chrome_football',
  card_no: '100',
  player: 'cards, including 10 cards per player. Buy on eBay.',
};

// --- RFC4180-style CSV parser (handles quoted fields, embedded commas, "" escapes). ---
function parseCsv(text) {
  const rows = [];
  let field = '';
  let record = [];
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { record.push(field); field = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { record.push(field); rows.push(record); record = []; field = ''; i++; continue; }
    field += ch; i++;
  }
  if (field.length > 0 || record.length > 0) { record.push(field); rows.push(record); }
  return rows;
}

function readCsvObjects(file) {
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  if (!rows.length) return [];
  const header = rows[0];
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const rec = rows[r];
    if (rec.length === 1 && rec[0] === '') continue;
    const obj = {};
    for (let c = 0; c < header.length; c++) obj[header[c]] = rec[c] !== undefined ? rec[c] : '';
    out.push(obj);
  }
  return out;
}

// Mirror existing reviewed-import files / vintage generator: 4-part template.
function buildKeywords(displayName) {
  return [
    displayName,
    `${displayName} checklist`,
    `${displayName} cards`,
    `${displayName} autographs`,
  ].join(', ');
}

// Title-case a canonical hyphen code into a DisplayName, e.g.
// 2024-panini-luminance-football -> "2024 Panini Luminance Football".
function titleCaseFromCode(code) {
  return code
    .split('-')
    .map(seg => (/^\d+$/.test(seg) ? seg : seg.charAt(0).toUpperCase() + seg.slice(1)))
    .join(' ');
}

function main() {
  const allRows = readCsvObjects(SOURCE_CSV);

  // Group rows by CSV (underscore) code, preserving file order.
  const rowsByCode = new Map();
  for (const row of allRows) {
    if (!rowsByCode.has(row.code)) rowsByCode.set(row.code, []);
    rowsByCode.get(row.code).push(row);
  }

  const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
  if (catalog.schema_version !== 1) throw new Error('Unexpected catalog schema_version');

  const liveIndex = JSON.parse(fs.readFileSync(LIVE_INDEX, 'utf8'));
  const liveByCode = new Map(liveIndex.index.map(e => [e.Code, e]));
  const existingCatalogCodes = new Set(catalog.products.map(p => p.code));

  const loaded = [];
  const excluded = [];
  let droppedJunk = 0;
  let totalRowsLoaded = 0;

  // Record the deliberate exclusions up front (mangled + populated).
  for (const csvCode of EXCLUDE_MANGLED) {
    excluded.push({ code: csvCode.replace(/_/g, '-'), csvCode, reason: MANGLED_REASON, kind: 'mangled' });
  }
  for (const csvCode of EXCLUDE_POPULATED) {
    excluded.push({ code: csvCode.replace(/_/g, '-'), csvCode, reason: POPULATED_REASON, kind: 'populated' });
  }

  for (const csvCode of LOAD_CODES) {
    const canonical = csvCode.replace(/_/g, '-'); // normalize to live hyphen form
    const rows = rowsByCode.get(csvCode) || [];

    // Code-format assertion: must be a known live shell, or the one net-new product.
    const liveEntry = liveByCode.get(canonical);
    if (!liveEntry && canonical !== NET_NEW_CODE) {
      throw new Error(`Canonical code ${canonical} is neither a live shell nor the known net-new product; refusing to guess.`);
    }

    // Collision safety: never double-add a code already in the catalog.
    if (existingCatalogCodes.has(canonical)) {
      excluded.push({ code: canonical, csvCode, reason: `code already present in catalog.json (${canonical}) — would create a duplicate entry`, kind: 'catalog_collision' });
      continue;
    }

    if (!rows.length) {
      excluded.push({ code: canonical, csvCode, reason: 'no rows found in source CSV for this code', kind: 'no_rows' });
      continue;
    }

    // Identity validation (same rules the importer enforces). No mangling.
    const seen = new Set();
    let problem = null;
    const outRows = [];
    for (const r of rows) {
      // Defensive junk-row drop (cosmic is excluded, so this should never fire).
      if (csvCode === JUNK_ROW.code && r.card_no === JUNK_ROW.card_no && r.player === JUNK_ROW.player) {
        droppedJunk++;
        continue;
      }
      const subset = r.subset;
      const card_no = r.card_no;
      const player = r.player;
      const team = r.team;
      const tag = r.tag !== undefined ? r.tag : '';
      const section = r.section;
      if (!subset || !card_no) { problem = `row with empty subset/card_no (card_no="${card_no}", subset="${subset}")`; break; }
      if (typeof player !== 'string' || typeof team !== 'string') { problem = `row with non-string player/team (card_no="${card_no}")`; break; }
      const key = subset + '\0' + card_no;
      if (seen.has(key)) { problem = `duplicate (subset,card_no) identity: ("${subset}","${card_no}")`; break; }
      seen.add(key);
      // Normalize to the 8-col CV row with code pinned to the CANONICAL code and sport=football.
      outRows.push({ code: canonical, sport: 'football', section, subset, card_no, player, team, tag });
    }
    if (problem) {
      excluded.push({ code: canonical, csvCode, reason: `validation failed, moved to exclusion (not mangled): ${problem}`, kind: 'validation' });
      continue;
    }

    // expected_rows + expected_subset_counts from the ACTUAL written rows.
    const counts = {};
    for (const r of outRows) counts[r.subset] = (counts[r.subset] || 0) + 1;

    // Metadata: prefer the exact live index entry for existing shells; derive for net-new.
    let displayName, year, manufacturer, product;
    if (liveEntry) {
      displayName = liveEntry.DisplayName;
      year = liveEntry.year;
      manufacturer = liveEntry.manufacturer;
      product = liveEntry.product;
    } else {
      // net-new luminance
      displayName = titleCaseFromCode(canonical); // "2024 Panini Luminance Football"
      year = '2024';
      const segs = canonical.replace(/-football$/, '').split('-'); // [2024, panini, luminance]
      manufacturer = segs[1] === 'panini' ? 'Panini' : (segs[1].charAt(0).toUpperCase() + segs[1].slice(1));
      product = segs.slice(2).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
    }

    const meta = {
      code: canonical,
      displayName,
      year,
      sport: 'football',
      manufacturer,
      product,
      keywords: buildKeywords(displayName),
    };

    const payload = {
      ok: true,
      meta,
      rows: outRows,
      parallels: [],
      source_provenance: {
        withheld_source_records: 0,
        source: 'cv-modern-2024-football',
        note: 'Owner-approved staged 2024 football Checklist Vault subset (net-new.csv); clean products only, mangled and already-populated products excluded for owner review.',
      },
    };

    const fileName = `modern-${canonical}.json`;
    const filePath = path.join(IMPORTS_DIR, fileName);
    // Write compact JSON + trailing newline (matches existing input files), then
    // hash the written bytes so content_sha256 == digest(fs.readFileSync(file)).
    fs.writeFileSync(filePath, JSON.stringify(payload) + '\n');
    const content_sha256 = digest(fs.readFileSync(filePath));

    const entry = {
      code: canonical,
      file: fileName,
      mode: 'new',
      sport: 'football',
      expected_rows: outRows.length,
      expected_subset_counts: counts,
      content_sha256,
    };
    catalog.products.push(entry);
    existingCatalogCodes.add(canonical);
    loaded.push(entry);
    totalRowsLoaded += outRows.length;
  }

  // Persist the catalog (preserve existing entries + schema_version 1).
  fs.writeFileSync(CATALOG, JSON.stringify(catalog, null, 2) + '\n');

  // Exclusion report for owner review.
  const lines = [];
  lines.push('# Modern 2024-football load — excluded products');
  lines.push('');
  lines.push('Generated by scripts/generate-modern-reviewed-imports.cjs');
  lines.push('');
  lines.push(`- Loadable products (catalog entries appended): ${loaded.length}`);
  lines.push(`- Total rows loaded: ${totalRowsLoaded}`);
  lines.push(`- Excluded products: ${excluded.length}`);
  lines.push(`- Junk rows dropped: ${droppedJunk}`);
  lines.push('');
  lines.push('| code | kind | reason |');
  lines.push('|---|---|---|');
  for (const e of excluded) {
    lines.push(`| ${e.code} | ${e.kind} | ${e.reason.replace(/\|/g, '\\|')} |`);
  }
  lines.push('');
  fs.writeFileSync(EXCLUDED_MD, lines.join('\n'));

  const summary = {
    loaded: loaded.length,
    excluded: excluded.length,
    excluded_mangled: excluded.filter(e => e.kind === 'mangled').length,
    excluded_populated: excluded.filter(e => e.kind === 'populated').length,
    excluded_other: excluded.filter(e => !['mangled', 'populated'].includes(e.kind)).length,
    dropped_junk: droppedJunk,
    total_rows_loaded: totalRowsLoaded,
    loaded_codes: loaded.map(e => ({ code: e.code, rows: e.expected_rows })),
  };
  console.log(JSON.stringify(summary, null, 2));
}

main();
