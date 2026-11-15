const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const {review}=require('../../scripts/csp-live-audit.cjs');
test('a failing advisory command cannot block publication until the explicit flag is true',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cm-csp-advisory-'));
 try{for(const flag of ['', 'false','true']){const receipt=path.join(dir,'receipt.json');const r=cp.spawnSync(process.execPath,['scripts/csp-advisory.cjs',receipt,process.execPath,'-e','process.exit(7)'],{encoding:'utf8',env:{...process.env,CM_CSP_ENFORCEMENT_APPROVED:flag}});assert.equal(r.status,flag==='true'?7:0);const e=JSON.parse(fs.readFileSync(receipt));assert.equal(e.tool_exit,7);assert.equal(e.outcome,'FAIL');assert.equal(e.mode,flag==='true'?'blocking':'advisory');}}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('live audit accepts reviewed beacon only when live header permits it; rejects unknown injection and hashes',()=>{
 const origin='https://app.chasingmajors.com',self={kind:'script',url:origin+'/app.js',origin},beacon={kind:'script',url:'https://static.cloudflareinsights.com/beacon.min.js/vabc',origin:'https://static.cloudflareinsights.com'};
 const expected={external:[self]};const inventory={inline:[],external:[self,beacon]};
 assert.deepEqual(review({headers:{reporting:"script-src 'self' https://static.cloudflareinsights.com"}},inventory,expected,origin),[]);
 assert(review({headers:{reporting:"script-src 'self'"}},inventory,expected,origin).some(x=>x.includes('blocks script origin')));
 const bad={inline:[],external:[self,{kind:'script',url:origin+'/unreviewed.js',origin}]};assert(review({headers:{reporting:"script-src 'self'"}},bad,expected,origin).some(x=>x.includes('Unreviewed injected')));
 const inline={inline:[{kind:'script',hash:'sha256-test'}],external:[self]};assert(review({headers:{reporting:"script-src 'self'"}},inline,expected,origin).some(x=>x.includes('hash missing')));
});
