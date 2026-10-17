const {test}=require('node:test'),assert=require('node:assert/strict');
const {calculate}=require('../scripts/calculate-prv-odds.cjs');
const source=require('../data/prv-calculations/finest-premier-league-2026.json');
test('Finest PL keeps tier-specific serials and calibrates all eligible base anchors',()=>{
 const p=calculate(source),pr=p.calculation_provenance;
 assert.equal(p.rows.length,129);assert.equal(pr.anchors.length,24);assert.equal(pr.estimated_packs,230000);assert.ok(pr.anchor_spread<.05);
 assert.equal(p.rows.filter(r=>r.measurement.kind==='estimate').length,23);assert.equal(p.rows.filter(r=>r.measurement.kind==='average').length,7);
 for(const [tier,n] of [['Common',10],['Uncommon',5],['Rare',3]])assert.equal(p.rows.find(r=>r.set_name===`Base ${tier} — Red Refractor`).serial_limit,n);
 assert.equal(p.rows.find(r=>r.set_name==='Base Rare — Saturday 3PM Refractor').measurement.kind,'estimate');
 assert.equal(p.rows.find(r=>r.set_name==='Base Rare — Saturday 3PM Refractor').measurement.value,3);
});
test('Finest PL withholds ambiguous common insert production and uses distinct official counts',()=>{
 const p=calculate(source);
 assert.ok(!p.rows.some(r=>r.serial_limit===null&&['Swerve','Arrivals','Clean','Expected Brilliance'].includes(r.set_name)));
 assert.ok(p.calculation_provenance.withheld.some(r=>/FIVE THEMES/.test(r.reason)));
 assert.equal(p.rows.find(r=>r.set_name==='Finest Partnerships Dual Autographs').checklist_size,15);
 assert.equal(p.rows.find(r=>r.set_name==='Finest Fans Autographs').checklist_size,12);
 assert.equal(p.rows.find(r=>r.set_name==='Gustographs').serial_limit,25);
 assert.equal(p.rows.find(r=>r.set_name==='Swerve Fusion Variation — Black / Gold').serial_limit,1);
 assert.ok(source.meta.keywords.includes('2025-26'));
});
