'use strict';
// Clean, read-only Git fetch + offline derived build. No remote writes or deploy.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict'),target=require('./target.json');
const work=path.resolve(process.argv[2]||''),source=path.join(work,'source'),state=path.join(work,'state'),site=path.join(work,'site'),git=process.env.CM_RECOVERY_GIT||'git';
const toolRoot=path.resolve(__dirname,'../..');
if(!process.argv[2]||fs.existsSync(work)||work===toolRoot||work.startsWith(toolRoot+path.sep))throw Error('Provide a NEW empty recovery path outside any source checkout');
assert.equal(process.versions.node,target.node,'Pinned Node version required');fs.mkdirSync(work,{recursive:true});fs.mkdirSync(path.join(work,'tmp'));
const env={...process.env,GIT_TERMINAL_PROMPT:'0',TMPDIR:path.join(work,'tmp'),SQLITE_TMPDIR:path.join(work,'tmp'),CM_QUERY_ROOT:source,CM_QUERY_WORK:state,LANG:'en_US.UTF-8',LC_ALL:'en_US.UTF-8',NODE_OPTIONS:'--require='+path.join(__dirname,'canonical-runtime.cjs')};
function run(cmd,args){cp.execFileSync(cmd,args,{env,stdio:'inherit',maxBuffer:4*1024*1024});}
const start=Date.now(),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const recipeFiles=['canonical-runtime.cjs','target.json','rebuild.cjs','parity.cjs','legacy-functions.cjs','reference/chat.json','reference/cv.json'].sort(),recipeDigest=crypto.createHash('sha256');
for(const f of recipeFiles)recipeDigest.update(f+'\0'+sha(fs.readFileSync(path.join(__dirname,f)))+'\n');
const recipeHash=recipeDigest.digest('hex'),recipeSource=cp.execFileSync(git,['-C',toolRoot,'rev-parse','HEAD'],{env,encoding:'utf8'}).trim();
try{
 run(git,['init',source]);run(git,['-C',source,'-c','credential.helper=','fetch','--depth=1','https://github.com/ChasingMajors/chasing-majors-app.git',target.source_sha]);run(git,['-C',source,'-c','core.autocrlf=false','checkout','--detach','FETCH_HEAD']);
 assert.equal(cp.execFileSync(git,['-C',source,'rev-parse','HEAD'],{env,encoding:'utf8'}).trim(),target.source_sha);
 for(const file of ['build.cjs','grams.cjs'])run(process.execPath,['--max-old-space-size=4096',path.join(source,'scripts/search-query',file)]);
 run(process.execPath,[path.join(source,'scripts/search-query/artifact.cjs'),'stamp',source,path.join(state,'derived')]);
 const dir=path.join(state,'derived/index.json'),meta=JSON.parse(fs.readFileSync(dir));assert.equal(meta.canonical_sha256,target.canonical_search_sha256);assert.deepEqual(Object.keys(meta).sort(),target.directory_keys.slice().sort());
 // Historical format compatibility, not data changes or dropping fields.
 const legacy=Object.fromEntries(target.directory_keys.map(k=>[k,meta[k]]));fs.writeFileSync(dir,JSON.stringify(legacy)+'\n');
 const assemble=path.join(work,'assemble.cjs');fs.writeFileSync(assemble,`const lib=require(${JSON.stringify(path.join(source,'scripts/content-release.cjs'))});lib.assemble(${JSON.stringify(source)},${JSON.stringify(site)},${JSON.stringify(target.source_sha)},{queryDirectory:${JSON.stringify(path.join(state,'derived'))},buildTime:${JSON.stringify(target.build_time)}});`);
 run(process.execPath,['--max-old-space-size=4096',assemble]);
 const files=[];function walk(d=''){for(const e of fs.readdirSync(path.join(site,d),{withFileTypes:true})){assert(!e.isSymbolicLink());const rel=path.posix.join(d,e.name);if(e.isDirectory())walk(rel);else{const b=fs.readFileSync(path.join(site,rel));files.push({path:rel,bytes:b.length,sha256:sha(b)});}}}walk();files.sort((a,b)=>a.path.localeCompare(b.path,'en-US'));
 const digest=crypto.createHash('sha256');for(const f of files)digest.update(f.path+'\0'+f.bytes+'\0'+f.sha256+'\n');const tree=digest.digest('hex'),bytes=files.reduce((n,f)=>n+f.bytes,0);
 assert.equal(tree,target.tree_sha256,'UNCHANGED accepted recovery tree mismatch');assert.equal(bytes,target.bytes);assert.equal(files.length,target.files);assert(bytes<1e9);assert.equal(sha(fs.readFileSync(path.join(site,'data/publish-release.json'))),target.manifest_sha256);
 assert.equal(cp.execFileSync(git,['-C',source,'status','--porcelain'],{env,encoding:'utf8'}).trim(),'','Frozen Git source must remain untouched');
 run(process.execPath,[path.join(__dirname,'parity.cjs'),site,path.join(work,'parity.json')]);
 const report={option:1,state:'STAGED',result:'PASS',recipe_source_sha:recipeSource,recipe_sha256:recipeHash,source_sha:target.source_sha,canonical_base:target.canonical_base_sha,node:process.versions.node,zlib:process.versions.zlib,platform:process.platform,build_time:target.build_time,gzip_os:target.gzip_os,fresh_remote_checkout:true,fresh_sqlite_and_index:true,reused_artifact:false,canonical_sha256:meta.canonical_sha256,tree_sha256:tree,manifest_sha256:target.manifest_sha256,bytes,files:files.length,parity:'PASS',wall_seconds:Math.round((Date.now()-start)/1000),production_deployed:false,d1_reads:0,d1_writes:0};fs.writeFileSync(path.join(work,'recovery-proof.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(e){fs.writeFileSync(path.join(work,'recovery-proof.json'),JSON.stringify({option:1,state:'BLOCKED',result:'FAIL',error:e.message,source_sha:target.source_sha,expected_tree:target.tree_sha256,production_deployed:false,d1_reads:0,d1_writes:0},null,2));throw e;}
