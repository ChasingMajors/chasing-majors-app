const {test} = require('node:test');
const assert = require('node:assert/strict');
const model = require('../shared/vault-model.js');
test('average and serial are independent; raw evidence survives',()=>{
 const raw={printRun:31,serial:'/50',notes:'Checklist average reaching packs',setType:'Auto',setLine:'Gold',cmURL:'https://example.com/source'};
 const r=model.row(raw,'product',1);
 assert.equal(r.measurement.kind,'average'); assert.equal(r.serial_limit,50); assert.deepEqual(r.raw,raw);
});
test('bounds and estimates are not exact counts',()=>{
 for(const [notes,kind] of [['at least 500','lower_bound'],['maximum 500','upper_bound'],['inferred from effective odds','estimate'],['','reported']]) assert.equal(model.row({printRun:500,notes},'p',1).measurement.kind,kind);
 assert.equal(model.number(''),null);
});
test('untrusted URLs and malformed labels cannot become links/categories',()=>{
 const r=model.row({cmURL:'javascript:alert(1)',setType:'Total Production: 322,400 Cards'},'p',1);
 assert.equal(r.source.url,''); assert.equal(r.category,'Other'); assert.equal(r.issues.length,2);
});
test('duplicate rows are preserved with unique record identities',()=>{
 const raw={setType:'Base',setLine:'Refractor',printRun:500};
 const p=model.product({rows:[raw,raw]},'p'); assert.equal(p.rows.length,2); assert.notEqual(p.rows[0].id,p.rows[1].id);
});
test('nominal serial labels stay distinct from average availability',()=>{
 const r=model.row({setLine:'Dual Auto Black (/50)',printRun:31,notes:'Estimated average copies across the checklist'},'p',1);
 assert.equal(r.serial_limit,50); assert.equal(r.measurement.value,31); assert.equal(r.measurement.kind,'average');
});
test('all current product records survive the read-model conversion',()=>{
 const fs=require('node:fs');
 const index=JSON.parse(fs.readFileSync('data/v1/vault/index.json')).index;
 const bundle=JSON.parse(fs.readFileSync('data/v1/vault/products/all.json'));
 const shards={}; let total=0;
 for(const entry of index){
  const file=bundle.product_map?.[entry.Code];
  const source=bundle.products?.[entry.Code] || (shards[file] ||= JSON.parse(fs.readFileSync('data/v1/vault/products/'+file))).products[entry.Code];
  const converted=model.product(source,entry.Code);
  assert.equal(converted.rows.length,source.rows.length);
  converted.rows.forEach((r,i)=>assert.deepEqual(r.raw,source.rows[i]));
  assert.equal(new Set(converted.rows.map(r=>r.id)).size,source.rows.length);
  total+=source.rows.length;
 }
 assert.ok(total>4000);
});
