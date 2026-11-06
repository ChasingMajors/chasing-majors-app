const {test}=require('node:test');
const assert=require('node:assert/strict');
const {calculate}=require('../scripts/calculate-prv-odds.cjs');
const {fingerprint}=require('../scripts/review-prv-integrity.cjs');
const source=require('../data/prv-calculations/bowman-sapphire-2023.json');

test('2023 Bowman Sapphire computes the 82,500 pack median from five Base anchors',()=>{
 const p=calculate(source),pr=p.calculation_provenance;
 // Pack total is whatever PRV's own calculate() returns from the five Base anchors.
 assert.equal(pr.estimated_packs,82500);
 assert.equal(pr.anchors.length,5);
 assert.deepEqual(pr.anchors.map(a=>a.implied_packs),[82500,81000,82500,82500,81000]);
 assert.ok(pr.anchor_spread<0.02);
 // Only the five numbered Base tiers with serial>1 are anchors; Padparadscha /1 is not.
 assert.ok(!pr.anchors.some(a=>a.serial_limit===1));
});

test('2023 Bowman Sapphire publishes 12 numbered /N rows, one Auto average, and withholds the unnumbered Base',()=>{
 const p=calculate(source);
 assert.equal(p.rows.length,13);
 const numbered=p.rows.filter(r=>r.measurement.kind==='serial_limit');
 const average=p.rows.filter(r=>r.measurement.kind==='average');
 assert.equal(numbered.length,12);
 assert.equal(average.length,1);
 assert.ok(numbered.every(r=>r.serial_limit!==null&&r.measurement.value===r.serial_limit));
 // No ordinary estimate row for Base (odds not published -> withheld, not published).
 assert.equal(p.rows.filter(r=>r.measurement.kind==='estimate').length,0);
 assert.ok(p.calculation_provenance.withheld.some(w=>w.reason==='Odds not published'));
 assert.ok(!p.rows.some(r=>/odds not published/i.test(r.set_name)));
});

test('2023 Bowman Sapphire never publishes the owner-sheet-unconfirmed 199 serial',()=>{
 const p=calculate(source);
 const ordinaryAuto=p.rows.find(r=>r.set_name==='Chrome Prospect Autographs');
 assert.ok(ordinaryAuto);
 assert.equal(ordinaryAuto.serial_limit,null);
 assert.equal(ordinaryAuto.measurement.kind,'average');
 assert.equal(ordinaryAuto.category,'Autographs');
 assert.ok(!p.rows.some(r=>r.serial_limit===199));
 // 82,500 / 14 odds / 29 subjects rounded to nearest 5.
 assert.equal(ordinaryAuto.measurement.value,205);
});

test('2023 Bowman Sapphire records the gate override with its justification',()=>{
 const p=calculate(source),g=p.calculation_provenance.gate_override;
 assert.ok(g);
 assert.equal(g.min_anchor_odds_denominator,9);
 assert.equal(g.min_anchors,3);
 assert.equal(g.floor,5);
 assert.ok(typeof g.justification==='string'&&g.justification.trim().length>0);
});

test('gate parameters default to today (20, 3) and leave non-overriding files unchanged',()=>{
 // A file that relaxes nothing produces no gate_override block.
 const bowman2026=require('../data/prv-calculations/bowman-2026.json');
 const p=calculate(bowman2026);
 assert.equal(p.calculation_provenance.gate_override,undefined);
});

test('a sub-default gate parameter without a justification is rejected',()=>{
 const bad=structuredClone(source);
 delete bad.method.gate_override_justification;
 assert.throws(()=>calculate(bad),/Gate override requires a recorded justification/);
 const blank=structuredClone(source);
 blank.method.gate_override_justification='   ';
 assert.throws(()=>calculate(blank),/Gate override requires a recorded justification/);
});

test('min_anchor_odds_denominator below the hard floor is rejected',()=>{
 const bad=structuredClone(source);
 bad.method.min_anchor_odds_denominator=4;
 assert.throws(()=>calculate(bad),/below hard floor/);
});

test('replaces_source fingerprint pins the exact legacy rows it supersedes',()=>{
 // The recorded fingerprint must match the current v2 product's source rows' raw payloads.
 const prod=require('../data/v2/vault/products/2023-bowman-sapphire-edition-baseball-124e62d63628.json');
 const code='2023_bowman_sapphire_edition_baseball';
 const sourceRows=prod.rows.filter(r=>r.id.startsWith(code+':row:'));
 assert.equal(sourceRows.length,2);
 const actual=fingerprint(sourceRows.map(r=>r.raw));
 assert.equal(actual,source.replaces_source.source_fingerprint);
 // A changed source row yields a different fingerprint, so the build fails closed.
 const mutated=sourceRows.map(r=>r.raw);
 mutated[0]={...mutated[0],printRun:201};
 assert.notEqual(fingerprint(mutated),source.replaces_source.source_fingerprint);
});
