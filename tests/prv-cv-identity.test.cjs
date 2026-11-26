const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {standardize}=require('../shared/prv-cv-identity.cjs');
const cv={Code:'canonical',DisplayName:'2026 Example Baseball',year:'2026',sport:'baseball',manufacturer:'Topps',product:'Example'};
const record=(code='old')=>({entry:{...cv,Code:code,sport:'Baseball',product:'old family'},product:{meta:{code},rows:[{id:code+':row:1',product_id:code,group_id:code+':base',measurement:{value:20},serial_limit:99,checklist_size:10,raw:{code}}]}});
test('canonical metadata and identifiers retain quantities, original rows and input objects',()=>{
 const source=record(),before=JSON.stringify(source),out=standardize([source],[cv]);
 assert.equal(JSON.stringify(source),before);assert.equal(out.records[0].entry.Code,'canonical');
 assert.equal(out.records[0].product.rows[0].product_id,'canonical');
 assert.deepEqual(out.records[0].product.rows[0].measurement,{value:20});
 assert.equal(out.records[0].product.rows[0].raw.code,'old');
 assert.equal(out.aliases.old.products[0],'canonical');
 assert.equal(out.records[0].entry.identity_status,'compliant');
 for(const field of ['DisplayName','year','sport','manufacturer','product'])assert.equal(out.records[0].entry[field],cv[field]);
});
test('missing, ambiguous, cross-sport and conflicting identities remain reviewable without mutation',()=>{
 for(const choices of [[],[cv,{...cv,Code:'other'}],[{...cv,sport:'football'}],[{...cv,Code:'old',DisplayName:'Different product'}]]){
  const out=standardize([record()],choices);assert.equal(out.report.held.length,1);assert.equal(out.records[0].entry.Code,'old');assert.equal(Object.keys(out.aliases).length,0);
 }
});
test('duplicate target mappings are held on both sides; no partial merge',()=>{
 const out=standardize([record('a'),record('b')],[cv]);assert.equal(out.report.held.length,2);assert.equal(out.report.compliant.length,0);
});
test('incomplete and explicitly held CV metadata cannot contaminate PRV',()=>{
 assert.equal(standardize([record()],[{...cv,product:''}]).report.held.length,1);
 assert.equal(standardize([record()],[cv],{hold:[{cv_code:'canonical',reason:'Review typo'}]}).report.held[0].reason,'Review typo');
});
test('legacy deep links resolve directly, including empty canonical products',()=>{
 const source=fs.readFileSync('vault/app.js','utf8');
 const fn=source.slice(source.indexOf('function resolveByCode_('),source.indexOf('function renderSplitChoice_('));
 const c=vm.createContext({STRUCTURED_INDEX:{aliases:{old:{kind:'canonical_identity',products:['canonical']}}},INDEX:[{Code:'canonical',status:'empty'}],normalizeQuery_:s=>s.toLowerCase()});
 vm.runInContext(fn,c);assert.equal(c.resolveByCode_('old').Code,'canonical');assert.equal(c.resolveByCode_('OLD').Code,'canonical');
});
test('reviewed catalog identities preserve actual CV absence and can correct sport with an exact guard',()=>{
 const source=record(),target={...cv,Code:'new',DisplayName:'2026 Example Non-Sport',sport:'non-sport',identity_only:true,source_url:'https://example.com/official'};
 const policy={catalog_products:[target],reviewed_mappings:[{source:source.entry,canonical_code:'new',source_url:target.source_url,review_id:'review'}]};
 const out=standardize([source],[],policy);
 assert.equal(out.records[0].entry.Code,'new');assert.equal(out.records[0].entry.sport,'non-sport');assert.equal(out.records[0].entry.cv_indexed,false);
 assert.deepEqual(out.report.catalog_only,['new']);assert.equal(out.registry[0].identity_only,true);
 const changed=record();changed.entry.year='2027';assert.equal(standardize([changed],[],policy).report.held.length,1);
 assert.equal(standardize([source],[target],policy).records[0].entry.cv_indexed,true);
});
test('all reviewed targets exist once and a distinct Cactus Jack edition is never merged with All-Star',()=>{
 const policy=JSON.parse(fs.readFileSync('data/prv-cv-identity-policy.json'));
 const cvIndex=JSON.parse(fs.readFileSync('data/v1/checklists/index.json')).index;
 const registry=standardize([],cvIndex,policy).registry;
 for(const review of policy.reviewed_mappings||[])assert.equal(registry.filter(c=>c.Code===review.canonical_code).length,1,review.canonical_code);
 const cactus=(policy.reviewed_mappings||[]).find(r=>r.source.Code==='2025_26_topps_chrome_cactus_jack_basketball_basketball');
 assert.ok(cactus);assert.equal(cactus.canonical_code,'2025_26_topps_chrome_cactus_jack_basketball');
 assert.ok(registry.some(c=>c.Code==='2025_26_topps_chrome_cactus_jack_basketball_x_nba_all_star_game'));
});
test('promotion: exact catalog identity becomes CV indexed without duplicate registry entries',()=>{
 const target={...cv,identity_only:true,source_url:'https://www.topps.com/pages/checklists'};
 const source=record('canonical');source.entry={...cv};source.product.meta={code:'canonical',displayName:cv.DisplayName,year:cv.year,sport:cv.sport,manufacturer:cv.manufacturer,product:cv.product};
 const before=JSON.stringify(source),out=standardize([source],[cv],{catalog_products:[target]});
 assert.equal(out.registry.filter(e=>e.Code===cv.Code).length,1);assert.equal(out.records[0].entry.cv_indexed,true);
 assert.deepEqual(out.records[0].product.rows,source.product.rows);assert.equal(JSON.stringify(source),before);assert.deepEqual(out.report.catalog_only,[]);
});
test('promotion: differing metadata, duplicate catalog identities and duplicate CV identities remain rejected',()=>{
 const target={...cv,identity_only:true,source_url:'https://www.topps.com/pages/checklists'};
 for(const name of ['DisplayName','sport','year','manufacturer','product'])assert.throws(()=>standardize([], [{...cv,[name]:'conflict'}],{catalog_products:[target]}),/conflicting identity/);
 assert.throws(()=>standardize([], [cv,cv],{catalog_products:[target]}),/conflicting identity/);
 assert.throws(()=>standardize([], [cv],{catalog_products:[target,target]}),/duplicates/);
});
test('promotion: adding actual Sapphire CV identity changes no numerical rows in all existing PRV products',()=>{
 const index=JSON.parse(fs.readFileSync('data/v2/vault/index.json')).index,policy=JSON.parse(fs.readFileSync('data/prv-cv-identity-policy.json'));
 const records=index.map(entry=>({entry,product:JSON.parse(fs.readFileSync('data/v2/vault/products/'+entry.file))}));
 const rows=JSON.stringify(records.map(r=>r.product.rows)),sapphire=index.find(e=>e.Code==='2023_topps_chrome_sapphire_baseball');assert.ok(sapphire);
 const cvIndex=JSON.parse(fs.readFileSync('data/v1/checklists/index.json')).index;
 const out=standardize(records,cvIndex.filter(e=>e.Code!==sapphire.Code).concat([sapphire]),policy);
 assert.equal(out.records.length,records.length);assert.equal(JSON.stringify(out.records.map(r=>r.product.rows)),rows);
 assert.equal(out.records.find(r=>r.entry.Code===sapphire.Code).entry.cv_indexed,true);
});
