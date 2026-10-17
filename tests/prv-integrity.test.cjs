const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const model=require('../shared/vault-model.js');
const {review,fingerprint}=require('../scripts/review-prv-integrity.cjs');
const catalog=require('../data/prv-integrity-reviews.json');
function sources(){
 const idx=require('../data/v1/vault/index.json').index,bundle=require('../data/v1/vault/products/all.json'),cache={};
 return idx.map(entry=>{const shard=bundle.product_map?.[entry.Code];const raw=bundle.products?.[entry.Code]||(cache[shard]||=require('../data/v1/vault/products/'+shard)).products[entry.Code];return {entry,product:model.product(raw,entry.Code)};});
}
test('reviewed corrections preserve every raw row and every numeric measurement',()=>{
 const original=sources(),before=new Map(original.flatMap(({product})=>product.rows.map(r=>[r.id,structuredClone(r)])));
 const result=review(original,catalog);assert.equal(result.report.stale_reviews.length,0);
 const after=[...result.records.flatMap(r=>r.product.rows),...result.report.quarantined.map(q=>q.row)];
 assert.equal(after.length,before.size);const seen=new Set();
 for(const row of after){const id=row.source_row_id||row.id;assert.ok(!seen.has(id));seen.add(id);const old=before.get(id);assert.ok(old);assert.deepEqual(row.raw,old.raw);assert.deepEqual(row.measurement,old.measurement);assert.equal(row.serial_limit,old.serial_limit);assert.equal(row.checklist_size,old.checklist_size);}
});
test('source edits invalidate positional corrections instead of relabeling fresh data',()=>{
 const records=sources();const target=records.find(r=>r.entry.Code===catalog.products[0].code);target.product.rows[0].raw.notes+=' changed';
 const result=review(records,catalog);assert.equal(result.report.stale_reviews[0].code,target.entry.Code);
 assert.ok(!result.report.applied.some(a=>a.code===target.entry.Code));
});
test('split products have correct sports, unique rows, and durable old-link choices',()=>{
 const result=review(sources(),catalog);
 const nbl=result.records.find(r=>r.entry.Code==='2025_26_topps_nbl_basketball');
 const finest=result.records.find(r=>r.entry.Code==='2025_26_topps_finest_uefa_club_competitions_soccer');
 assert.equal(nbl.entry.sport,'basketball');assert.equal(nbl.product.rows.length,18);assert.equal(finest.product.rows.length,32);
 assert.equal(nbl.product.rows.filter(r=>r.category==='Relics').length,2);
 assert.equal(Object.keys(result.aliases).length,4);
 for(const alias of Object.values(result.aliases))for(const code of alias.products)assert.ok(result.records.some(r=>r.entry.Code===code));
 for(const r of result.records)assert.equal(new Set(r.product.rows.map(row=>row.id)).size,r.product.rows.length);
});
test('ambiguous names and contradictory serials stay unresolved',()=>{
 const result=review(sources(),catalog);
 const bow=result.records.find(r=>r.entry.Code==='2025_26_bowman_basketball').product;
 assert.equal(bow.rows.find(r=>r.serial_limit===199&&r.raw.setLine==='Base').set_name,'Base — Purple Pattern Border');
 assert.equal(bow.rows.filter(r=>r.set_name==='Base'&&r.serial_limit===99).length,2);
 const three=result.records.find(r=>r.entry.Code==='2025_26_topps_three_basketball').product;
 assert.ok(three.rows.some(r=>r.set_name==='Base'&&r.serial_limit===50&&r.issues.includes('Parallel identity missing')));
});
test('prose and ambiguous combined base production stay out of public entries',()=>{
 const result=review(sources(),catalog);
 assert.equal(result.report.quarantined.length,14);
 assert.ok(!result.records.some(({product})=>product.rows.some(r=>r.set_name.length>160)));
 assert.equal(result.report.quarantined.filter(r=>r.reason.startsWith('Two base')).length,2);
});
test('fingerprints are stable across object key ordering',()=>{
 assert.equal(fingerprint([{a:1,b:2}]),fingerprint([{b:2,a:1}]));
 assert.notEqual(fingerprint([{a:1},{a:2}]),fingerprint([{a:2},{a:1}]));
});
