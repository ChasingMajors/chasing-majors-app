'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {parse,sourceAllows}=require('./csp-policy-guard.cjs');
const BROWSER_HEADERS={'user-agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36','accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8','sec-fetch-dest':'document','sec-fetch-mode':'navigate','sec-fetch-site':'none'};
function allowed(url,tokens,origin){return tokens.some(token=>sourceAllows(url,token,origin));}
function review(item,inventory,expected,origin){
 const problems=[];if(inventory.error)return [inventory.error];
 const headers=[item.headers.enforcing,item.headers.reporting].filter(Boolean);
 if(!headers.length)return ['No live CSP header'];
 for(const value of headers)for(const header of value.split(',')){
  let p;try{p=parse(header);}catch(e){problems.push(e.message);continue;}
  for(const b of inventory.inline){const tokens=p[b.kind==='script'?'script-src-elem':'style-src-elem']||p[b.kind==='script'?'script-src':'style-src']||p['default-src']||[];if(!tokens.includes("'"+b.hash+"'"))problems.push('Inline '+b.kind+' hash missing from live header');}
  for(const resource of inventory.external.filter(x=>x.kind==='script')){
   const tokens=p['script-src-elem']||p['script-src']||p['default-src']||[];
   if(!allowed(resource.url,tokens,origin))problems.push('Live header blocks script origin '+resource.origin);
  }
 }
 const reviewed=new Set(expected.external.filter(x=>x.kind==='script').map(x=>x.url));
 for(const script of inventory.external.filter(x=>x.kind==='script'))if(!reviewed.has(script.url)){
  const u=new URL(script.url);if(u.origin!=='https://static.cloudflareinsights.com'||!/^\/beacon\.min\.js(?:\/v[a-z0-9]+)?$/.test(u.pathname))problems.push('Unreviewed injected script '+u.origin+u.pathname);
 }
 return [...new Set(problems)];
}
async function audit(candidate,{fetchImpl=fetch,inspectImpl}={}){
 const responses=[];
 for(const page of candidate.pages)for(const mode of ['plain','browser']){
  const r=await fetchImpl(new URL(page.paths[0],candidate.origin),{headers:mode==='browser'?BROWSER_HEADERS:{},cache:'no-store',signal:AbortSignal.timeout(20000)});
  if(!r.ok||new URL(r.url).origin!==candidate.origin||!/text\/html/i.test(r.headers.get('content-type')||''))throw Error('Unexpected live audit response');
  responses.push({page:page.page,mode,html:await r.text(),headers:{enforcing:r.headers.get('content-security-policy'),reporting:r.headers.get('content-security-policy-report-only')}});
 }
 const inspect=inspectImpl||((values)=>JSON.parse(cp.execFileSync('python3',[path.join(__dirname,'csp-policy.py'),'--inspect'],{input:JSON.stringify(values),encoding:'utf8',maxBuffer:8*1024*1024})));
 const inventory=await inspect(responses);
 const results=responses.map((r,i)=>({page:r.page,mode:r.mode,
  beacon_seen:Boolean(inventory[i].external?.some(x=>x.kind==='script'&&x.origin==='https://static.cloudflareinsights.com')),
  executable_inline:inventory[i].inline?.filter(x=>x.kind==='script').length,
  problems:review(r,inventory[i],candidate.pages.find(p=>p.page===r.page),candidate.origin)}));
 for(const result of results.filter(r=>r.mode==='browser')) if(!result.beacon_seen) result.problems.push('Expected browser-like Cloudflare beacon not observed; production-fidelity audit incomplete');
 return {source_sha:candidate.source_sha,status:results.some(r=>r.problems.length)?'BLOCKED':'PASS',results};
}
module.exports={audit,review,BROWSER_HEADERS};
if(require.main===module)(async()=>{const result=await audit(JSON.parse(fs.readFileSync(process.argv[2])));fs.writeFileSync(process.argv[3],JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));if(result.status!=='PASS')process.exitCode=1;})().catch(e=>{console.error(e.message);process.exitCode=1});
