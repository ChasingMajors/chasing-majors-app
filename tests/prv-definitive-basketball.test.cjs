const {test}=require('node:test'),assert=require('node:assert/strict');
const {calculate}=require('../scripts/calculate-prv-odds.cjs');
const source=require('../data/prv-calculations/definitive-basketball-2025-26.json');
test('Definitive Basketball retains Hobby and FDI odds separately without production claims',()=>{
 const p=calculate(source);assert.equal(p.rows.length,139);
 assert.equal(p.rows.filter(r=>r.measurement.kind==='upper_bound').length,113);
 assert.equal(p.rows.filter(r=>r.measurement.kind==='serial_limit').length,26);
 assert.deepEqual(p.calculation_provenance.formats,['Hobby','First Day Issue']);
 const blue=p.rows.find(r=>r.set_name==='Authentic Relic Auto — Blue');
 assert.deepEqual(blue.calculation.odds_by_format,[94,96]);assert.equal(blue.serial_limit,2);
 assert.equal(blue.calculation.odds_denominator,null);
 const dual=p.rows.find(r=>r.set_name==='Dual Auto — Gold');assert.deepEqual(dual.calculation.odds_by_format,[633,null]);
 assert.ok(!p.rows.some(r=>['estimate','average'].includes(r.measurement.kind)));
});
test('Basketball Nameplates are counted by letters, multi-signer cards by distinct IDs',()=>{
 const p=calculate(source);
 const a=p.rows.find(r=>r.set_name==='Definitive Nameplate I — each letter');
 const b=p.rows.find(r=>r.set_name==='Definitive Nameplate II — each letter');
 assert.equal(a.serial_limit,1);assert.equal(a.checklist_size,100);assert.equal(b.checklist_size,84);
 assert.equal(p.calculation_provenance.checklist_counts['Triple Auto'],5);
 assert.equal(Object.values(p.calculation_provenance.checklist_counts).reduce((a,b)=>a+b,0),979);
 assert.equal(p.rows.find(r=>r.set_name==='Definitive Signs').category,'Autographs');
 assert.equal(p.calculation_provenance.withheld.length,2);
 assert.ok(!p.rows.some(r=>/First Day|Triple Rookie Auto — Gold/.test(r.set_name)));
});
test('numbered format provenance rejects missing or invalid format columns',()=>{
 const copy=()=>JSON.parse(JSON.stringify(source));
 let x=copy();x.records[0].odds_by_format=[9];assert.throws(()=>calculate(x),/format odds/);
 x=copy();x.records[0].odds_by_format[1]=0;assert.throws(()=>calculate(x),/format odds/);
 x=copy();x.formats=[];assert.throws(()=>calculate(x),/source formats/);
});
