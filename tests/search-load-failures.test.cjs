const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const chatbot=fs.readFileSync('ChatBot/api.js','utf8');
const checklist=fs.readFileSync('checklists/app.js','utf8');
const base='data/v1/checklists/search-index/';
const realRegistry=JSON.parse(fs.readFileSync(base+'sources.json'));
const historical=realRegistry.sources.baseball.find(e=>e.source_key==='2018');
function chat({entry=historical,fail=null,empty=false}={}){
 const posts=[],gets=[];
 const config={STATIC_DATA_BASE:'/data/v1',CHECKLIST_EXEC_URL:'https://fixture.invalid/apps-script'};
 const cache={memCache:{playerCards:new Map(),playerYears:new Map()}};
 const utils={normalize:s=>String(s||'').trim().toLowerCase(),tokenize:s=>String(s||'').toLowerCase().split(/\s+/),makeKey:(...p)=>p.join('|'),uniq:a=>[...new Set(a)]};
 const c={window:{CMChat:{config,cache,utils}},AbortController,setTimeout,clearTimeout,console:{warn(){}},fetch:async(url,options)=>{
  if(options.method==='POST'){const body=JSON.parse(options.body);posts.push(body);return {ok:true,json:async()=>body.action==='player_years'?{years:['fallback-year']}:{ok:true,row_count:1,rows:[['fallback']]}};}
  gets.push(url);
  if(fail==='network')throw Error('Network failed');
  if(fail==='404')return {ok:false,status:404};
  if(fail==='parse')return {ok:true,json:async()=>{throw new SyntaxError('Invalid JSON');}};
  let data;
  if(url.endsWith('/sources.json'))data={sources:{baseball:empty?[]:[entry]}};
  else if(url.endsWith('/baseball.json'))data={sharded:true,shards:[]};
  else data=JSON.parse(fs.readFileSync(url.replace('/data/v1/', 'data/v1/')));
  return {ok:true,json:async()=>data};
 }};
 vm.createContext(c);vm.runInContext(chatbot,c);
 return {api:c.window.CMChat.api,posts,gets};
}
test('real path-based 2018 source provides historical player cards and player years',async()=>{
 assert(historical.path.startsWith('sources/'));assert.equal(historical.file,undefined);
 const h=chat(),cards=await h.api.getPlayerCards('Mike Trout','baseball','2018');
 assert(cards.row_count>0);assert(cards.rows.some(r=>r.some(v=>String(v).includes('2018'))));
 assert((await h.api.getPlayerYears('Mike Trout','baseball')).includes('2018'));
 assert(h.gets.some(p=>p.endsWith('/'+historical.path)));assert.equal(h.posts.length,0);
 console.log('Historical fixture: Mike Trout / 2018, '+cards.row_count+' real source rows; no Apps Script fallback');
});
test('legacy file-based historical registry entries remain supported',async()=>{
 const h=chat({entry:{file:historical.path.replace('sources/','')}});
 assert((await h.api.getPlayerCards('Mike Trout','baseball','2018')).row_count>0);assert.equal(h.posts.length,0);
});
for(const fail of ['404','network','parse'])test('ChatBot '+fail+' reaches player-card and year fallbacks',async()=>{
 const h=chat({fail});assert.equal((await h.api.getPlayerCards('Mike Trout','baseball')).row_count,1);
 assert.deepEqual(Array.from(await h.api.getPlayerYears('Mike Trout','baseball')),['fallback-year']);
 assert.deepEqual(h.posts.map(p=>p.action),['player_cards','player_years']);
});
test('ChatBot valid empty data stays empty without fallback',async()=>{
 const h=chat({empty:true});assert.equal((await h.api.getPlayerCards('No Match','baseball')).row_count,0);
 assert.equal((await h.api.getPlayerYears('No Match','baseball')).length,0);assert.equal(h.posts.length,0);
});
function cv(failure){
 const posts=[];
 const c={STATIC_DATA_BASE:'/data/v1',STATIC_SPORTS:['baseball','football'],STATIC_CACHE:{},lower:s=>String(s||'').toLowerCase(),norm:s=>String(s||'').trim(),
 loadStaticJsonCached_:async(key,url)=>{
  if(failure==='sport'&&key==='checklist_search_baseball')throw Error('HTTP 404');
  if(key==='checklist_search_source_registry')return {sources:{baseball:[{path:'sources/history.json'}]}};
  if(key.startsWith('checklist_search_source_')){if(failure==='source')throw new SyntaxError('Invalid JSON');return {rows:[]};}
  if(key==='checklist_search_baseball')return {sharded:true,shards:['baseball-test.json']};
  if(key.startsWith('checklist_search_shard_')){if(failure==='shard')throw Error('Network failed');return failure==='shape'?{}:{rows:[]};}
  return {rows:[]};
 },staticDataPathUrl_:s=>s,normalizeQuery_:s=>s,dedupeSearchRows_:a=>a,compareBroadSearchRows_:()=>0,
 q:'No Match',sport:'baseball',page:1,BROAD_PAGE_SIZE:50,
 searchViaEndpoint_:async()=>null,shouldFallbackFromEndpointResult_:r=>!r,
 api:async(action)=>{posts.push(action);return {ok:true,results:['fallback']};}};
 vm.createContext(c);
 vm.runInContext(checklist.slice(checklist.indexOf('function normalizeSearchRows_('),checklist.indexOf('function looksLikeHelpfulPlayerSuggestion_(')),c);
 vm.runInContext(checklist.slice(checklist.indexOf('async function searchStaticCards_('),checklist.indexOf('function normalizeStaticPlayer_(')),c);
 const chain=checklist.slice(checklist.indexOf('    const cardsPromise ='),checklist.indexOf('    const playerPromise ='));
 return {c,posts,search:()=>vm.runInContext('(async()=>{'+chain+'return await cardsPromise;})()',c)};
}
for(const failure of ['sport','shard','source','shape'])test('checklist '+failure+' load failure reaches Apps Script',async()=>{
 const h=cv(failure);await assert.rejects(h.c.loadStaticChecklistSearchRows_('baseball'));
 assert.equal((await h.search()).results[0],'fallback');assert.deepEqual(h.posts,['searchCards']);
});
test('checklist all-sports failure propagates rather than dropping a sport',async()=>{
 await assert.rejects(cv('sport').c.loadStaticChecklistSearchRows_('all'),/404/);
});
test('checklist valid empty results do not trigger Apps Script',async()=>{
 const h=cv();assert.equal((await h.search()).results.length,0);assert.equal(h.posts.length,0);
});
