import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import cp from 'node:child_process';
import assert from 'node:assert/strict';
const cli=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]);fs.mkdirSync(out,{recursive:true});
const config=path.resolve(import.meta.dirname,'../wrangler.jsonc');
const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const token='local-only-summary-token-for-runtime';let stdout='',stderr='';
const child=cp.spawn(process.execPath,[cli,'dev','--local','--ip','127.0.0.1','--port',String(port),'--config',config,'--persist-to',path.join(out,'state'),'--var','SUMMARY_TOKEN:'+token,'--var','RATE_SALT:local-only-rate-salt-for-runtime'],{cwd:out,env:{...process.env,CI:'1',WRANGLER_SEND_METRICS:'false',WRANGLER_LOG_PATH:path.join(out,'wrangler.log')},stdio:['ignore','pipe','pipe']});
child.stdout.on('data',b=>stdout=(stdout+b).slice(-100000));child.stderr.on('data',b=>stderr=(stderr+b).slice(-100000));
const url='http://127.0.0.1:'+port;const result={scope:'Local workerd only; no cloud resources/D1',status:'FAIL'};
try{
 let ready=false;for(let i=0;i<200;i++){if(child.exitCode!==null)throw Error('Local runtime exited '+child.exitCode);try{if((await fetch(url+'/health',{signal:AbortSignal.timeout(300)})).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert(ready,'Local Worker readiness timeout');
 const body={'csp-report':{'document-uri':'https://app.chasingmajors.com/checklists/?PRIVATE-QUERY','effective-directive':'connect-src','blocked-uri':'https://cloudflareinsights.com/cdn-cgi/rum?PRIVATE-QUERY','script-sample':'PRIVATE-SAMPLE'}};
 const post=()=>fetch(url+'/report',{method:'POST',headers:{'content-type':'application/csp-report'},body:JSON.stringify(body)});
 assert.equal((await post()).status,204);assert.equal((await fetch(url+'/summary')).status,401);
 assert.equal((await fetch(url+'/report',{method:'POST',headers:{'content-type':'application/csp-report'},body:'x'.repeat(16385)})).status,413);
 const responses=await Promise.all(Array.from({length:5},post));assert(responses.every(r=>r.status===204));
 const summary=await (await fetch(url+'/summary',{headers:{authorization:'Bearer '+token}})).json();assert.equal(summary.total,6);assert(!JSON.stringify(summary).includes('PRIVATE'));assert.equal(summary.counts[0].page,'/checklists/');
 const html=await fetch(url+'/summary',{headers:{authorization:'Bearer '+token,accept:'text/html'}});assert.equal(html.status,200);assert((await html.text()).includes('CSP report summary'));
 const limited=[];for(let i=0;i<35;i++)limited.push((await post()).status);assert(limited.includes(429),'Native rate limiter must reject a burst');
 Object.assign(result,{status:'PASS',http_round_trip:true,sqlite_durable_object:true,concurrent_reports:6,raw_values_absent:true,native_rate_limit_observed:true,protected_html_summary:true,d1_bindings:0,cloud_deployments:0});
}catch(e){result.error=e.message;process.exitCode=1;}
finally{child.kill('SIGTERM');await new Promise(r=>{if(child.exitCode!==null)return r();child.once('exit',r);setTimeout(()=>{if(child.exitCode===null)child.kill('SIGKILL');r();},5000).unref();});fs.writeFileSync(path.join(out,'runtime-proof.json'),JSON.stringify(result,null,2)+'\n');fs.writeFileSync(path.join(out,'stdout.txt'),stdout);fs.writeFileSync(path.join(out,'stderr.txt'),stderr);console.log(JSON.stringify(result));}
