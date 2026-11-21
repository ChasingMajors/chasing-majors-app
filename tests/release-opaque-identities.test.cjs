'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {expectedProducts}=require('../scripts/content-release.cjs');
test('canonical source codes containing ampersands and spaces retain their exact identities',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cm-opaque-'));
 const codes=['2025_Topps_Baseball_Allen_&_Ginter','2025_Allen_&_Ginter_X','2025_Panini_Impeccable WNBA_basketball','2025_Panini_Prizm WNBA_basketball'];
 const file='data/v1/vault/products/fixture.json';fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});
 fs.writeFileSync(path.join(root,file),JSON.stringify({products:Object.fromEntries(codes.map(c=>[c,{meta:{code:c},rows:[]}]))}));
 try{assert.deepEqual(expectedProducts(root,[file]),codes.map(c=>'PRV:'+c).sort());
 assert.throws(()=>expectedProducts(root,[file],'PRV:unknown'),/Unknown or invalid/);
 assert.throws(()=>expectedProducts(root,[file],'PRV:../../etc/passwd'),/Unknown or invalid/);
 assert.throws(()=>expectedProducts(root,[file],'PRV:source; touch /tmp/no'),/Unknown or invalid/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
