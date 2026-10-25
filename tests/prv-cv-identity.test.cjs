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
