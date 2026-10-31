'use strict';
// Non-production proof only: serve a qualified artifact locally, using the SAME
// verifier from a fresh sparse checkout. No production or D1 endpoint requests.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const site=path.resolve(process.argv[2]),manifest=JSON.parse(fs.readFileSync(path.join(site,'data/publish-release.json'))),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
for(const name of ['scripts/content-release.cjs','scripts/production-verification-url.cjs']){
 const e=manifest.files.find(e=>e.path===name);assert(e&&hash(fs.readFileSync(name))===e.sha256,'Sparse verifier differs from qualified artifact: '+name);
}
assert.equal(require('../../scripts/production-verification-url.cjs').productionVerificationUrl('http://app.chasingmajors.com/'),'https://app.chasingmajors.com/');
// A sparse checkout cannot accidentally rely on sibling data/helper modules.
const Module=require('node:module'),load=Module._load,allowed=new Set(['content-release.cjs','production-verification-url.cjs']);
Module._load=function(id,parent,main){if(!Module.isBuiltin(id)&&!allowed.has(path.basename(id)))throw Error('Unexpected verifier dependency: '+id);return load.call(this,id,parent,main);};
const {verifyLive}=require('../../scripts/content-release.cjs');let requests=0;
const server=http.createServer((req,res)=>{requests++;const name=new URL(req.url,'http://127.0.0.1').pathname,target=path.resolve(site,'.'+name);if(!target.startsWith(site+path.sep)||!fs.existsSync(target)){res.writeHead(404);res.end();return;}res.end(fs.readFileSync(target));});
(async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));try{const result=await verifyLive('http://127.0.0.1:'+server.address().port+'/',manifest);console.log(JSON.stringify({state:'STAGED_NONPRODUCTION_PROOF',dependency_closure:'builtins + two SHA-matched scripts',requests,result,manifest_sha256:hash(fs.readFileSync(path.join(site,'data/publish-release.json')))}));}finally{server.close();}})().catch(error=>{console.error(error.message);process.exitCode=1;});
