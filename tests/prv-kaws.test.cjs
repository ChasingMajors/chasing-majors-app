const {test}=require('node:test');
const assert=require('node:assert/strict');
const {calculate}=require('../scripts/calculate-prv-odds.cjs');
const source=require('../data/prv-calculations/kaws-2026.json');
test('KAWS uses three non-autograph anchors and distinguishes the unnumbered parallel',()=>{
 const p=calculate(source),pr=p.calculation_provenance;
 assert.equal(p.rows.length,22);assert.equal(pr.estimated_packs,55800);
 assert.ok(pr.anchor_spread<.022);assert.equal(pr.anchors.length,3);
 assert.deepEqual(pr.anchors.map(a=>a.implied_packs),[57000,55800,55800]);
 assert.equal(p.rows.filter(r=>r.measurement.kind==='estimate').length,3);
 assert.equal(p.rows.filter(r=>r.measurement.kind==='serial_limit').length,19);
 for(const [name,value] of [['Base — Unnumbered parallel',310],['KAWS Creation',186],['KAWS Companion SP',72]]) {
  const r=p.rows.find(r=>r.set_name===name);assert.equal(r.measurement.value,value);assert.equal(r.measurement.kind,'estimate');
 }
 assert.ok(!p.rows.some(r=>r.set_name==='Base'));
});
test('KAWS keeps 41 base autograph cards separate from five unreviewed on-card cards',()=>{
 const p=calculate(source),autos=p.rows.filter(r=>r.category==='Autographs');
 assert.equal(autos.length,8);
 assert.ok(autos.every(r=>r.measurement.kind==='serial_limit'));
 assert.equal(source.groups['Base Autographs'].subjects,41);
 assert.equal(source.groups['KAWS Companion SSP Autographs'].subjects,5);
 assert.ok(p.calculation_provenance.withheld.some(r=>r.group==='On-Card Autographs'));
 assert.ok(!p.rows.some(r=>r.set_name.includes('On-Card')));
});
