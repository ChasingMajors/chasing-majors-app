const {test}=require('node:test'),assert=require('node:assert/strict'),{create}=require('../shared/bounded-search.js');
function fixture(chunks,{players=[],names=[]}={}){
 const data=new Map(),entries=chunks.map((rows,i)=>{const e={url:'chunk'+i,view:'baseball',decoded_bytes:100};data.set(e.url,{rows});return e;});
 data.set('players',{rows:players});data.set('names',{rows:names});let fetches=0,reads=0;
 const meta={format:'bounded-search-v1',schema_version:1,groupCount:4000,streams:entries,players:{baseball:[{url:'players',decoded_bytes:100}]},names:{baseball:[{url:'names',decoded_bytes:100}]}};
 const engine=create({fetchImpl:async()=>{fetches++;return {ok:true,json:async()=>meta};},reader:{read:async e=>{reads++;if(!data.has(e.url))throw Error('HTTP 404');return data.get(e.url);}},cacheBytes:512});
 return {engine,data,counts:()=>({fetches,reads})};
}
const record=(player,gid,ord,extra={})=>[{player,sport:'baseball',...extra},{},gid,ord,0,ord,ord];
const cmp=(a,b)=>a.player.localeCompare(b.player),page=(engine,p=1)=>engine.cvPage({q:'yes',sport:'baseball',page:p,pageSize:50,tokens:[],match:r=>r.player.includes('yes'),compare:cmp});
test('filter-before-dedup preserves matching variants and first matching row',async()=>{
 const f=fixture([[record('no',1,1),record('yes-first',1,2),record('yes-second',1,3),record('yes-other',2,4)]]);
 const out=await f.engine.cvPage({q:'yes',sport:'baseball',page:1,pageSize:50,tokens:['yes'],match:r=>r.player.startsWith('yes'),compare:()=>0});
 assert.equal(out.total,2);assert.deepEqual(out.results.map(r=>r.player),['yes-first','yes-other']);
});
test('deep pages preserve exact count/order with a bounded result window',async()=>{
 const chunks=[];for(let i=0;i<1500;i+=100)chunks.push(Array.from({length:100},(_,j)=>record('yes-'+String(i+j).padStart(4,'0'),i+j+1,i+j+1)));
 const f=fixture(chunks),out=await f.engine.cvPage({q:'yes',sport:'baseball',page:25,pageSize:50,tokens:['yes'],match:()=>true,compare:cmp});
 assert.equal(out.total,1500);assert.equal(out.results[0].player,'yes-1200');assert.equal(out.results.at(-1).player,'yes-1249');assert(f.engine.stats().decoded_cache_weight<=512);
});
test('canonical ChatBot owners and original order survive source overlap',async()=>{
 const first=record('Mike Trout',1,20,{year:'2018',code:'A'}),other=record('Mike Trout',2,10,{year:'2017',code:'B'}),duplicate=record('Mike Trout',1,30,{year:'2018',code:'A'});duplicate[1]=null;
 const f=fixture([[first,other,duplicate]],{names:[['Mike Trout',[['2018','A',[0],20],['2017','B',[0],10]]]]});
 assert.deepEqual(await f.engine.chatYears('baseball','Mike',r=>r.player.startsWith('Mike')),['2017','2018']);
 const rows=await f.engine.chatRows('baseball','Mike','',r=>r.player.startsWith('Mike'));assert.deepEqual(rows.map(r=>r.code),['B','A']);
});
test('cached no-sport name enrichment issues no additional fetch/read',async()=>{
 const f=fixture([],{players:[['Owen Power','hockey',1]]});const opts={q:'Owen',sport:'baseball',limit:5,helpful:(q,r)=>r.player.startsWith(q),score:()=>1,normalize:s=>s.toLowerCase()};
 await f.engine.playerHits(opts);const before=f.counts();const hits=await f.engine.playerHits({...opts,sport:''});assert.equal(hits[0].player,'Owen Power');assert.deepEqual(f.counts(),before);
});
test('missing chunk propagates as failure; valid empty result remains empty',async()=>{
 const f=fixture([[record('no',1,1)]]);const opts={q:'yes',sport:'baseball',page:1,pageSize:50,tokens:['yes'],match:r=>r.player==='yes',compare:cmp};
 assert.equal((await f.engine.cvPage(opts)).total,0);f.data.delete('chunk0');const g=fixture([[record('no',1,1)]]);g.data.delete('chunk0');await assert.rejects(g.engine.cvPage(opts),/404/);
});
test('weighted result cache evicts instead of retaining an unbounded history',()=>{
 const e=create(),m=new Map();for(let i=0;i<30;i++)e.put(m,i,'x'.repeat(100000));assert(e.stats().result_weight<=e.stats().result_budget);assert(m.size<30);assert.equal(m.get(29).length,100000);
});
