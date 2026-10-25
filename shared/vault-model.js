/* Shared, additive PRV read model. Original source rows remain intact. */
(function(root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.VaultModel = model;
})(typeof globalThis === 'object' ? globalThis : this, function() {
  const text = value => String(value ?? '').trim();
  const key = value => text(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  function number(value) {
    const s = text(value).replace(/,/g, '');
    return s && /^\d+(\.\d+)?$/.test(s) ? Number(s) : null;
  }
  function serialNumber(value) {
    const s = text(value).replace(/,/g, '');
    if (/^(?:1\s*\/\s*1|1\s+of\s+1|one[ -]of[ -]one)$/i.test(s)) return 1;
    const match = s.match(/^(?:#\s*)?\/?\s*(\d+)$/);
    const n = match ? Number(match[1]) : null;
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  }
  function safeURL(value) {
    try { const u = new URL(text(value)); return /^https?:$/.test(u.protocol) ? u.href : ''; }
    catch { return ''; }
  }
  function row(raw, productCode, position) {
    const notes = text(raw.notes), type = text(raw.setType), baseName = text(raw.setLine);
    const parallel = text(raw.parallel);
    const name = parallel && !baseName.toLowerCase().includes(parallel.toLowerCase())
      ? [baseName, parallel].filter(Boolean).join(' — ') : baseName || parallel;
    const value = number(raw.printRun);
    const labelSerial = name.match(/\(\s*\/\s*(\d[\d,]*)\s*\)/);
    const fieldSerial = serialNumber(raw.serial), namedSerial = labelSerial ? serialNumber(labelSerial[1]) : null;
    const serial = fieldSerial ?? namedSerial;
    let kind = value === null ? 'unknown' : 'reported';
    if (/average|per.subject mean/i.test(notes)) kind = 'average';
    else if (/lower.bound|at least|minimum|listed.format/i.test(notes)) kind = 'lower_bound';
    else if (/upper.bound|maximum|or less|at most/i.test(notes)) kind = 'upper_bound';
    else if (/estimat|inferred|effective odds|odds.derived/i.test(notes)) kind = 'estimate';
    // A stamp is a separate constraint, never evidence that all copies reached packs.
    const issues = [];
    if (fieldSerial !== null && namedSerial !== null && fieldSerial !== namedSerial) issues.push('Serial field and label disagree');
    const malformed = type.length > 90 || /total production|\d[\d,]+ cards/i.test(type);
    if (malformed) issues.push('Review source label');
    if (!safeURL(raw.cmURL)) issues.push('Source not recorded');
    let category = 'Other';
    if (!malformed) {
      if (/auto/i.test(type)) category = 'Autographs';
      else if (/relic|memorabilia|patch/i.test(type)) category = 'Relics';
      else if (/insert/i.test(type)) category = 'Inserts';
      else if (/base/i.test(type)) category = 'Base';
      else if (/parallel/i.test(type)) category = 'Parallels';
    }
    return { id: `${productCode}:row:${position}`, product_id: productCode,
      group_id: `${productCode}:${key(type)}:${key(name)}`, category,
      set_name: name || (malformed ? 'Source entry' : type) || 'Unnamed entry',
      section: malformed ? 'Other' : type,
      measurement: { value, kind, unit: 'cards', scope: /per card|per subject|across the checklist/i.test(notes) ? 'per_card' : 'unspecified' },
      serial_limit: serial, checklist_size: number(raw.subSetSize),
      notes, source: { url: safeURL(raw.cmURL) }, issues, raw };
  }
  function product(data, code) {
    if (data.schema_version === 2) return data;
    const rows = (data.rows || []).map((r,i) => row(r,code,i+1));
    const groups = new Map();
    for (const r of rows) {
      const group = groups.get(r.group_id) || [];
      group.push(r); groups.set(r.group_id, group);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const conflicting = new Set(group.map(r => JSON.stringify([r.measurement,r.serial_limit,r.checklist_size]))).size > 1;
      for (const r of group) r.issues.push(conflicting ? 'Conflicting counts for matching labels' : 'Repeated source entry');
    }
    return { schema_version: 2, meta: data.meta || {}, rows,
      quality: { records: rows.length, flagged_records: rows.filter(r => r.issues.length).length } };
  }
  return { key, number, serialNumber, safeURL, row, product };
});
