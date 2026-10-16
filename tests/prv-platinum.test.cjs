const {test}=require('node:test'),assert=require('node:assert/strict');
const {calculate}=require('../scripts/calculate-prv-odds.cjs');
const source=require('../data/prv-calculations/platinum-2025.json');
test('Platinum reconciles Hobby and retail without multiplying repeated source blocks',()=>{
 const p=calculate(source);assert.equal(p.rows.length,81);
 assert.equal(p.rows.filter(r=>r.measurement.kind!=='serial_limit').length,14);
 assert.equal(new Set(p.rows.map(r=>r.set_name)).size,81);
 assert.equal(source.anchors.length,9);
 for(const r of p.rows.filter(r=>r.measurement.kind!=='serial_limit')){
  const m=r.measurement;assert.ok(m.value>=m.lower_bound&&m.value<=m.upper_bound);
  assert.ok((m.upper_bound-m.lower_bound)/((m.upper_bound+m.lower_bound)/2)<=.1);
 }
 assert.equal(p.rows.find(r=>r.set_name==='Base — X-Fractor').measurement.value,175);
 assert.equal(p.rows.find(r=>r.set_name==='Base — Prism').measurement.value,1775);
});
test('Platinum counts paired cards once and keeps low estimates distinct from 1/1 serials',()=>{
 const p=calculate(source),double=p.rows.find(r=>r.set_name==='1955 Topps Double Headers');
 assert.equal(double.calculation.subjects,20);assert.equal(double.measurement.value,14085);
 const red=p.rows.find(r=>r.set_name==='Base — Red Prism');
 assert.equal(red.measurement.value,1);assert.equal(red.measurement.kind,'estimate');assert.equal(red.serial_limit,null);
 const auto=p.rows.find(r=>r.set_name==='Autographs');assert.equal(auto.measurement.kind,'average');assert.equal(auto.measurement.value,526);
 assert.ok(!p.rows.some(r=>r.set_name==='Base'));
 assert.ok(!p.rows.some(r=>r.set_name==='1955 Cards That Never Were — Refractor'));
 assert.ok(!p.rows.some(r=>r.set_name==='1955 Topps City Variations — Refractor'));
 assert.equal(p.calculation_provenance.withheld.length,3);
});
