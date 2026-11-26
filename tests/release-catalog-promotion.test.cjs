const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {validate}=require('../scripts/content-release.cjs');
test('release promotion preserves strict duplicate and conflicting-identity gates',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cv-promotion-release-'));
 const entry={Code:'canonical',DisplayName:'2023 Example Baseball',year:'2023',sport:'baseball',manufacturer:'Topps',product:'Example'};
 const write=(name,value)=>{const p=path.join(root,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(value));};
 const policy={catalog_products:[{...entry,identity_only:true,source_url:'https://www.topps.com/pages/checklists'}]};
 try{
  write('data/v1/checklists/index.json',{index:[entry]});write('data/prv-cv-identity-policy.json',policy);
  write('data/v1/checklists/products/baseball.json',{products:{canonical:{meta:{code:'canonical'},rows:[],parallels:[]}}});
  write('data/v1/vault/index.json',{index:[]});write('data/v1/vault/products/all.json',{products:{}});
  assert.equal(validate(root).length,1);assert.throws(()=>validate(root,{probeInvalid:true}),/Duplicate/);
  write('data/v1/checklists/index.json',{index:[entry,entry]});assert.throws(()=>validate(root),/conflicting identity|Duplicate/);
  write('data/v1/checklists/index.json',{index:[{...entry,year:'2024'}]});assert.throws(()=>validate(root),/conflicting identity/);
  write('data/v1/checklists/index.json',{index:[entry]});write('data/prv-cv-identity-policy.json',{catalog_products:[policy.catalog_products[0],policy.catalog_products[0]]});assert.throws(()=>validate(root),/duplicates/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
