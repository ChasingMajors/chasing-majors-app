const {test}=require('node:test'),assert=require('node:assert/strict');
const {calculate}=require('../scripts/calculate-prv-odds.cjs');
const source=require('../data/prv-calculations/mcdonalds-2025.json');
test('McDonalds calibrates only reviewed Hobby-exclusive base tiers',()=>{
 const p=calculate(source),pr=p.calculation_provenance;
 assert.equal(p.rows.length,65);assert.equal(pr.estimated_packs,75000);assert.equal(pr.anchor_spread,0);
 assert.equal(pr.anchors.length,4);assert.ok(pr.anchors.every(r=>r.implied_packs===75000));
 assert.equal(p.rows.filter(r=>['estimate','average'].includes(r.measurement.kind)).length,9);
 assert.equal(p.rows.find(r=>r.set_name==='Base — McDonalds Logo Refractor').measurement.value,190);
 assert.equal(p.rows.find(r=>r.set_name==='All-American Drip').measurement.value,155);
 assert.equal(p.rows.find(r=>r.set_name==='Billboard Ink — Refractor').measurement.kind,'average');
 assert.equal(p.rows.find(r=>r.set_name==='High Rises — Refractor').checklist_size,38);
});
test('shared or event-distributed McDonalds populations cannot inherit a Hobby-only total',()=>{
 const p=calculate(source);
 for(const name of ['Base','Base — Refractor','Base — McFlurry','High Rises','Top Recruits','Prospect Paths','Hype to Legacy','Event Autographs'])assert.ok(!p.rows.some(r=>r.set_name===name),name);
 assert.ok(!p.rows.some(r=>/RayWave|Concrete Canvas/.test(r.set_name)));
 const patch=p.rows.find(r=>r.set_name==='Golden Patch Autographs — Tie-Dye');
 assert.equal(patch.measurement.kind,'upper_bound');assert.equal(patch.serial_limit,25);
 assert.ok(p.calculation_provenance.diagnostics.some(r=>r.implied_packs===340000&&!r.selected));
 const x=JSON.parse(JSON.stringify(source));x.odds_rows.find(r=>r.serial_limit===null).serial_is_maximum=true;
 assert.throws(()=>calculate(x),/serial maximum/);
});
