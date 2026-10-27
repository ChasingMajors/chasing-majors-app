const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {stampRelease}=require('../scripts/stamp-publish-release.cjs');
test('release metadata preserves all existing manifest fields and rows',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cm-release-test-'));
 try{
  const names=['data/v1/checklists/index.json','data/v1/vault/index.json','data/v2/vault/index.json'];
  const original={ok:true,schema_version:2,index:[{Code:'existing',row_count:763,parallel_count:83,status:'ok'}]};
  for(const n of names){fs.mkdirSync(path.dirname(path.join(root,n)),{recursive:true});fs.writeFileSync(path.join(root,n),JSON.stringify(original));}
  assert.equal(stampRelease(root,'a'.repeat(40)),3);
  for(const n of names)assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,n),'utf8')),{...original,release_sha:'a'.repeat(40)});
  assert.throws(()=>stampRelease(root,'main'),/exact source commit/);
  fs.writeFileSync(path.join(root,names[2]),'{');
  const before=fs.readFileSync(path.join(root,names[0]),'utf8');assert.throws(()=>stampRelease(root,'b'.repeat(40)));
  assert.equal(fs.readFileSync(path.join(root,names[0]),'utf8'),before,'parse failure writes no partial metadata');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
