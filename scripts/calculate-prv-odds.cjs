const model = require('../shared/vault-model.js');
function positive(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid '+name);
  return value;
}
function calculate(input) {
  if (input.schema_version === 3) return require("./calculate-prv-numbered.cjs").calculate(input);
  if (input.schema_version === 2) return require("./calculate-prv-multiformat.cjs").calculate(input);
  if (input.schema_version !== 1 || !input.code) throw new Error('Invalid odds input');
  const ids = new Set();
  for (const row of input.odds_rows) {
    if (ids.has(row.id)) throw new Error('Duplicate odds row'); ids.add(row.id);
    positive(row.odds_denominator, 'pack odds');
    positive(input.groups[row.group]?.subjects, 'checklist size');
    if (row.serial_limit !== null) positive(row.serial_limit, 'serial limit');
  }
  const anchors = input.odds_rows.filter(row => row.anchor).map(row => {
    const group = input.groups[row.group];
    if (group.category !== 'Base' || !(row.serial_limit > 1) || row.odds_denominator < 20 || row.withheld) throw new Error('Unsuitable production anchor');
    return {id:row.id, label:row.odds_label, subjects:group.subjects, serial_limit:row.serial_limit,
      odds_denominator:row.odds_denominator, implied_packs:group.subjects*row.serial_limit*row.odds_denominator};
  });
  if (anchors.length < 3) throw new Error('At least three reviewed anchors required');
  const sorted = anchors.map(a=>a.implied_packs).sort((a,b)=>a-b);
  const middle = Math.floor(sorted.length/2);
  const packs = sorted.length%2 ? sorted[middle] : (sorted[middle-1]+sorted[middle])/2;
  const spread = (sorted.at(-1)-sorted[0])/packs;
  if (spread > input.method.max_anchor_spread) throw new Error('Production anchors disagree');
  const roundTo = positive(input.method.round_estimates_to, 'rounding increment');
  const provenance = {method:'numbered_parallel_pack_anchor_v1', estimated_packs:packs, anchor_spread:spread, anchors,
    assumptions:input.method.calibration, sources:input.sources,
    withheld:[...(input.withheld||[]),...input.odds_rows.filter(r=>r.withheld).map(r=>({group:r.group,reason:r.withheld}))],
    diagnostics:input.odds_rows.filter(r=>r.serial_limit && !r.withheld).map(r=>({id:r.id, implied_packs:input.groups[r.group].subjects*r.serial_limit*r.odds_denominator, selected:r.anchor}))};
  const rows = input.odds_rows.filter(r=>!r.withheld).map((r,i)=>{
    const group = input.groups[r.group];
    const numbered = r.serial_limit !== null;
    const rawEstimate = numbered ? r.serial_limit : packs/r.odds_denominator/group.subjects;
    const value = numbered ? rawEstimate : Math.max(1,Math.round(rawEstimate/roundTo)*roundTo);
    const name = group.name+(r.parallel?' — '+r.parallel:'');
    const kind = numbered ? 'serial_limit' : group.category==='Autograph' ? 'average' : 'estimate';
    const raw = {code:input.code,setType:group.category==='Autograph'?'Auto':group.category==='Base'?'Parallel':group.category,
      setLine:name,printRun:value,serial:numbered?'/'+r.serial_limit:'',subSetSize:group.subjects,
      notes:numbered?'Nominal numbered serial limit per card. Subject coverage and copies reaching packs can vary.':
        `Estimated ${kind==='average'?'checklist average':'copies per card'} from ${packs} inferred format packs / ${r.odds_denominator} pack odds / ${group.subjects} checklist subjects; rounded to nearest ${roundTo}. Assumes selected serial anchors are substantially packed. Not manufacturer-confirmed; subject availability can vary.`,cmURL:input.sources.odds_url};
    const row = model.row(raw,input.code,i+1);
    if (group.category==="Variation") row.category="Variations";
    row.id=input.code+':odds:'+r.id;
    row.measurement={value,kind,unit:'cards',scope:'per_card'};
    row.calculation={odds_denominator:r.odds_denominator,checklist_subjects:group.subjects,
      unrounded_estimate:numbered?null:rawEstimate,estimated_packs:numbered?null:packs};
    row.source={url:input.sources.odds_url,checklist_url:input.sources.checklist_url,serial_reference_url:input.sources.serial_reference_url};
    return row;
  });
  return {schema_version:2,meta:input.meta,rows,calculation_provenance:provenance};
}
module.exports={calculate};
