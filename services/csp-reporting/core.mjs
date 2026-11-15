// Standalone CSP collector. No D1/service binding, raw report storage or payload logging.
export const ORIGIN='https://app.chasingmajors.com';
export const MAX_BYTES=16384, MAX_BATCH=16, RETENTION_MS=8*86400000, DAILY_REPORT_CAP=2000;
const PAGES=new Map([['/','/'],['/index.html','/'],['/checklists/','/checklists/'],['/checklists/index.html','/checklists/'],['/vault/','/vault/'],['/vault/index.html','/vault/'],['/ChatBot/','/ChatBot/'],['/ChatBot/index.html','/ChatBot/']]);
const DIRECTIVES=new Set('default-src script-src script-src-elem script-src-attr style-src style-src-elem style-src-attr img-src font-src connect-src frame-src frame-ancestors base-uri object-src worker-src media-src manifest-src form-action'.split(' '));
const ORIGINS=new Set([ORIGIN,'https://api.chasingmajors.com','https://static.cloudflareinsights.com','https://cloudflareinsights.com','https://script.google.com','https://script.googleusercontent.com','https://fonts.googleapis.com','https://fonts.gstatic.com']);
const SPECIAL=new Set(['inline','eval','data','blob','extension','unknown-origin','unknown-scheme']);
const text=(message,status,headers={})=>new Response(message,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
function fail(status){throw Object.assign(new Error('Invalid CSP report'),{status});}
export function sanitizeReport(raw,modern=false){
 if(!raw||Array.isArray(raw)||typeof raw!=='object')fail(400);
 const documentURL=raw[modern?'documentURL':'document-uri'];let url;
 try{url=new URL(documentURL);}catch{fail(400);}
 if(url.origin!==ORIGIN||url.username||url.password||!PAGES.has(url.pathname))fail(400);
 const directive=raw[modern?'effectiveDirective':'effective-directive'];
 if(typeof directive!=='string'||!DIRECTIVES.has(directive))fail(400);
 const value=raw[modern?'blockedURL':'blocked-uri'];if(typeof value!=='string'||value.length>4096)fail(400);
 let blocked;
 if(value==='inline'||value==='eval')blocked=value;
 else if(/^data:/i.test(value))blocked='data';
 else if(/^blob:/i.test(value))blocked='blob';
 else if(/^(chrome|moz|safari-web)-extension:/i.test(value))blocked='extension';
 else{try{const u=new URL(value);blocked=['https:','http:'].includes(u.protocol)?(ORIGINS.has(u.origin)?u.origin:'unknown-origin'):'unknown-scheme';}catch{blocked='unknown-origin';}}
 // Only three allowlisted/normalized fields survive. Referrer, query/fragment,
 // samples, source files, user agents, IPs and extension identifiers are discarded.
 return {page:PAGES.get(url.pathname),directive,blocked_origin:blocked};
}
export function parseReports(value,contentType){
 if(contentType==='application/csp-report'){
  if(!value||!Object.prototype.hasOwnProperty.call(value,'csp-report'))fail(400);
  return [sanitizeReport(value['csp-report'])];
 }
 if(!Array.isArray(value)||!value.length||value.length>MAX_BATCH)fail(400);
 return value.map(item=>{if(item?.type!=='csp-violation')fail(400);return sanitizeReport(item.body,true);});
}
async function readLimited(request){
 const declared=request.headers.get('content-length');if(declared&&(!/^\d+$/.test(declared)||Number(declared)>MAX_BYTES))fail(413);
 if(!request.body)fail(400);const reader=request.body.getReader();const chunks=[];let length=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>MAX_BYTES){await reader.cancel();fail(413);}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail(400);}
}
async function clientKey(request,salt,now){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(salt),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const source=Math.floor(now/86400000)+':'+(request.headers.get('cf-connecting-ip')||'missing');
 const digest=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(source));
 return Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
}
async function authorized(request,secret){
 if(typeof secret!=='string'||secret.length<24)return false;
 const received=request.headers.get('authorization')||'';if(received.length>512)return false;
 const a=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(received)));
 const b=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('Bearer '+secret)));
 return a.reduce((acc,v,i)=>acc|(v^b[i]),0)===0;
}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function summaryHtml(summary){return '<!doctype html><meta charset="utf-8"><title>CSP report summary</title><h1>CSP report summary</h1><p>Anonymous counts only; rolling eight-day retention. Unknowns require review; zero reports alone does not prove adequate traffic.</p><p>Total reports: '+summary.total+'</p><table><thead><tr><th>UTC hour</th><th>Page</th><th>Directive</th><th>Blocked origin/category</th><th>Count</th></tr></thead><tbody>'+summary.counts.map(r=>'<tr>'+[new Date(r.hour).toISOString(),r.page,r.directive,r.blocked_origin,r.count].map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table>';}
export function createHandler({clock=Date.now}={}){return {async fetch(request,env){
 const url=new URL(request.url);
 if(url.pathname==='/health'&&request.method==='GET')return text('CSP collector',200);
 if(url.pathname==='/summary'&&request.method==='GET'){
  if(!await authorized(request,env.SUMMARY_TOKEN))return text('Unauthorized',401,{'www-authenticate':'Bearer'});
  try{const result=await env.REPORTS.get(env.REPORTS.idFromName('aggregate-v1')).fetch('https://internal/summary?now='+clock());if(!result.ok)return text('Summary unavailable',503);const summary=await result.json();return request.headers.get('accept')?.includes('text/html')?text(summaryHtml(summary),200,{'content-type':'text/html; charset=utf-8','content-security-policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'"}):text(JSON.stringify(summary),200,{'content-type':'application/json'});}catch{return text('Summary unavailable',503);}
 }
 if(url.pathname!=='/report')return text('Not found',404);
 const from=request.headers.get('origin');if(from&&from!==ORIGIN)return text('Forbidden',403);
 const cors={'access-control-allow-origin':ORIGIN,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'Content-Type','vary':'Origin'};
 if(request.method==='OPTIONS')return text(null,204,cors);
 if(request.method!=='POST')return text('Method not allowed',405,{'allow':'POST, OPTIONS'});
 const type=(request.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
 if(!['application/csp-report','application/reports+json'].includes(type))return text('Unsupported report type',415,cors);
 if(!env.REPORTS||!env.CLIENT_RATE||!env.GLOBAL_RATE||typeof env.RATE_SALT!=='string'||env.RATE_SALT.length<24)return text('Reporting unavailable',503,cors);
 try{
  const now=clock();
  if(!(await env.GLOBAL_RATE.limit({key:'csp-reports'})).success||!(await env.CLIENT_RATE.limit({key:await clientKey(request,env.RATE_SALT,now)})).success)return text('Rate limited',429,{...cors,'retry-after':'60'});
  const rows=parseReports(await readLimited(request),type);
  const response=await env.REPORTS.get(env.REPORTS.idFromName('aggregate-v1')).fetch(new Request('https://internal/record',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({at:now,rows})}));
  if(response.status===429)return text('Aggregate admission limit reached',429,{...cors,'retry-after':'60'});
  if(!response.ok)return text('Reporting unavailable',503,cors);
  return text(null,204,cors);
 }catch(error){return text(error.status===413?'Report too large':error.status===400?'Invalid report':'Reporting unavailable',error.status||503,cors);}
 }};}
export default createHandler();
export async function purge(storage,now){
 const cutoff=now-RETENTION_MS;
 for(const [key,value] of await storage.list())if(value.hour<cutoff)await storage.delete(key);
}
export async function record(storage,rows,now){
 if(!Number.isSafeInteger(now)||!Array.isArray(rows)||!rows.length||rows.length>MAX_BATCH)fail(400);
 for(const row of rows)if(Object.keys(row).sort().join(',')!=='blocked_origin,directive,page'||!PAGES.has(row.page)||!DIRECTIVES.has(row.directive)||!(ORIGINS.has(row.blocked_origin)||SPECIAL.has(row.blocked_origin)))fail(400);
 return storage.transaction(async tx=>{
  const day=Math.floor(now/86400000)*86400000,minute=Math.floor(now/60000)*60000,hour=Math.floor(now/3600000)*3600000;
  const d=await tx.get('budget-day:'+day)||{hour:day,count:0},m=await tx.get('budget-minute:'+minute)||{hour:hour,count:0};
  if(d.count+rows.length>DAILY_REPORT_CAP||m.count+rows.length>120)return false;
  d.count+=rows.length;m.count+=rows.length;await tx.put('budget-day:'+day,d);await tx.put('budget-minute:'+minute,m);
  for(const row of rows){const key='count:'+hour+':'+JSON.stringify(row);const old=await tx.get(key)||{hour,...row,count:0};old.count++;await tx.put(key,old);}
  return true;
 });
}
export class ReportStore{
 constructor(state){this.state=state;}
 async fetch(request){
  const url=new URL(request.url);
  if(url.pathname==='/record'&&request.method==='POST'){
   try{const {at,rows}=await request.json();await purge(this.state.storage,at);const accepted=await record(this.state.storage,rows,at);if(!await this.state.storage.getAlarm())await this.state.storage.setAlarm(at+3600000);return text(null,accepted?204:429);}catch{return text('Invalid aggregate',400);}
  }
  if(url.pathname==='/summary'){
   const now=Number(url.searchParams.get('now'));if(!Number.isSafeInteger(now))return text('Invalid time',400);
   await purge(this.state.storage,now);const counts=[...(await this.state.storage.list({prefix:'count:'})).values()].filter(r=>r.hour>=now-RETENTION_MS).sort((a,b)=>a.hour-b.hour||a.page.localeCompare(b.page));return text(JSON.stringify({retention_hours:192,total:counts.reduce((n,r)=>n+r.count,0),counts}),200,{'content-type':'application/json'});
  }
  return text('Not found',404);
 }
 async alarm(){await purge(this.state.storage,Date.now());if((await this.state.storage.list({limit:1})).size)await this.state.storage.setAlarm(Date.now()+3600000);}
}
