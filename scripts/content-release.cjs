/* Pinned, validated release assembly. No remote writes, credentials or D1 access. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=(root,file)=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const safe=p=>typeof p==='string'&&/^[A-Za-z0-9_./-]+\.json$/.test(p)&&!p.split('/').includes('..')&&!p.startsWith('/');
function relativeJson(root,dir,name){if(!safe(name))throw Error('Unsafe JSON reference: '+name);return read(root,path.posix.join(dir,name));}
function cvProducts(root){
 const dir='data/v1/checklists/products',index=read(root,'data/v1/checklists/index.json').index;
 const cache=new Map(),manifest=new Map(),products=[];
 for(const e of index){
  const sport=String(e.sport||'').toLowerCase();if(!/^[a-z-]+$/.test(sport))throw Error('Invalid indexed sport: '+e.Code);
  if(!manifest.has(sport))manifest.set(sport,read(root,dir+'/'+sport+'.json'));
  const m=manifest.get(sport),file=m.product_map?.[e.Code];
  if(file&&!cache.has(file))cache.set(file,relativeJson(root,dir,file));
  const product=m.products?.[e.Code]||(file&&cache.get(file).products?.[e.Code]);
  if(!product)throw Error('Indexed CV payload missing: '+sport+'/'+e.Code);
  products.push({kind:'CV',code:e.Code,sport,index:e,product,path:file?dir+'/'+file:dir+'/'+sport+'.json',container:true});
 }
 return products;
}
function prvProducts(root,structured=false){
 const dir=structured?'data/v2/vault':'data/v1/vault',index=read(root,dir+'/index.json').index;
 const m=structured?null:read(root,dir+'/products/all.json'),cache=new Map();
 return index.map(e=>{
  const name=structured?e.file:m.product_map?.[e.Code];
  if(name&&!cache.has(name))cache.set(name,relativeJson(root,dir+'/products',name));
  const product=structured?cache.get(name):m.products?.[e.Code]||(name&&cache.get(name).products?.[e.Code]);
  if(!product)throw Error('Indexed PRV payload missing: '+e.Code);
  return {kind:structured?'PRV2':'PRV',code:e.Code,sport:String(e.sport||'').toLowerCase(),index:e,product,path:name?dir+'/products/'+name:dir+'/products/all.json',container:!structured};
 });
}
function validate(root,{probeInvalid=false}={}){
 const cv=read(root,'data/v1/checklists/index.json').index,policy=read(root,'data/prv-cv-identity-policy.json');
 if(!Array.isArray(cv))throw Error('CV index is not an array');
 const registry=cv.concat(policy.catalog_products||[]),seen=new Set();
 if(probeInvalid)registry.push({...cv[0]}); // in-memory negative fixture; source untouched
 for(const e of registry){if(!e.Code||seen.has(e.Code))throw Error('Duplicate/missing registry identity: '+e.Code);seen.add(e.Code);}
 // Reuse the existing exact/reviewed identity rules unchanged.
 require('../shared/prv-cv-identity.cjs').standardize([],cv,policy);
 for(const r of policy.reviewed_mappings||[])if(registry.filter(e=>e.Code===r.canonical_code).length!==1)throw Error('Reviewed mapping target not unique: '+r.canonical_code);
 const products=[...cvProducts(root),...prvProducts(root)];
 for(const p of products){
  if(p.product.meta?.code!==p.code||!Array.isArray(p.product.rows))throw Error('Invalid source product: '+p.code);
  if(p.kind==='CV'&&p.product.parallels!==undefined&&!Array.isArray(p.product.parallels))throw Error('Invalid parallels: '+p.code);
 }
 return products;
}
function expectedProducts(root,changedFiles,explicit=''){
 const required=new Set(explicit.split(',').map(s=>s.trim()).filter(Boolean));
 for(const file of changedFiles){
  if(/^data\/prv-calculations\/.*\.json$/.test(file)&&fs.existsSync(path.join(root,file))){
   const input=read(root,file);if(input.schema_version===4)required.add('PRV:'+input.code);
  }
  if(!/^data\/v1\/(checklists|vault)\/products\/.*\.json$/.test(file)||!fs.existsSync(path.join(root,file)))continue;
  const kind=file.startsWith('data/v1/checklists/')?'CV':'PRV';
  const j=read(root,file);for(const [code,p]of Object.entries(j.products||{}))if(p&&Array.isArray(p.rows))required.add(kind+':'+code);
  if(j.meta?.code&&Array.isArray(j.rows))required.add(kind+':'+j.meta.code);
 }
 if(changedFiles.some(f=>f.startsWith('data/cv-reviewed-imports/'))){const catalog=read(root,'data/cv-reviewed-imports/catalog.json');for(const p of catalog.products||[])required.add('CV:'+p.code);}
 for(const code of required)if(!/^(?:(?:CV|PRV):)?[A-Za-z0-9_.-]+$/.test(code))throw Error('Invalid expected product code');
 return [...required].sort();
}
function record(p){return {kind:p.kind,code:p.code,sport:p.sport,path:p.path,container:p.container,rows:p.product.rows.length,
 parallels:Array.isArray(p.product.parallels)?p.product.parallels.length:null,content_sha256:hash(JSON.stringify(p.product))};}
function matches(p,token){const parts=token.split(':'),code=parts.at(-1),kind=parts.length>1?parts[0]:null;return p.code===code&&(!kind||p.kind===kind||kind==='PRV'&&p.kind==='PRV2');}
function assertExpected(products,codes){for(const code of codes)if(!products.some(p=>matches(p,code)))throw Error('Submitted product absent after rebuild: '+code);}
function filesIn(root){const out=[];function walk(d){for(const e of fs.readdirSync(path.join(root,d),{withFileTypes:true})){if(e.name==='.git'||e.name==='.github')continue;const p=path.posix.join(d,e.name);if(e.isSymbolicLink())throw Error('Release contains symbolic link: '+p);if(e.isDirectory())walk(p);else if(e.isFile())out.push(p);}}walk('');return out.sort();}
function assemble(root,out,sha,{required=[],maxBytes=1_000_000_000,buildTime,queryDirectory}={}){
 if(!/^[a-f0-9]{40}$/.test(sha||''))throw Error('Exact release SHA required');
 if(path.resolve(root)===path.resolve(out)||path.resolve(out).startsWith(path.resolve(root)+path.sep))throw Error('Release output must be outside source checkout');
 const products=validate(root);const structured=prvProducts(root,true);assertExpected([...products,...structured],required);
 const all=[...products,...structured].map(record),selected=all.filter(p=>required.some(code=>matches(p,code)));
 // Always verify one actual CV and populated PRV product even on code-only releases.
 for(const kind of ['CV','PRV']){const p=all.find(p=>p.kind===kind&&p.rows>0);if(p&&!selected.some(x=>x.kind===p.kind&&x.code===p.code))selected.push(p);}
 const sourceFiles=filesIn(root);
 const minimum=sourceFiles.filter(p=>!p.startsWith('data/v1/checklists/search-index/')&&p!=='data/publish-release.json').reduce((n,p)=>n+fs.statSync(path.join(root,p)).size,0);
 if(minimum>maxBytes){const err=Error('Pages size guard: unchanged non-search files alone exceed '+maxBytes);err.bytes=minimum;throw err;}
 const delivery=require('./search-delivery.cjs').plan(root,sha);
 // Optional staged bounded consumer directory. It must match this canonical
 // source snapshot and is included in the same immutable, size-guarded artifact.
 if(queryDirectory){const query=require('./search-query/artifact.cjs').plan(root,queryDirectory,sha);for(const [p,b] of query.bodies)delivery.bodies.set(p,b);delivery.summary.bounded_search=query.summary;}
 // Stamp derivative artifact indexes only; source JSON remains untouched.
 for(const p of ['data/v1/checklists/index.json','data/v1/vault/index.json','data/v2/vault/index.json']){const j=read(root,p);j.release_sha=sha;delivery.bodies.set(p,Buffer.from(JSON.stringify(j)+'\n'));}
 const entries=sourceFiles.filter(p=>p!=='data/publish-release.json'&&!delivery.bodies.has(p)&&!p.startsWith('data/v1/checklists/search-index/')&&p!=='data/search-delivery.json'&&!p.startsWith('data/search-delivery/')).map(p=>{const b=fs.readFileSync(path.join(root,p));return {path:p,bytes:b.length,sha256:hash(b)};});
 for(const [p,b] of delivery.bodies)entries.push({path:p,bytes:b.length,sha256:hash(b)});
 entries.sort((a,b)=>a.path.localeCompare(b.path));
 const manifest={schema_version:1,release_sha:sha,build_time:buildTime,required_codes:required,products:selected,
 search_delivery:delivery.summary,counts:{cv:products.filter(p=>p.kind==='CV').length,prv:structured.length},files:entries,file_bytes:entries.reduce((n,e)=>n+e.bytes,0)};
 const body=JSON.stringify(manifest)+'\n',total=manifest.file_bytes+Buffer.byteLength(body);
 if(total>maxBytes){const err=Error('Pages size guard: '+total+' bytes exceeds '+maxBytes+'; existing deployment preserved.');err.bytes=total;throw err;}
 fs.mkdirSync(out,{recursive:true});
 if(fs.readdirSync(out).length)throw Error('Release output must be empty');
 for(const entry of entries){const target=path.join(out,entry.path);fs.mkdirSync(path.dirname(target),{recursive:true});if(delivery.bodies.has(entry.path))fs.writeFileSync(target,delivery.bodies.get(entry.path));else fs.copyFileSync(path.join(root,entry.path),target);}
 fs.writeFileSync(path.join(out,'data/publish-release.json'),body);
 return {...manifest,total_bytes:total,manifest_sha256:hash(body)};
}
async function verifyLive(base,expected,{fetchImpl=fetch}={}){
 const url=new URL(base);if(url.protocol!=='https:'&&url.hostname!=='127.0.0.1')throw Error('HTTPS release verification required');
 async function get(p,checkHash=false){const r=await fetchImpl(new URL(p,base.endsWith('/')?base:base+'/')+'?release='+expected.release_sha,{signal:AbortSignal.timeout(20000),cache:'no-store'});if(!r.ok)throw Error('Live release HTTP '+r.status+': '+p);const body=await r.text();if(checkHash){const entry=expected.files.find(e=>e.path===p);if(!entry||hash(body)!==entry.sha256)throw Error("Live index artifact hash mismatch: "+p);}return JSON.parse(body);}
 const live=await get('data/publish-release.json');if(hash(JSON.stringify(live))!==hash(JSON.stringify(expected)))throw Error('Live release manifest differs from immutable artifact');
 const cache=new Map();for(const e of expected.products){
  if(!cache.has(e.path))cache.set(e.path,await get(e.path));const j=cache.get(e.path),p=e.container?j.products?.[e.code]:j;
  if(!p||p.rows?.length!==e.rows||(Array.isArray(p.parallels)?p.parallels.length:null)!==e.parallels||hash(JSON.stringify(p))!==e.content_sha256)throw Error('Live product count/hash/parallel mismatch: '+e.code);
 }
 // The manifest ties the indexes and all product files to one artifact. Verify
 // the actual three live indexes too, not only a manifest claiming their hashes.
 for(const p of ['data/v1/checklists/index.json','data/v1/vault/index.json','data/v2/vault/index.json']){
  const j=await get(p,true);if(j.release_sha!==expected.release_sha)throw Error('Live index release mismatch: '+p);
  for(const token of expected.required_codes){const code=token.split(':').at(-1);if(expected.products.some(e=>matches(e,token)&&e.path.startsWith(path.posix.dirname(p)+'/'))&&!j.index.some(e=>(e.Code||e.code)===code))throw Error('New product missing from live index: '+token);}
 }
 const delivery=await get('data/search-delivery.json',true);
 if(delivery.release_sha!==expected.release_sha||delivery.codec!=='gzip-json-v1')throw Error('Live search release mismatch');
 if(expected.search_delivery?.bounded_search){
  const directory=await get('data/search-query/index.json',true);
  if(directory.release_sha!==expected.release_sha||directory.canonical_sha256!==expected.search_delivery.bounded_search.canonical_sha256||directory.format!=='bounded-search-v1')throw Error('Live bounded directory release mismatch');
  for(const entry of [directory.streams[0],Object.values(directory.names).flat()[0],Object.values(directory.players).flat()[0]]){
   if(!entry||!/^\/data\/search-query\/[a-f0-9]{64}\.json\.gz$/.test(entry.url))throw Error('Missing bounded-search sample');
   const r=await fetchImpl(new URL(entry.url,base),{signal:AbortSignal.timeout(20000),cache:'no-store'});if(!r.ok)throw Error('Live bounded shard HTTP '+r.status);
   const body=Buffer.from(await r.arrayBuffer()),decoded=body[0]===31&&body[1]===139?require('node:zlib').gunzipSync(body,{maxOutputLength:entry.decoded_bytes}):body;
   if(body[0]===31&&body[1]===139&&hash(body)!==entry.compressed_sha256)throw Error('Live bounded compressed hash mismatch');
   if(decoded.length!==entry.decoded_bytes||hash(decoded)!==entry.decoded_sha256)throw Error('Live bounded decoded hash mismatch');JSON.parse(decoded);
  }
 }
 const samplePaths=['/data/v1/checklists/search-index/baseball-001.json','/data/v1/checklists/search-index/sources/baseball-2018-001.json','/data/v1/checklists/search-index/sources.json'];
 for(const p of samplePaths){
  const entry=delivery.files[p];if(!entry)throw Error('Historical/active search sample absent: '+p);
  const r=await fetchImpl(new URL(entry.url,base),{signal:AbortSignal.timeout(20000),cache:'no-store'});if(!r.ok)throw Error('Live compressed search HTTP '+r.status);
  const body=Buffer.from(await r.arrayBuffer());
  if(body[0]===31&&body[1]===139&&hash(body)!==entry.compressed_sha256)throw Error('Live compressed search hash mismatch');
  const decoded=body[0]===31&&body[1]===139?require('node:zlib').gunzipSync(body,{maxOutputLength:entry.decoded_bytes}):body;
  if(decoded.length!==entry.decoded_bytes||hash(decoded)!==entry.decoded_sha256)throw Error('Live decoded search mismatch');JSON.parse(decoded);
 }
 return {ok:true,release_sha:live.release_sha,checked_products:expected.products.length,checked_search_files:samplePaths.length};
}
module.exports={validate,cvProducts,prvProducts,expectedProducts,record,assertExpected,assemble,verifyLive,hash};
if(require.main===module)(async()=>{
 const root=path.resolve(__dirname,'..'),[mode,...args]=process.argv.slice(2);
 if(mode==='validate'){const p=validate(root,{probeInvalid:args.includes('--probe-invalid')});console.log(JSON.stringify({validated_products:p.length}));}
 else if(mode==='expected'){
  const before=process.env.CM_BEFORE_SHA;const changed=before&&/^[a-f0-9]{40}$/.test(before)&&!/^0+$/.test(before)?cp.execFileSync('git',['diff','--name-only',before,process.env.GITHUB_SHA],{encoding:'utf8'}).trim().split('\n'):[];
  fs.writeFileSync(args[0],JSON.stringify(expectedProducts(root,changed,process.env.CM_EXPECTED_CODES||'')));
 }else if(mode==='assemble'){const m=assemble(root,path.resolve(args[0]),process.env.GITHUB_SHA,{required:JSON.parse(fs.readFileSync(args[1])),buildTime:process.env.CM_RELEASE_BUILD_TIME,queryDirectory:process.env.CM_QUERY_DIRECTORY});console.log(JSON.stringify({sha:m.release_sha,bytes:m.total_bytes,products:m.counts}));}
 else if(mode==='verify')console.log(JSON.stringify(await verifyLive(args[0],JSON.parse(fs.readFileSync(args[1])))));
 else throw Error('Unknown release command');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
