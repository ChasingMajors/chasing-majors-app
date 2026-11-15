'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto'),cp=require('node:child_process'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..'),baseline=path.join(__dirname,'baseline');
const manifest=JSON.parse(fs.readFileSync(path.join(baseline,'manifest.json'))),data=JSON.parse(fs.readFileSync(path.join(baseline,'data-paths.json')));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
for(const [page,item]of Object.entries(manifest.pages)){
 const old=zlib.gunzipSync(fs.readFileSync(path.join(baseline,item.file)));assert.equal(hash(old),item.sha256);
 let current=fs.readFileSync(path.join(root,page),'utf8');
 for(const move of manifest.moved.filter(m=>m.from===page)){
  const body=fs.readFileSync(path.join(root,move.to));assert.equal(hash(body),move.sha256);assert.equal(body.length,move.bytes);
  const tag=move.to.endsWith('.css')?'<link rel="stylesheet" href="/'+move.to+'">':'<script src="/'+move.to+'"></script>';
  assert(current.includes(tag),'Synchronous original-position resource required');
  current=current.replace(tag,move.to.endsWith('.css')?'<style>'+body.toString()+'</style>':'<script>'+body.toString()+'</script>');
 }
 assert.equal(current,old.toString(),'Only exact externalization substitutions permitted in '+page);
}
const raw=cp.execFileSync(process.env.CM_PROOF_GIT||'git',['-C',root,'ls-tree','-r','-z','HEAD','--',...data.paths]).toString();const actual={};
for(const item of raw.split('\0').filter(Boolean)){const [meta,name]=item.split('\t');actual[name]=meta.split(' ')[2];}
assert.deepEqual(actual,data.git_blobs,'Data or consumer path bytes changed during migration');
const report={source_baseline:manifest.source_sha,moved_payloads:manifest.moved.length,moved_payloads_byte_identical:true,html_reconstruction_byte_identical:true,data_consumer_paths:Object.keys(actual).length,data_consumer_git_blobs_identical:true};
if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
