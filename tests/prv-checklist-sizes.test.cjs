const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {enrich}=require('../scripts/enrich-prv-checklist-sizes.cjs'),model=require('../shared/vault-model.js');
const reviews=require('../data/prv-checklist-sizes.json');
const bundle=require('./fixtures/prv-checklist-size-source.json');
function original(code){return model.product(bundle.products?.[code]||require('../data/v1/vault/products/'+bundle.product_map[code]).products[code],code);}
test('checklist enrichment preserves every original production value, stamp, and raw source',()=>{
 let changes=0;
 for(const review of reviews.products){
  const p=original(review.code),before=new Map(p.rows.map(r=>[r.id,JSON.stringify([r.measurement,r.serial_limit,r.raw]) ]));
  enrich(p,review);
  for(const row of p.rows)if(before.has(row.id))assert.equal(JSON.stringify([row.measurement,row.serial_limit,row.raw]),before.get(row.id));
  changes+=p.rows.filter(r=>r.checklist_size_provenance).length;
 }
 assert.ok(changes>900);
});
test('multi-signer checklist sizes count cards once and explicit source errors can be corrected',()=>{
 const hoop=reviews.products.find(p=>p.code==='2025_26_topps_signature_class_basketball');
 assert.equal(hoop.subsets.find(s=>s.name==='Dual Autographs').size,15);
 assert.equal(hoop.subsets.find(s=>s.name==='Triple Autographs').size,10);
 const review=reviews.products.find(p=>p.code==='2025_26_topps_signature_class_basketball'),p=enrich(original(review.code),review);
 assert.equal(p.rows.find(r=>r.set_name==='Penstroke Signatures').checklist_size,29);
 assert.equal(p.rows.find(r=>r.set_name==='Base'&&r.checklist_size===100).checklist_size,100);
});
test('checklist-only entries preserve unknown print runs and cannot duplicate on rebuild',()=>{
 const review=reviews.products.find(p=>p.count_only_subsets.length),p=enrich(original(review.code),review),rows=p.rows.filter(r=>r.category==='Checklist sizes');
 assert.equal(rows.length,6);assert.ok(rows.every(r=>r.measurement.value===null&&r.serial_limit===null&&r.checklist_size>0));
 const length=p.rows.length;enrich(p,review);assert.equal(p.rows.length,length);
});
test('a changed source count cannot be overwritten by a stale correction',()=>{
 const review=reviews.products.find(p=>p.code==='2025_26_topps_signature_class_basketball'),p=original(review.code),row=p.rows.find(r=>r.set_name==='Penstroke Signatures');row.checklist_size=31;
 enrich(p,review);assert.equal(row.checklist_size,31);
});
