'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {calculate}=require('../scripts/calculate-prv-odds.cjs');
const source=require('../data/prv-calculations/bowman-sapphire-football-2026-reviewed.json');
test('creator estimates retain all nine exact values, categories, checklist sizes and row provenance',()=>{
 const product=calculate(source);assert.deepEqual(product.rows.map(r=>r.measurement.value),[860,50,32,32,21,50,30,50,50]);
 assert.deepEqual(product.rows.map(r=>r.checklist_size),[null,5,15,10,50,36,73,9,9]);
 assert.deepEqual(product.rows.map(r=>r.category),['Base','Inserts','Inserts','Inserts','Autographs','Autographs','Autographs','Autographs','Autographs']);
 for(const r of product.rows){assert.equal(r.serial_limit,null);assert.equal(r.raw.serial,'');assert.equal(r.measurement.kind,'estimate');assert.equal(r.measurement.verified,false);assert.equal(r.measurement.scope,'per_card');assert.equal(r.estimate_provenance.rounded,false);assert.match(r.notes,/Unverified creator estimate/);assert.equal(r.source.url,source.sources.estimate_url);assert.equal(r.raw.cmURL,source.sources.estimate_url);assert(!r.calculation);}
 assert.equal(product.rows.filter(r=>r.category==='Base').length,1);assert.equal(product.rows[0].set_name,'Base');
});
test('estimate source uses the established exact CV code and metadata without creating a second checklist',()=>{
 const cv=JSON.parse(fs.readFileSync('data/v1/checklists/index.json')).index,match=cv.filter(p=>p.Code===source.code);assert.equal(match.length,1);
 assert.equal(source.code,'2026_bowman_sapphire_football_football_checklist');
 for(const [meta,key]of [['displayName','DisplayName'],['sport','sport'],['year','year'],['manufacturer','manufacturer'],['product','product']])assert.equal(source.meta[meta],match[0][key]);
});
test('direct estimate contract rejects false serials, invented odds/proofs, rounding and invalid provenance',()=>{
 function bad(change,pattern){const d=structuredClone(source);change(d);assert.throws(()=>calculate(d),pattern);}
 bad(d=>d.records[0].serial_limit=860,/unnumbered/);bad(d=>d.records[0].kind='serial_limit',/unnumbered/);
 bad(d=>d.records[0].round_to=5,/rounding/);bad(d=>d.method.round_estimates_to=5,/rounding/);
 bad(d=>d.records[0].proof={},/proofs/);bad(d=>d.records[0].odds=[100],/odds/);bad(d=>d.anchors=[],/calibration/);
 bad(d=>d.sources.estimate_url='',/URL/);bad(d=>d.sources.estimate_url='javascript:alert(1)',/HTTPS/);bad(d=>d.sources.estimate_url='https://user:secret@example.com/',/HTTPS/);bad(d=>d.sources.reviewed_date='2026-02-31',/date/);
 bad(d=>d.records[0].estimate=0,/estimates/);bad(d=>d.records[0].subjects=-1,/size/);bad(d=>d.meta.code='other',/identity/);
 bad(d=>d.records[0].name='Base (/860)',/serial limit/);
});
test('duplicate subsets and IDs are rejected before they can double up a product',()=>{
 for(const mutate of [d=>d.records.push({...d.records[0]}),d=>d.records.push({...d.records[0],id:'new-id'})]){const d=structuredClone(source);mutate(d);assert.throws(()=>calculate(d),/Duplicate/);}
});
test('authoring blocks orphaned, conflicting or duplicate CV targets; new estimate source is a required release product',()=>{
 const {validateTarget}=require('../scripts/calculate-prv-reviewed-estimates.cjs'),cv=JSON.parse(fs.readFileSync('data/v1/checklists/index.json')).index;
 validateTarget(source,cv);assert.throws(()=>validateTarget(source,[]),/exact CV/);
 const target=cv.find(p=>p.Code===source.code);assert.throws(()=>validateTarget(source,[target,target]),/exact CV/);
 assert.throws(()=>validateTarget({...source,meta:{...source.meta,displayName:'Mini Dive'}},cv),/metadata conflict/);
 const {expectedProducts}=require('../scripts/content-release.cjs');
 assert.deepEqual(expectedProducts(process.cwd(),['data/prv-calculations/bowman-sapphire-football-2026-reviewed.json']),['PRV:'+source.code]);
});
