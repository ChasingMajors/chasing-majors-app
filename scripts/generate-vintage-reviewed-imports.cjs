#!/usr/bin/env node
// Deterministic generator for the staged vintage CV package.
//
// Reads the owner-approved staged CSVs and, for each net-new vintage product,
// emits a reviewed-import input file under data/cv-reviewed-imports/ in the
// EXACT shape apply-reviewed-checklists.cjs validates, then appends a catalog
// entry (mode:"new") whose content_sha256 is the sha256 of the written file
// bytes (matching the importer's digest(fs.readFileSync(file)) semantics).
//
// Identity safety mirrors the importer: every row needs a non-empty subset and
// card_no, string player/team, code==product code, sport==product sport, and a
// unique (subset\0card_no) per product. Products that cannot satisfy this, or
// whose code collides with a live checklist code or an existing catalog entry,
// are EXCLUDED (never force-mangled) and listed for owner review.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const digest = s => crypto.createHash('sha256').update(s).digest('hex');

const REPO = path.resolve(__dirname, '..');
const STAGING = '/Users/chasingmajors/Documents/CM_Intel/.agents/tasks/cv-vintage-staging';
const INDEX_CSV = path.join(STAGING, 'cv-vintage-index.csv');
const ROWS_CSV = path.join(STAGING, 'cv-vintage-rows.csv');
const IMPORTS_DIR = path.join(REPO, 'data/cv-reviewed-imports');
const CATALOG = path.join(IMPORTS_DIR, 'catalog.json');
const LIVE_INDEX = path.join(REPO, 'data/v1/checklists/index.json');
const EXCLUDED_MD = '/Users/chasingmajors/Documents/CM_Intel/.agents/tasks/vintage-load-excluded.md';

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
  // flush trailing field/record if file does not end with a newline
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
    // skip a wholly empty trailing line
    if (rec.length === 1 && rec[0] === '') continue;
    const obj = {};
    for (let c = 0; c < header.length; c++) obj[header[c]] = rec[c] !== undefined ? rec[c] : '';
    out.push(obj);
  }
  return out;
}

// Mirror existing reviewed-import files: keywords derive from the display name.
function buildKeywords(displayName) {
  return [
    displayName,
    `${displayName} checklist`,
    `${displayName} cards`,
    `${displayName} autographs`,
  ].join(', ');
}

function main() {
  const products = readCsvObjects(INDEX_CSV);
  const rowObjs = readCsvObjects(ROWS_CSV);

  // Group rows by code, preserving staged file order (drives subset-count key order).
  const rowsByCode = new Map();
  for (const row of rowObjs) {
    if (!rowsByCode.has(row.code)) rowsByCode.set(row.code, []);
    rowsByCode.get(row.code).push(row);
  }

  const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
  if (catalog.schema_version !== 1) throw new Error('Unexpected catalog schema_version');

  const liveIndex = JSON.parse(fs.readFileSync(LIVE_INDEX, 'utf8'));
  const liveCodes = new Set(liveIndex.index.map(e => e.Code));
  const existingCatalogCodes = new Set(catalog.products.map(p => p.code));

  const loaded = [];
  const excluded = [];
  let totalRowsLoaded = 0;

  for (const p of products) {
    const code = p.Code;
    const sport = p.sport;
    const rows = rowsByCode.get(code) || [];

    // 1) Collision safety (re-assert even though staging guaranteed 0 collisions).
    if (liveCodes.has(code)) {
      excluded.push({ code, displayName: p.DisplayName, reason: `code collides with a live checklist code (${code})` });
      continue;
    }
    if (existingCatalogCodes.has(code)) {
      excluded.push({ code, displayName: p.DisplayName, reason: `code already present in catalog.json (${code})` });
      continue;
    }

    if (!rows.length) {
      excluded.push({ code, displayName: p.DisplayName, reason: 'no rows found in staged rows CSV for this code' });
      continue;
    }

    // 2) Identity validation (same rules the importer enforces). No mangling.
    const seen = new Set();
    let problem = null;
    const outRows = [];
    for (const r of rows) {
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
      // Normalize to exactly the 8-col CV row with code/sport pinned to the product.
      outRows.push({ code, sport, section, subset, card_no, player, team, tag });
    }
    if (problem) {
      excluded.push({ code, displayName: p.DisplayName, reason: problem });
      continue;
    }

    // 3) Compute expected_rows and expected_subset_counts from the ACTUAL rows.
    const counts = {};
    for (const r of outRows) counts[r.subset] = (counts[r.subset] || 0) + 1;

    const meta = {
      code,
      displayName: p.DisplayName,
      year: p.year,
      sport,
      manufacturer: p.manufacturer,
      product: p.product,
      keywords: buildKeywords(p.DisplayName),
    };

    const payload = {
      ok: true,
      meta,
      rows: outRows,
      parallels: [],
      source_provenance: {
        withheld_source_records: 0,
        source: 'vintage-pc-checker',
        note: 'Owner-confirmed source of truth; Google source sheet backfill pending',
      },
    };

    const fileName = `vintage-${code}.json`;
    const filePath = path.join(IMPORTS_DIR, fileName);
    // Write compact JSON + trailing newline (matches existing input files), then
    // hash the written bytes so content_sha256 == digest(fs.readFileSync(file)).
    fs.writeFileSync(filePath, JSON.stringify(payload) + '\n');
    const content_sha256 = digest(fs.readFileSync(filePath));

    const entry = {
      code,
      file: fileName,
      mode: 'new',
      sport,
      expected_rows: outRows.length,
      expected_subset_counts: counts,
      content_sha256,
    };
    catalog.products.push(entry);
    existingCatalogCodes.add(code);
    loaded.push(entry);
    totalRowsLoaded += outRows.length;
  }

  // Append entries to the catalog, preserving the 25 existing entries + schema_version 1.
  fs.writeFileSync(CATALOG, JSON.stringify(catalog, null, 2) + '\n');

  // Write the exclusion report for owner review (always, even if empty).
  const lines = [];
  lines.push('# Vintage load — excluded products');
  lines.push('');
  lines.push(`Generated by scripts/generate-vintage-reviewed-imports.cjs`);
  lines.push('');
  lines.push(`- Products in staged index: ${products.length}`);
  lines.push(`- Loaded (net-new, catalog entries appended): ${loaded.length}`);
  lines.push(`- Excluded: ${excluded.length}`);
  lines.push(`- Total rows loaded: ${totalRowsLoaded}`);
  lines.push('');
  if (excluded.length) {
    lines.push('| code | displayName | reason |');
    lines.push('|---|---|---|');
    for (const e of excluded) {
      lines.push(`| ${e.code} | ${e.displayName} | ${e.reason.replace(/\|/g, '\\|')} |`);
    }
  } else {
    lines.push('No products were excluded. All staged vintage products passed collision and identity validation.');
  }
  lines.push('');
  fs.writeFileSync(EXCLUDED_MD, lines.join('\n'));

  const summary = {
    staged: products.length,
    loaded: loaded.length,
    excluded: excluded.length,
    total_rows_loaded: totalRowsLoaded,
    excluded_detail: excluded,
  };
  console.log(JSON.stringify(summary, null, 2));
}

main();
