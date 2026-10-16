const {test}=require('node:test');
const assert=require('node:assert/strict');
const {calculate}=require('../scripts/calculate-prv-odds.cjs');
const source=require('../data/prv-calculations/series2-2026.json');
const copy=()=>JSON.parse(JSON.stringify(source));
test('Series 2 aggregates are supported by feasible optimal bound certificates',()=>{
 const p=calculate(source);assert.equal(p.rows.length,59);
 assert.equal(p.rows.filter(r=>r.measurement.kind!=='serial_limit').length,15);
 assert.equal(p.rows.find(r=>r.set_name==='Golden Mirror Base Image Variations').measurement.value,140);
 assert.equal(p.rows.find(r=>r.set_name==='Heavy Lumber').measurement.value,500);
 for(const r of p.rows.filter(r=>r.measurement.kind!=='serial_limit')){
  const m=r.measurement;assert.ok(m.value>=m.lower_bound&&m.value<=m.upper_bound);
  assert.ok((m.upper_bound-m.lower_bound)/((m.upper_bound+m.lower_bound)/2)<=.1);
 }
});
test('corrupt or stale odds proofs cannot silently produce PRV entries',()=>{
 let x=copy();x.records[0].proof.min_primal[0]=-1;assert.throws(()=>calculate(x),/sign violation/);
 x=copy();x.records[0].proof.min_dual=x.records[0].proof.min_dual.map(()=>0);assert.throws(()=>calculate(x),/Unproven/);
 x=copy();x.anchors[0].serial_limit*=2;assert.throws(()=>calculate(x),/Infeasible/);
 x=copy();x.records[0].odds[2]=1;assert.throws(()=>calculate(x),/dual|optimum/);
});
test('wide format uncertainty is rejected and unresolved totals stay withheld',()=>{
 const x=copy();x.method.max_relative_width=.001;assert.throws(()=>calculate(x),/uncertain/);
 const p=calculate(source);
 assert.ok(p.calculation_provenance.withheld.some(r=>r.name==='BASE CARDS RAINBOW FOIL'&&r.relative_width>.8));
 assert.ok(!p.rows.some(r=>r.set_name==='Base — Rainbow Foil'));
 assert.ok(!p.rows.some(r=>r.set_name.includes('Memorial Day')));
});
test('known numbered variations remain serial limits, not invented estimates',()=>{
 const p=calculate(source),r=p.rows.find(r=>r.set_name==='True Photo Variations');
 assert.equal(r.measurement.kind,'serial_limit');assert.equal(r.serial_limit,100);
 assert.equal(r.calculation.unrounded_estimate,null);
});
