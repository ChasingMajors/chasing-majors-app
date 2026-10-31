'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const {ensureReleaseHistory}=require('../scripts/ensure-release-history.cjs'),{expectedProducts}=require('../scripts/content-release.cjs');
function fixture(run){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cm-checkout-')),source=path.join(dir,'source'),shallow=path.join(dir,'shallow');fs.mkdirSync(source);
 const env={...process.env};delete env.GH_TOKEN;
 const git=(cwd,...args)=>cp.execFileSync('git',args,{cwd,env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const commit=(code)=>{const p='data/v1/checklists/products/'+code+'.json';fs.mkdirSync(path.dirname(path.join(source,p)),{recursive:true});fs.writeFileSync(path.join(source,p),JSON.stringify({products:{[code]:{rows:[]}}}));git(source,'add','.');git(source,'commit','-m',code);return git(source,'rev-parse','HEAD');};
 try{git(source,'init','--initial-branch=main');git(source,'config','user.name','Checkout fixture');git(source,'config','user.email','fixture@example.invalid');const before=commit('base');run({dir,source,shallow,env,git,commit,before});}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('shallow multi-commit and merge diff preserves every exact submitted product code',()=>fixture(({dir,source,shallow,env,git,commit,before})=>{
 commit('first');git(source,'checkout','-b','side');commit('side_product');git(source,'checkout','main');commit('second');git(source,'merge','--no-ff','side','-m','merge fixture');commit('last');
 const head=git(source,'rev-parse','HEAD'),full=git(source,'diff','--name-only',before,head).split('\n');
 git(dir,'clone','--depth=1','file://'+source,shallow);assert.equal(git(shallow,'rev-parse','--is-shallow-repository'),'true');
 assert.throws(()=>git(shallow,'cat-file','-e',before+'^{commit}'));
 const result=ensureReleaseHistory({cwd:shallow,env:{...env,GITHUB_SHA:head,CM_BEFORE_SHA:before,GITHUB_REF:'refs/heads/main'}});
 assert.equal(result.mode,'exact-before-fetch');const actual=git(shallow,'diff','--name-only',before,head).split('\n');assert.deepEqual(actual,full);
 assert.deepEqual(expectedProducts(shallow,actual),['CV:first','CV:last','CV:second','CV:side_product']);
 assert.deepEqual(expectedProducts(shallow,actual),expectedProducts(source,full));
}));
test('unavailable before commit fails closed rather than deriving an empty product list',()=>fixture(({dir,source,shallow,env,git,before})=>{
 git(dir,'clone','--depth=1','file://'+source,shallow);
 assert.throws(()=>ensureReleaseHistory({cwd:shallow,env:{...env,GITHUB_SHA:before,CM_BEFORE_SHA:'f'.repeat(40),GITHUB_REF:'refs/heads/main'}}),/Before commit unavailable/);
}));
test('wrong checkout SHA and malformed before SHA fail closed; dispatch has no implicit before diff',()=>fixture(({source,env,before})=>{
 assert.throws(()=>ensureReleaseHistory({cwd:source,env:{...env,GITHUB_SHA:'a'.repeat(40)}}),/not pinned/);
 assert.throws(()=>ensureReleaseHistory({cwd:source,env:{...env,GITHUB_SHA:before,CM_BEFORE_SHA:'main'}}),/Invalid before/);
 assert.equal(ensureReleaseHistory({cwd:source,env:{...env,GITHUB_SHA:before}}).mode,'no-before');
 assert.equal(ensureReleaseHistory({cwd:source,env:{...env,GITHUB_SHA:before,CM_BEFORE_SHA:'0'.repeat(40)}}).mode,'no-before');
}));
test('verifier checkout is SHA-pinned to its complete two-script closure; critical code stays intact',()=>{
 const workflow=fs.readFileSync('.github/workflows/vault-data.yml','utf8'),verify=workflow.split('\n  verify:')[1];
 for(const item of ['ref: ${{ github.sha }}','fetch-depth: 1','sparse-checkout-cone-mode: false','/scripts/content-release.cjs','/scripts/production-verification-url.cjs','persist-credentials: false'])assert(verify.includes(item),item);
 assert(workflow.includes('node scripts/ensure-release-history.cjs\n          node scripts/content-release.cjs expected'));
});
