const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const model = require('../shared/vault-model.js');
const {calculate} = require('./calculate-prv-odds.cjs');
const {enrich} = require('./enrich-prv-checklist-sizes.cjs');
const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const source = read('data/v1/manifest.json');
const index = read('data/v1/vault/index.json').index;
const cv = read('data/v1/checklists/index.json').index;
const bundle = read('data/v1/vault/products/all.json');
const sizeReviews = new Map(read('data/prv-checklist-sizes.json').products.map(p=>[p.code,p]));
const cache = {};
const out = 'data/v2/vault';
fs.mkdirSync(path.join(root,out,'products'),{recursive:true});
const files = new Set();
let total = 0;
const records = index.map(entry => {
  const code = entry.Code;
  const shard = bundle.product_map?.[code];
  const data = bundle.products?.[code] || (shard && (cache[shard] ||= read('data/v1/vault/products/'+shard)).products[code]);
  if (!data) throw new Error('Missing source product: '+code);
  return {entry,product:model.product(data,code)};
});
for (const file of fs.readdirSync(path.join(root,'data/prv-calculations')).filter(f=>f.endsWith('.json')).sort()) {
  const input=read('data/prv-calculations/'+file);
  const product=calculate(input);
  const existing=records.find(r=>r.entry.Code===input.code || (model.key(r.entry.DisplayName)===model.key(input.meta.displayName) && model.key(r.entry.sport)===model.key(input.meta.sport)));
  // A populated source export owns that product. Fill empty/missing products only.
  if (existing?.product.rows.length) continue;
  const entry={Code:input.code,DisplayName:input.meta.displayName,Keywords:input.meta.keywords || input.meta.displayName,year:input.meta.year,sport:input.meta.sport,manufacturer:input.meta.manufacturer,product:input.meta.product};
  if (existing) {existing.entry=entry;existing.product=product;}
  else records.push({entry,product});
}
const entries = records.map(({entry,product}) => {
  const code=entry.Code;
  enrich(product,sizeReviews.get(code));
  // Link only unique, exact normalized names and sports. No fuzzy identity guesses.
  const matches = cv.filter(c => model.key(c.DisplayName) === model.key(entry.DisplayName) && model.key(c.sport) === model.key(entry.sport));
  product.checklist = matches.length === 1 ? {code:matches[0].Code,sport:matches[0].sport} : null;
  product.source_revision = source.vault_version;
  const body = JSON.stringify(product);
  const file = model.key(code)+'-'+crypto.createHash('sha256').update(body).digest('hex').slice(0,12)+'.json';
  fs.writeFileSync(path.join(root,out,'products',file),body+'\n');
  files.add(file); total += product.rows.length;
  return {...entry,file,row_count:product.rows.length};
});
for(const file of fs.readdirSync(path.join(root,out,'products'))) if(!files.has(file)) fs.unlinkSync(path.join(root,out,'products',file));
fs.writeFileSync(path.join(root,out,'index.json'),JSON.stringify({schema_version:2,source_revision:source.vault_version,index:entries})+'\n');
console.log(JSON.stringify({products:entries.length,rows:total,bytes:entries.reduce((n,e)=>n+fs.statSync(path.join(root,out,'products',e.file)).size,0)}));
