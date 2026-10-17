const {test}=require('node:test'),assert=require('node:assert/strict');
const {calculate}=require('../scripts/calculate-prv-odds.cjs');
const source=require('../data/prv-calculations/definitive-2025.json');
test('Definitive publishes serial ceilings without inventing production estimates',()=>{
 const p=calculate(source);assert.equal(p.rows.length,70);
 assert.equal(p.rows.filter(r=>r.measurement.kind==='upper_bound').length,41);
 assert.equal(p.rows.filter(r=>r.measurement.kind==='serial_limit').length,29);
 assert.ok(p.rows.every(r=>r.measurement.basis==='nominal_serial_ceiling'&&r.calculation.unrounded_estimate===null));
 assert.equal(p.rows.find(r=>r.set_name==='Rookie Patch Autograph').measurement.value,50);
 assert.equal(p.rows.find(r=>r.set_name==='Rookie Patch Autograph').measurement.kind,'upper_bound');
 assert.equal(p.rows.find(r=>r.set_name==='Triple MLB Logo Patch Book').serial_limit,1);
 const ultra=p.rows.find(r=>r.set_name==='Autographed Ultra Patch Collection — Gold');
 assert.equal(ultra.serial_limit,1);assert.equal(ultra.calculation.odds_denominator,null);
 assert.ok(!('estimated_packs' in p.calculation_provenance));
});
test('Definitive keeps multi-person cards and unresolved tiers separate',()=>{
 const p=calculate(source);
 assert.equal(p.calculation_provenance.checklist_counts['Quad Autographs'],7);
 assert.equal(p.calculation_provenance.checklist_counts['Trio Autographs'],8);
 assert.equal(p.calculation_provenance.checklist_counts['Dual Autograph Collection'],37);
 assert.equal(Object.values(p.calculation_provenance.checklist_counts).reduce((a,b)=>a+b,0),1229);
 assert.equal(p.calculation_provenance.withheld.length,27);
 assert.ok(!p.rows.some(r=>r.set_name==='Framed Autograph Patch Collection — Black'));
 assert.ok(!p.rows.some(r=>r.set_name==='Definitive Nameplate Collection'));
});
test('numbered-only inputs reject attempted production estimates and malformed limits',()=>{
 const copy=()=>JSON.parse(JSON.stringify(source));
 let x=copy();x.records[0].estimate=100;assert.throws(()=>calculate(x),/not allowed/);
 x=copy();x.records[0].serial_limit=0;assert.throws(()=>calculate(x),/Invalid numbered/);
 x=copy();x.anchors=[];assert.throws(()=>calculate(x),/numbered-only/);
 x=copy();x.records.push(x.records[0]);assert.throws(()=>calculate(x),/Duplicate/);
});
