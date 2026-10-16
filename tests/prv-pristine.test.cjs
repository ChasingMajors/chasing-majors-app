const {test}=require('node:test');
const assert=require('node:assert/strict');
const {calculate}=require('../scripts/calculate-prv-odds.cjs');
const source=require('../data/prv-calculations/pristine-2026.json');
test('Pristine counts cards once and keeps encased production uncalibrated',()=>{
 const p=calculate(source);
 assert.equal(p.rows.length,87);
 assert.equal(p.rows.filter(r=>r.measurement.kind!=='serial_limit').length,11);
 assert.equal(p.rows.find(r=>r.set_name==='Rushmore').measurement.value,25);
 assert.equal(p.rows.find(r=>r.set_name==='Rushmore').calculation.subjects,5);
 assert.equal(p.rows.find(r=>r.set_name==='Pristine Pair Dual Autographs — Red Refractor').calculation.subjects,9);
 const auto=p.rows.find(r=>r.set_name==='Pristine Personal Endorsements Autographs');
 assert.equal(auto.measurement.kind,'average');assert.equal(auto.measurement.value,34);
 for(const r of p.rows.filter(r=>r.measurement.kind!=='serial_limit')){
  assert.equal(r.calculation.odds_by_format[0],null);
  assert.ok(r.measurement.value>=r.measurement.lower_bound&&r.measurement.value<=r.measurement.upper_bound);
 }
 assert.ok(p.calculation_provenance.withheld.some(r=>r.name==='Pristine Autographs Pristine Refractor'));
 assert.ok(!p.rows.some(r=>r.set_name==='Base — Refractor'));
});
test('Pristine uses reviewed official names and serials instead of CV scrape errors',()=>{
 const p=calculate(source);
 assert.ok(p.rows.some(r=>r.set_name==='Spotless Signatures — Blue Refractor'&&r.serial_limit===75));
 assert.ok(p.rows.some(r=>r.set_name==='Pristine Pieces Autograph Relics — Pristine Refractor'&&r.serial_limit===99));
 assert.ok(p.rows.some(r=>r.set_name==='Italics Autographs — Superfractor'&&r.serial_limit===1));
 assert.ok(!p.rows.some(r=>/Spotlight|Italics.*Pink|Italics.*Black/.test(r.set_name)));
});
test('a non-encased proof cannot be reused to invent encased print runs',()=>{
 const x=JSON.parse(JSON.stringify(source)),r=x.records.find(r=>r.kind==='estimate');
 r.odds=[11,null];assert.throws(()=>calculate(x),/dual|optimum/);
});
