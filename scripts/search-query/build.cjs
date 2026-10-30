'use strict';
// Local SQLite is an offline build workspace, never Cloudflare D1.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib'),{DatabaseSync}=require('node:sqlite');
const {load}=require('./legacy.cjs'),root=path.resolve(process.env.CM_QUERY_ROOT||path.join(__dirname,'../..')),work=process.env.CM_QUERY_WORK,out=work&&path.join(work,'derived');
if(!work)throw Error('Set CM_QUERY_WORK to an empty offline workspace outside the checkout; requires Node 24 SQLite');
if(path.resolve(work)===root||path.resolve(work).startsWith(root+path.sep))throw Error('Offline workspace must be outside the checkout');
if(process.argv.includes('--resume')||fs.existsSync(path.join(work,'build.sqlite')))throw Error('Use a fresh workspace; never reuse a database from an older source snapshot');
const sourceHash=require('./artifact.cjs').fingerprint(root);
fs.mkdirSync(out,{recursive:true});const db=new DatabaseSync(path.join(work,'build.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA cache_size=-16384;
 CREATE TABLE IF NOT EXISTS occ(id INTEGER PRIMARY KEY,view TEXT,src INTEGER,ri INTEGER,cv TEXT,chat TEXT,gid INTEGER,corder INTEGER,ident TEXT,sig TEXT);
 CREATE TABLE IF NOT EXISTS keys(k TEXT PRIMARY KEY,id INTEGER UNIQUE); CREATE TABLE IF NOT EXISTS owners(k TEXT PRIMARY KEY,ord INTEGER,oid INTEGER);
 CREATE TABLE IF NOT EXISTS baseline_sig(view TEXT,sig TEXT,ident TEXT,PRIMARY KEY(view,sig));
 CREATE TABLE IF NOT EXISTS refs(ident TEXT,src INTEGER,chunk INTEGER,PRIMARY KEY(ident,src,chunk));`);
const L=load(root),sports=['baseball','basketball','football','hockey','soccer'],base=path.join(root,'data/v1/checklists/search-index');
const read=f=>JSON.parse(fs.readFileSync(path.join(base,f),'utf8')),sha=b=>crypto.createHash('sha256').update(b).digest('hex'),clean=v=>String(v||'').trim();
const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
function leaf(f){const j=read(f);return j.sharded?j.shards.map(s=>path.posix.join(path.posix.dirname(f),s)):[f];}
const registry=read('sources.json'),sourceFiles=[],sourceIDs=new Map();
const lists={};for(const s of sports){const active=leaf(s+'.json'),hist=(registry.sources[s]||[]).flatMap(e=>leaf(e.path||('sources/'+e.file)));lists[s]={cv:active.concat(hist),chat:hist.concat(active)};}
let nextGroup=0,occurrences=0;
const keyPut=db.prepare('INSERT OR IGNORE INTO keys VALUES (?,?)'),keyGet=db.prepare('SELECT id FROM keys WHERE k=?');
const ins=db.prepare('INSERT INTO occ VALUES(NULL,?,?,?,?,?,?,?,?,?)'),sigPut=db.prepare('INSERT OR IGNORE INTO baseline_sig VALUES(?,?,?)');
const ownerPut=db.prepare('INSERT INTO owners VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET ord=excluded.ord,oid=excluded.oid WHERE excluded.ord<owners.ord');
if(process.argv.includes("--resume")){for(const s of sports)for(const f of lists[s].cv)if(!sourceIDs.has(f)){sourceIDs.set(f,sourceFiles.length);sourceFiles.push(f);}nextGroup=db.prepare("SELECT max(id) n FROM keys").get().n;occurrences=db.prepare("SELECT count(*) n FROM occ").get().n;}
if(!process.argv.includes("--resume"))for(const view of sports){const chatOrder=new Map();lists[view].chat.forEach((f,i)=>{if(!chatOrder.has(f))chatOrder.set(f,i);});
 for(const f of lists[view].cv){if(!sourceIDs.has(f)){sourceIDs.set(f,sourceFiles.length);sourceFiles.push(f);}const sid=sourceIDs.get(f),j=read(f);if(!Array.isArray(j.rows))throw Error('Missing source rows: '+f);if(j.rows.length>=100000)throw Error('Source order radix exceeded');const cvs=L.cv.normalizeSearchRows_(j.rows);
  db.exec('BEGIN');for(let ri=0;ri<j.rows.length;ri++){const raw=j.rows[ri],cv=cvs[ri],chat=L.chat.__legacy.normalizeSearchRows([raw])[0]||null;
   const k=['sport','code','section','subset','card_no','player','team','tag'].map(n=>L.cv.lower(cv[n])).join('||');let found=keyGet.get(k);if(!found){keyPut.run(k,++nextGroup);found=keyGet.get(k);}
   const ident=JSON.stringify([view,raw.player??'',raw.year??'',raw.code||raw.Code||'']),sig=sha(stable(raw)),co=chatOrder.get(f)*100000+ri;
   const result=ins.run(view,sid,ri,JSON.stringify(cv),chat?JSON.stringify(chat):null,found.id,co,ident,sig);const id=Number(result.lastInsertRowid);sigPut.run(view,sig,ident);occurrences++;
   if(chat){const ck=view+'\0'+['code','section','subset','card_no','player','team','tag'].map(n=>clean(chat[n])).join('|');ownerPut.run(ck,co,id);}
  }db.exec('COMMIT');if(occurrences%10000<j.rows.length)console.log('Indexed',view,occurrences,'row occurrences',f);
 }
}
db.exec('CREATE INDEX occ_ident ON occ(ident); CREATE INDEX owner_oid ON owners(oid);');
const entries=new Map();function emit(j){const body=Buffer.from(JSON.stringify(j)),gzip=zlib.gzipSync(body,{level:6}),h=sha(gzip),file=h+'.json.gz';fs.writeFileSync(path.join(out,file),gzip);const e={url:'/data/search-query/'+file,compressed_sha256:h,decoded_sha256:sha(body),compressed_bytes:gzip.length,decoded_bytes:body.length};entries.set(e.url,e);return e;}
const meta={schema_version:1,format:'bounded-search-v1',canonical_sha256:sourceHash,groupCount:nextGroup,sourceFiles,streams:[],names:{},rawIdentity:[],players:{}};
const chatFields=['code','displayName','year','product','sport','section','subset','card_no','player','team','tag','search_blob'];
const names=new Map(),players=new Map(),refs=db.prepare('INSERT OR IGNORE INTO refs VALUES(?,?,?)');
const rows=db.prepare('SELECT o.*,w.oid owner FROM occ o LEFT JOIN owners w ON w.oid=o.id ORDER BY o.id');let chunk=[],view=null;
function flush(){if(!chunk.length)return;const id=meta.streams.length;meta.streams.push({...emit({rows:chunk}),view,count:chunk.length});db.exec('BEGIN');for(const r of chunk){const row=db.prepare('SELECT ident FROM occ WHERE id=?').get(r[6]);refs.run(row.ident,r[4],id);}db.exec('COMMIT');chunk=[];}
for(const r of rows.iterate()){
 if(view!==r.view||chunk.length>=1024){flush();view=r.view;}
 const cv=JSON.parse(r.cv);let delta=null;
 if(r.owner!==null){const chat=JSON.parse(r.chat);delta={};for(const f of chatFields)if(JSON.stringify(cv[f])!==JSON.stringify(chat[f]))delta[f]=chat[f];const nk=r.view+'\0'+chat.player;if(!names.has(nk))names.set(nk,{view:r.view,name:chat.player,slots:new Map()});const slotKey=JSON.stringify([chat.year,chat.code]),n=names.get(nk);if(!n.slots.has(slotKey))n.slots.set(slotKey,{year:chat.year,code:chat.code,ids:new Set(),ord:r.corder});n.slots.get(slotKey).ids.add(meta.streams.length);n.slots.get(slotKey).ord=Math.min(n.slots.get(slotKey).ord,r.corder);}
 const pk=JSON.stringify([r.view,cv.player,cv.sport]);if(!players.has(pk))players.set(pk,{view:r.view,player:cv.player,sport:cv.sport,ord:r.id});
 chunk.push([cv,delta,r.gid,r.corder,r.src,r.ri,r.id]);
}flush();
for(const s of sports){meta.names[s]=[];meta.players[s]=[];let batch=[];for(const n of names.values())if(n.view===s){batch.push([n.name,[...n.slots.values()].map(x=>[x.year,x.code,[...x.ids],x.ord])]);if(batch.length===512){meta.names[s].push(emit({rows:batch}));batch=[];}}if(batch.length)meta.names[s].push(emit({rows:batch}));batch=[];for(const p of players.values())if(p.view===s){batch.push([p.player,p.sport,p.ord]);if(batch.length===512){meta.players[s].push(emit({rows:batch}));batch=[];}}if(batch.length)meta.players[s].push(emit({rows:batch}));}
let batch=[];let current=null,tuple=null,sourceRefs=[];function identFlush(){if(current===null)return;batch.push([JSON.parse(current),sourceRefs]);if(batch.length>=512){meta.rawIdentity.push(emit({rows:batch}));batch=[];}}
for(const r of db.prepare('SELECT ident,src,chunk FROM refs ORDER BY ident,src,chunk').iterate()){if(r.ident!==current){identFlush();current=r.ident;sourceRefs=[];tuple=null;}if(!tuple||tuple[0]!==r.src){tuple=[r.src,[]];sourceRefs.push(tuple);}tuple[1].push(r.chunk);}identFlush();if(batch.length)meta.rawIdentity.push(emit({rows:batch}));
if(require('./artifact.cjs').fingerprint(root)!==sourceHash)throw Error('Canonical search sources changed during build');
fs.writeFileSync(path.join(out,'index.json'),JSON.stringify(meta)+'\n');
const summary={state:'STAGED',physical_occurrences:occurrences,cv_groups:nextGroup,chat_owners:db.prepare('SELECT count(*) n FROM owners').get().n,raw_signatures:db.prepare('SELECT count(*) n FROM baseline_sig').get().n,player_year_product_identities:db.prepare('SELECT count(DISTINCT ident) n FROM occ').get().n,stream_chunks:meta.streams.length,derived_files:entries.size+1,derived_bytes:[...entries.values()].reduce((n,e)=>n+e.compressed_bytes,0)+fs.statSync(path.join(out,'index.json')).size};
fs.writeFileSync(path.join(work,'index-build.json'),JSON.stringify(summary,null,2));db.close();console.log(JSON.stringify(summary));
