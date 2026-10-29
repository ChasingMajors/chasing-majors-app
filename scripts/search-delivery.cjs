/* Derived release files only. Input JSON is never edited or deduplicated. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const PREFIX='data/v1/checklists/search-index/';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function plan(root,sha){
 if(!/^[a-f0-9]{40}$/.test(sha||''))throw Error('Exact source SHA required');
 const files={},bodies=new Map(),parsed=new Map();let rows=0,inputBytes=0;
 function walk(dir){for(const e of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){const p=path.posix.join(dir,e.name);if(e.isSymbolicLink())throw Error('Search delivery symlink rejected');if(e.isDirectory())walk(p);else if(e.isFile()){
  if(!p.endsWith('.json'))throw Error('Unexpected search source file: '+p);
  const body=fs.readFileSync(path.join(root,p));if(body.length>16*1024*1024)throw Error('Search shard exceeds reader limit: '+p);
  const j=JSON.parse(body),gzip=zlib.gzipSync(body,{level:6});
  if(!zlib.gunzipSync(gzip).equals(body))throw Error('Search byte preservation failed: '+p);
  parsed.set(p,{shards:j.shards,sources:j.sources});inputBytes+=body.length;rows+=j.rows?.length||0;
  const compressed=hash(gzip),url='/data/search-delivery/'+compressed+'.json.gz';bodies.set(url.slice(1),gzip);
  files['/'+p]={url,compressed_sha256:compressed,decoded_sha256:hash(body),compressed_bytes:gzip.length,decoded_bytes:body.length};
 }}}
 walk(PREFIX.slice(0,-1));
 const seen=new Set();
 function visit(p){if(seen.has(p))return;seen.add(p);const j=parsed.get(p);if(!j)throw Error('Missing search reference: '+p);
  for(const shard of j.shards||[]){if(typeof shard!=='string'||shard.startsWith('/')||shard.split('/').includes('..'))throw Error('Unsafe search shard reference');visit(path.posix.join(path.posix.dirname(p),shard));}
  if(j.sources)for(const entries of Object.values(j.sources)){if(!Array.isArray(entries))throw Error('Invalid source registry');for(const e of entries){const rel=e.path||e.file;if(typeof rel!=='string'||rel.startsWith('/')||rel.split('/').includes('..'))throw Error('Unsafe source reference');visit(PREFIX+(rel.startsWith('sources/')?rel:'sources/'+rel));}}
 }
 for(const sport of ['baseball','basketball','football','hockey','soccer'])visit(PREFIX+sport+'.json');visit(PREFIX+'sources.json');
 const manifest={schema_version:1,codec:'gzip-json-v1',release_sha:sha,files};
 bodies.set('data/search-delivery.json',Buffer.from(JSON.stringify(manifest)+'\n'));
 return {manifest,bodies,summary:{files:parsed.size,referenced:seen.size,physical_row_occurrences:rows,input_bytes:inputBytes,output_bytes:[...bodies.values()].reduce((n,b)=>n+b.length,0)}};
}
module.exports={plan,PREFIX,hash};
