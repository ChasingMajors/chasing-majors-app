const {updateRecentProducts}=require('./update-recent-products.cjs');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const model = require('../shared/vault-model.js');
const {calculate} = require('./calculate-prv-odds.cjs');
const {enrich} = require('./enrich-prv-checklist-sizes.cjs');
const {review,fingerprint} = require('./review-prv-integrity.cjs');
const {standardize} = require('../shared/prv-cv-identity.cjs');
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
const replacesSourceReport=[];
for (const file of fs.readdirSync(path.join(root,'data/prv-calculations')).filter(f=>f.endsWith('.json')).sort()) {
  const input=read('data/prv-calculations/'+file);
  if (input.schema_version === 4) require('./calculate-prv-reviewed-estimates.cjs').validateTarget(input,cv);
  const product=calculate(input);
  const existing=records.find(r=>r.entry.Code===input.code || (model.key(r.entry.DisplayName)===model.key(input.meta.displayName) && model.key(r.entry.sport)===model.key(input.meta.sport)));
  // A populated source export owns that product. Fill empty/missing products only,
  // UNLESS this calc file carries a fingerprint-pinned replaces_source for the exact
  // source rows it supersedes. The fingerprint reuses review-prv-integrity's pattern.
  if (existing?.product.rows.length) {
    const replaces=input.replaces_source;
    if (!replaces) continue;
    const sourceRows=existing.product.rows.filter(r=>r.id.startsWith(existing.entry.Code+':row:'));
    const actual=fingerprint(sourceRows.map(r=>r.raw));
    if (actual!==replaces.source_fingerprint) {
      // Fail closed: the source changed since review, so keep it and do not apply the calc.
      replacesSourceReport.push({code:input.code,status:'stale',reason:'Source rows changed since replaces_source was recorded; keeping existing source rows.',expected_fingerprint:replaces.source_fingerprint,actual_fingerprint:actual});
      continue;
    }
    // Fingerprint matches: the calc supersedes the legacy source rows. Record what was
    // superseded in the published product's provenance so nothing is lost.
    product.calculation_provenance={...product.calculation_provenance,superseded_source_rows:{reason:replaces.reason,source_fingerprint:replaces.source_fingerprint,rows:sourceRows.map(r=>r.raw)}};
    replacesSourceReport.push({code:input.code,status:'applied',reason:replaces.reason,source_fingerprint:replaces.source_fingerprint,superseded_rows:sourceRows.length});
  }
  const entry={Code:input.code,DisplayName:input.meta.displayName,Keywords:input.meta.keywords || input.meta.displayName,year:input.meta.year,sport:input.meta.sport,manufacturer:input.meta.manufacturer,product:input.meta.product};
  if (existing) {existing.entry=entry;existing.product=product;}
  else records.push({entry,product});
}
for(const {entry,product} of records) enrich(product,sizeReviews.get(entry.Code));
const reviewed=review(records,read('data/prv-integrity-reviews.json'));
const identities=standardize(reviewed.records,cv,read('data/prv-cv-identity-policy.json'));
const aliases={...reviewed.aliases,...identities.aliases};
for(const alias of Object.values(aliases))alias.products=alias.products.map(code=>identities.aliases[code]?.products[0]||code);
const entries = identities.records.map(({entry,product}) => {
  const code=entry.Code;
  // Link only unique, exact normalized names and sports. No fuzzy identity guesses.
  const matches = cv.filter(c => (c.Code===code || model.key(c.DisplayName) === model.key(entry.DisplayName)) && model.key(c.sport) === model.key(entry.sport));
  product.checklist = matches.length === 1 ? {code:matches[0].Code,sport:matches[0].sport} : null;
  product.source_revision = source.vault_version;
  const body = JSON.stringify(product);
  const file = model.key(code)+'-'+crypto.createHash('sha256').update(body).digest('hex').slice(0,12)+'.json';
  fs.writeFileSync(path.join(root,out,'products',file),body+'\n');
  files.add(file); total += product.rows.length;
  return {...entry,file,row_count:product.rows.length,status:product.rows.length ? 'ok' : 'empty'};
});
for(const file of fs.readdirSync(path.join(root,out,'products'))) if(!files.has(file)) fs.unlinkSync(path.join(root,out,'products',file));
fs.writeFileSync(path.join(root,out,'index.json'),JSON.stringify({schema_version:2,source_revision:source.vault_version,index:entries,aliases})+'\n');
fs.writeFileSync(path.join(root,out,'identity-review.json'),JSON.stringify({...identities.report,cv_revision:read('data/v1/checklists/index.json').generated_at,source_revision:source.vault_version})+'\n');
fs.writeFileSync(path.join(root,out,'product-registry.json'),JSON.stringify({schema_version:1,scope:identities.report.scope,products:identities.registry.map(c=>Object.fromEntries(['Code','DisplayName','year','sport','manufacturer','product','cv_indexed','identity_only','source_url'].filter(k=>c[k]!==undefined).map(k=>[k,c[k]])))})+'\n');
fs.writeFileSync(path.join(root,out,'integrity-review.json'),JSON.stringify({...reviewed.report,source_revision:source.vault_version})+'\n');
fs.writeFileSync(path.join(root,out,'replaces-source-review.json'),JSON.stringify({schema_version:1,source_revision:source.vault_version,entries:replacesSourceReport})+'\n');
updateRecentProducts(root,'PRV',identities.records.map(r=>r.product),(typeof process !== 'undefined' && process.env && process.env.CM_RELEASE_BUILD_TIME) || new Date().toISOString());
console.log(JSON.stringify({products:entries.length,rows:total,bytes:entries.reduce((n,e)=>n+fs.statSync(path.join(root,out,'products',e.file)).size,0)}));
