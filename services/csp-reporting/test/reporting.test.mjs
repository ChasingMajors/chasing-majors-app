import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler,sanitizeReport,parseReports,record,purge,RETENTION_MS,MAX_BYTES,DAILY_REPORT_CAP} from '../core.mjs';
import {localEnvironment,startLocal} from '../local.mjs';
const raw={'document-uri':'https://app.chasingmajors.com/vault/?query=PRIVATE-QUERY#PRIVATE-FRAGMENT','effective-directive':'script-src-elem','blocked-uri':'https://static.cloudflareinsights.com/beacon.min.js?PRIVATE-URL','referrer':'https://PRIVATE-REFERRER','script-sample':'PRIVATE-SAMPLE','source-file':'https://PRIVATE-SOURCE','user-agent':'PRIVATE-UA'};
const request=(value={'csp-report':raw},type='application/csp-report',headers={})=>new Request('https://csp-report.chasingmajors.com/report',{method:'POST',headers:{'content-type':type,'cf-connecting-ip':'198.51.100.17',...headers},body:JSON.stringify(value)});
async function summary(env){return createHandler().fetch(new Request('https://collector/summary',{headers:{authorization:'Bearer '+env.SUMMARY_TOKEN}}),env);}

test('legacy and Reporting API reports persist only anonymous allowlisted counters',async()=>{
 const {env,storage}=localEnvironment();const h=createHandler();assert.equal((await h.fetch(request(),env)).status,204);
 const modern=[{type:'csp-violation',url:'https://PRIVATE-ENVELOPE',user_agent:'PRIVATE-UA',body:{documentURL:raw['document-uri'],effectiveDirective:'script-src-elem',blockedURL:raw['blocked-uri'],sample:'PRIVATE-SAMPLE'}}];
 assert.equal((await h.fetch(request(modern,'application/reports+json'),env)).status,204);
 const json=await (await summary(env)).json();assert.equal(json.total,2);assert.deepEqual(Object.keys(json.counts[0]).sort(),['blocked_origin','count','directive','hour','page']);assert.equal(json.counts[0].page,'/vault/');
 const all=JSON.stringify([...storage.data]);for(const secret of ['PRIVATE','198.51.100.17','beacon.min.js','user-agent','referrer','token='])assert(!all.includes(secret));
 for(const key of env.CLIENT_RATE.counters.keys())assert.match(key,/^[a-f0-9]{64}$/);
});
test('origin categories never store arbitrary domains, extension identifiers or data URLs',()=>{
 for(const [value,expected]of [['https://private-person.example/path?secret','unknown-origin'],['chrome-extension://PRIVATE-ID/a','extension'],['moz-extension://PRIVATE-ID/a','extension'],['data:text/html,PRIVATE','data'],['blob:https://private.example/id','blob'],['eval','eval']])assert.equal(sanitizeReport({...raw,'blocked-uri':value}).blocked_origin,expected);
});
test('schema, method, content type and origin checks reject invalid input without writes',async()=>{
 const {env,storage}=localEnvironment();const h=createHandler();
 for(const [r,status]of [[new Request('https://x/report'),405],[request({},'application/csp-report'),400],[request({},'application/json'),415],[request(undefined,undefined,{origin:'https://evil.example'}),403],[request({'csp-report':{...raw,'document-uri':'https://evil.example/vault/'}}),400],[request({'csp-report':{...raw,'document-uri':'https://app.chasingmajors.com/schedule/'}}),400],[request({'csp-report':{...raw,'effective-directive':'arbitrary'}}),400],[request([{type:'network-error',body:{}}],'application/reports+json'),400]])assert.equal((await h.fetch(r,env)).status,status);
 assert.equal(storage.data.size,0);
});
test('declared and streamed oversized bodies are capped; invalid UTF-8/JSON rejected',async()=>{
 const {env}=localEnvironment({clientLimit:100});const h=createHandler();
 assert.equal((await h.fetch(request({},undefined,{'content-length':String(MAX_BYTES+1)}),env)).status,413);
 const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(MAX_BYTES));c.enqueue(new Uint8Array(1));c.close();}});
 const streamed=new Request('https://x/report',{method:'POST',headers:{'content-type':'application/csp-report'},body:stream,duplex:'half'});
 assert.equal((await h.fetch(streamed,env)).status,413);
 assert.equal((await h.fetch(new Request('https://x/report',{method:'POST',headers:{'content-type':'application/csp-report'},body:new Uint8Array([255])}),env)).status,400);
 assert.equal((await h.fetch(new Request('https://x/report',{method:'POST',headers:{'content-type':'application/csp-report'},body:'{' }),env)).status,400);
});
test('per-client and global admission limits fail closed',async()=>{
 const h=createHandler(),a=localEnvironment({clientLimit:1});assert.equal((await h.fetch(request(),a.env)).status,204);assert.equal((await h.fetch(request(),a.env)).status,429);
 const b=localEnvironment({globalLimit:1,clientLimit:100});assert.equal((await h.fetch(request(),b.env)).status,204);assert.equal((await h.fetch(request(undefined,undefined,{'cf-connecting-ip':'203.0.113.25'}),b.env)).status,429);
 const noBinding={...b.env,GLOBAL_RATE:null};assert.equal((await h.fetch(request(),noBinding)).status,503);
});
test('transactional aggregation preserves concurrent reports; daily cap bounds stored counts',async()=>{
 const {storage}=localEnvironment();const row=sanitizeReport(raw),now=Date.now();await Promise.all(Array.from({length:20},()=>record(storage,[row],now)));
 assert.equal([...(await storage.list({prefix:'count:'})).values()][0].count,20);
 const day=Math.floor(now/86400000)*86400000;await storage.put('budget-day:'+day,{hour:day,count:DAILY_REPORT_CAP});assert.equal(await record(storage,[row],now),false);
});
test('retention deletes old counters and summary shows no expired records',async()=>{
 const {storage}=localEnvironment();const now=Date.now();await record(storage,[sanitizeReport(raw)],now-RETENTION_MS-7200000);await record(storage,[sanitizeReport(raw)],now);await purge(storage,now);
 assert([...storage.data.values()].every(v=>v.hour>=now-RETENTION_MS));assert.equal((await storage.list({prefix:'count:'})).size,1);
});
test('summary requires a secret and escapes labels; collector outages never forward data',async()=>{
 const {env}=localEnvironment();const h=createHandler();assert.equal((await h.fetch(new Request('https://x/summary'),env)).status,401);assert.equal((await h.fetch(new Request('https://x/summary',{headers:{authorization:'Bearer wrong'}}),env)).status,401);
 await h.fetch(request(),env);const html=await h.fetch(new Request('https://x/summary',{headers:{authorization:'Bearer '+env.SUMMARY_TOKEN,accept:'text/html'}}),env);assert.equal(html.status,200);const body=await html.text();assert(body.includes('CSP report summary'));assert(!body.includes('PRIVATE'));
 const down={...env,REPORTS:{idFromName:x=>x,get:()=>({fetch:async()=>{throw Error('offline');}})}};assert.equal((await h.fetch(request(),down)).status,503);
});
test('real local HTTP round trip accepts a report and exposes only sanitized summary',async t=>{
 const local=await startLocal();t.after(()=>new Promise(resolve=>local.server.close(resolve)));
 assert.equal((await fetch(local.url+'/report',{method:'POST',headers:{'content-type':'application/csp-report'},body:JSON.stringify({'csp-report':raw})})).status,204);
 const r=await fetch(local.url+'/summary',{headers:{authorization:'Bearer '+local.env.SUMMARY_TOKEN}});assert.equal(r.status,200);const j=await r.json();assert.equal(j.total,1);assert.equal(j.counts[0].blocked_origin,'https://static.cloudflareinsights.com');assert(!JSON.stringify(j).includes('PRIVATE'));
});
