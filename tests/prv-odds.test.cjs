const {test}=require('node:test');
const assert=require('node:assert/strict');
const {calculate}=require('../scripts/calculate-prv-odds.cjs');
const bowman=require('../data/prv-calculations/bowman-2026.json');
const logo=require('../data/prv-calculations/logofractor-2026.json');
const clone=x=>JSON.parse(JSON.stringify(x));
test('independent numbered anchors agree before any estimates are published',()=>{
 const b=calculate(bowman),l=calculate(logo);
 // 150*10*56 and 150*5*112 each imply 84,000 format packs.
 assert.equal(b.calculation_provenance.estimated_packs,84000);
 // Median of gold 705000, orange 697500, black 696000, red 694500.
 assert.equal(l.calculation_provenance.estimated_packs,696750);
 assert.equal(b.rows.length,18);assert.equal(l.rows.length,65);
});
test('averages, estimates and numbered limits have distinct meanings',()=>{
 const b=calculate(bowman),l=calculate(logo);
 assert.equal(b.rows.find(r=>r.set_name==='Sapphire Chrome Prospects Auto').measurement.value,180);
 assert.equal(b.rows.find(r=>r.set_name==='Sapphire Chrome Prospects Auto').measurement.kind,'average');
 assert.equal(l.rows.find(r=>r.set_name==='Base LogoFractor Image Variations').measurement.value,200);
 assert.equal(l.rows.find(r=>r.set_name==='1991 Topps LogoFractor').measurement.value,2325);
 const serial=l.rows.find(r=>r.serial_limit===150);
 assert.equal(serial.measurement.kind,'serial_limit');assert.equal(serial.calculation.estimated_packs,null);
});
test('1:1 base occurrence and missing Hidden Gems odds cannot become counts',()=>{
 const b=calculate(bowman),l=calculate(logo);
 assert.ok(!b.rows.some(r=>r.set_name==='Base Chrome Prospects Sapphire'));
 assert.ok(!l.rows.some(r=>r.set_name==='Base LogoFractor'));
 assert.ok(b.calculation_provenance.withheld.some(r=>r.group==='Hidden Gems'));
 assert.ok(!b.rows.some(r=>r.set_name==='Hidden Gems'));
});
test('bad anchors, absent counts and duplicate evidence stop publication',()=>{
 let x=clone(bowman);x.odds_rows.find(r=>r.anchor).odds_denominator*=2;assert.throws(()=>calculate(x),/disagree/);
 x=clone(bowman);x.groups['Base Chrome Prospects Sapphire'].subjects=0;assert.throws(()=>calculate(x),/checklist size/);
 x=clone(bowman);x.odds_rows.push(x.odds_rows[0]);assert.throws(()=>calculate(x),/Duplicate/);
 x=clone(bowman);x.odds_rows.find(r=>r.anchor).serial_limit=null;assert.throws(()=>calculate(x),/Unsuitable/);
});
