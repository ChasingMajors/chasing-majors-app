const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const {sourceAllows,compatible}=require('../../scripts/csp-policy-guard.cjs');
const {review,audit}=require('../../scripts/csp-live-audit.cjs');
const origin='https://app.chasingmajors.com',prefix='https://static.cloudflareinsights.com/beacon.min.js/';
test('path-aware sources cannot authorize sibling paths or attacker origins',()=>{
 for(const url of [prefix+'v123',prefix+'v456?q=x'])assert(sourceAllows(url,prefix,origin));
 for(const url of ['https://static.cloudflareinsights.com/other.js','https://static.cloudflareinsights.com/beacon.min.js','https://static.cloudflareinsights.com.evil.test/beacon.min.js/v123'])assert(!sourceAllows(url,prefix,origin));
 assert(sourceAllows(origin+'/app.js',"'self'",origin));
 assert.deepEqual(compatible('script-src '+prefix,{'script-src':[prefix]}),[]);
 assert(compatible('script-src https://static.cloudflareinsights.com',{'script-src':[prefix]}).length,'Whole host broadening rejected');
 const inventory={inline:[],external:[{kind:'script',url:prefix+'v123',origin:'https://static.cloudflareinsights.com'}]};
 assert.deepEqual(review({headers:{enforcing:'script-src '+prefix}},inventory,{external:[]},origin),[]);
 assert(review({headers:{enforcing:"script-src 'self'"}},inventory,{external:[]},origin).length);
});
test('advisory failures have warning, job summary and retained receipt; approved flag blocks',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cm-csp-')),receipt=path.join(dir,'receipt.json'),summary=path.join(dir,'summary.md');
 try{for(const blocking of [false,true]){
  const r=cp.spawnSync(process.execPath,['scripts/csp-advisory.cjs',receipt,process.execPath,'-e','process.exit(7)'],{encoding:'utf8',env:{...process.env,CM_CSP_ENFORCEMENT_APPROVED:String(blocking),GITHUB_STEP_SUMMARY:summary}});
  assert.equal(r.status,blocking?7:0);assert.match(r.stdout,/::warning/);assert.equal(JSON.parse(fs.readFileSync(receipt)).outcome,'FAIL');assert.match(fs.readFileSync(summary,'utf8'),/FAIL/);
 }}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('dual-header audit records and requires injected beacon in browser mode',async()=>{
 const pages=['index.html','checklists/index.html','vault/index.html','ChatBot/index.html'].map(page=>({page,paths:['/'+page],external:[]}));
 const candidate={origin,pages,source_sha:'a'.repeat(40)};
 const fetchImpl=async u=>({ok:true,url:u.href,headers:new Headers({'content-type':'text/html','content-security-policy-report-only':'script-src '+prefix}),text:async()=>''});
 const inspectImpl=values=>values.map((v,i)=>({inline:[],external:i%2?[{kind:'script',url:prefix+'v123',origin:'https://static.cloudflareinsights.com'}]:[]}));
 const good=await audit(candidate,{fetchImpl,inspectImpl});assert.equal(good.status,'PASS');assert(good.results.filter(r=>r.mode==='browser').every(r=>r.beacon_seen));
 const bad=await audit(candidate,{fetchImpl,inspectImpl:values=>values.map(()=>({inline:[],external:[]}))});assert.equal(bad.status,'BLOCKED');
});
