'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function fingerprint(root){
 const dir=path.join(root,'data/v1/checklists/search-index'),files=[];
 function visit(d=''){for(const e of fs.readdirSync(path.join(dir,d),{withFileTypes:true})){const p=path.posix.join(d,e.name);if(e.isSymbolicLink())throw Error('Search source symlink');if(e.isDirectory())visit(p);else if(e.isFile()&&p.endsWith('.json'))files.push(p);}}
 visit();files.sort();const digest=crypto.createHash('sha256');for(const f of files)digest.update(f+'\0'+hash(fs.readFileSync(path.join(dir,f)))+'\n');return digest.digest('hex');
}
function stamp(root,dir){const file=path.join(dir,'index.json'),j=JSON.parse(fs.readFileSync(file)),current=fingerprint(root);if(j.canonical_sha256&&j.canonical_sha256!==current)throw Error('Source changed after index build');j.canonical_sha256=current;fs.writeFileSync(file,JSON.stringify(j)+'\n');return j.canonical_sha256;}
function plan(root,dir,sha){
 const j=JSON.parse(fs.readFileSync(path.join(dir,'index.json')));
 if(j.format!=='bounded-search-v1'||j.canonical_sha256!==fingerprint(root))throw Error('Bounded directory is stale or unbound to canonical sources');
 const entries=[...j.streams,...Object.values(j.names).flat(),...Object.values(j.players).flat(),...j.rawIdentity,...j.grams],bodies=new Map();
 for(const e of entries){if(!/^\/data\/search-query\/[a-f0-9]{64}\.json\.gz$/.test(e.url))throw Error('Unsafe bounded shard reference');if(bodies.has(e.url.slice(1)))continue;const gz=fs.readFileSync(path.join(dir,path.basename(e.url)));
  if(gz.length!==e.compressed_bytes||hash(gz)!==e.compressed_sha256)throw Error('Bounded compressed integrity mismatch');const decoded=zlib.gunzipSync(gz,{maxOutputLength:16*1024*1024});if(decoded.length!==e.decoded_bytes||hash(decoded)!==e.decoded_sha256)throw Error('Bounded decoded integrity mismatch');bodies.set(e.url.slice(1),gz);
 }
 j.release_sha=sha;bodies.set('data/search-query/index.json',Buffer.from(JSON.stringify(j)+'\n'));
 return {bodies,summary:{format:j.format,canonical_sha256:j.canonical_sha256,files:bodies.size,bytes:[...bodies.values()].reduce((n,b)=>n+b.length,0),stream_chunks:j.streams.length}};
}
module.exports={fingerprint,stamp,plan};
if(require.main===module){if(process.argv[2]!=='stamp')throw Error('Usage: artifact.cjs stamp ROOT DERIVED_DIR');console.log(stamp(path.resolve(process.argv[3]),path.resolve(process.argv[4])));}
