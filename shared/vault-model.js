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
  function safeURL(value) {
    try { const u = new URL(text(value)); return /^https?:$/.test(u.protocol) ? u.href : ''; }
    catch { return ''; }
  }
  function row(raw, productCode, position) {
    const notes = text(raw.notes), type = text(raw.setType), name = text(raw.setLine);
    const value = number(raw.printRun);
    const labelSerial = name.match(/\(\/(\d[\d,]*)\)/);
    const serial = number(text(raw.serial).replace(/^\//, '')) ?? (labelSerial ? number(labelSerial[1]) : null);
    let kind = value === null ? 'unknown' : 'reported';
    if (/average|per.subject mean/i.test(notes)) kind = 'average';
    else if (/lower.bound|at least|minimum|listed.format/i.test(notes)) kind = 'lower_bound';
    else if (/upper.bound|maximum|or less|at most/i.test(notes)) kind = 'upper_bound';
    else if (/estimat|inferred|effective odds|odds.derived/i.test(notes)) kind = 'estimate';
    // A stamp is a separate constraint, never evidence that all copies reached packs.
    const issues = [];
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
    return { schema_version: 2, meta: data.meta || {}, rows: (data.rows || []).map((r,i) => row(r,code,i+1)) };
  }
  return { key, number, safeURL, row, product };
});
