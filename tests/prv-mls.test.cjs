const {test}=require('node:test'),assert=require('node:assert/strict');
const {calculate}=require('../scripts/calculate-prv-odds.cjs');
const source=require('../data/prv-calculations/mls-2025.json');
test('MLS calibrates only the separate 1995 bonus pool with Messi excluded from Black',()=>{
 const p=calculate(source),a=p.rows.filter(r=>r.measurement.kind==='average');
 assert.equal(p.rows.length,132);assert.equal(a.length,1);assert.equal(a[0].measurement.value,25);
 assert.ok(a[0].measurement.lower_bound>25&&a[0].measurement.upper_bound<26);
 assert.ok(source.anchors.every(a=>a.odds.every((d,i)=>d===null||i===5)));
 assert.equal(source.anchors.find(a=>a.label==='Topps 1995 Black').subjects,29);
 assert.equal(p.rows.find(r=>r.set_name==='1995 Topps MLS 30 Years Celebration — Black').checklist_size,29);
 const x=JSON.parse(JSON.stringify(source));x.records.find(r=>r.proof).proof.min_primal[5]=1;
 assert.throws(()=>calculate(x),/Infeasible format mix/);
});
test('MLS preserves distinct cards, nominal stamps, and encased format boundaries',()=>{
 const p=calculate(source),row=n=>p.rows.find(r=>r.set_name===n);
 assert.equal(row('MLS Anniversary Autograph Book — Superfractor').checklist_size,1);
 assert.equal(row('Chrome Dual Autographs — Orange').checklist_size,13);
 assert.equal(row('Chrome Autographs — Pink X-Fractor').checklist_size,35);
 assert.equal(row('Chrome Autographs — Pink X-Fractor').calculation.odds_by_format[6],2);
 assert.equal(row('Pearlers — Cherry Pearl').serial_limit,10);assert.equal(row('Pearlers — White Pearl').serial_limit,5);
 assert.equal(row('MLS Renaissance Autograph Relics — Gold').measurement.kind,'upper_bound');
 assert.ok(!p.rows.some(r=>/Sapphire|Frozenfractor/.test(r.set_name)));
 assert.equal(p.rows.filter(r=>r.measurement.kind==='estimate').length,0);
 const x=JSON.parse(JSON.stringify(source));x.records.find(r=>r.kind==='average').serial_is_maximum=true;
 assert.throws(()=>calculate(x),/serial maximum/);
});
