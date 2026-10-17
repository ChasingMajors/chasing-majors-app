const {test}=require('node:test'),assert=require('node:assert/strict');
const {enrich}=require('../scripts/enrich-prv-checklist-sizes.cjs'),model=require('../shared/vault-model.js');
const review=require('../data/prv-checklist-sizes.json').products.find(p=>p.code==='2026_topps_flagship_football');
const bundle=require('../data/v1/vault/products/all.json');
function product(){return model.product(bundle.products?.[review.code]||require('../data/v1/vault/products/'+bundle.product_map[review.code]).products[review.code],review.code);}
test('Flagship Football fills 58 reviewed parent counts without treating signers as cards',()=>{
 const p=enrich(product(),review),row=n=>p.rows.find(r=>r.set_name===n);
 assert.equal(p.checklist_size_review.updated_rows,58);assert.equal(p.rows.length,62);
 assert.equal(row('NFL Stars Triple Autographs').checklist_size,26);assert.equal(row('NFL Stars Dual Autographs').checklist_size,27);
 assert.equal(row('Golden Mirror Variations').checklist_size,400);assert.equal(row('Clear Variation /10').checklist_size,200);assert.equal(row('All Kings').checklist_size,30);
});
test('Silver Pack scopes stay separate from an ambiguous existing production estimate',()=>{
 const before=product(),p=enrich(product(),review),row=n=>p.rows.find(r=>r.set_name===n);
 assert.equal(row('1991 Chrome Autographs').checklist_size,null);
 assert.deepEqual(row('1991 Chrome Autographs').measurement,before.rows.find(r=>r.set_name==='1991 Chrome Autographs').measurement);
 for(const [name,size] of [['Base (complete checklist)',400],['1991 Chrome Veteran Autographs',31],['1991 Chrome Rookie Autographs',46]]){
  assert.equal(row(name).checklist_size,size);assert.equal(row(name).measurement.value,null);assert.equal(row(name).serial_limit,null);
 }
});
