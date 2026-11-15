'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),zlib=require('node:zlib'),crypto=require('node:crypto');
const {chromium,firefox,webkit}=require('playwright');
const root=path.resolve(__dirname,'../../..'),origin='https://app.chasingmajors.com';
const mime=file=>({'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.gz':'application/gzip','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'}[path.extname(file)]||'application/octet-stream');
const baseline=JSON.parse(fs.readFileSync(path.join(__dirname,'baseline/manifest.json')));
async function launch(engine){
 const blocked=[];const proxy=http.createServer((req,res)=>{blocked.push({method:req.method,host:req.headers.host});res.writeHead(503);res.end();});proxy.on('connect',(req,socket)=>{blocked.push({method:'CONNECT',host:req.url});socket.end('HTTP/1.1 503 Fixture network isolation\r\nConnection: close\r\n\r\n');});
 await new Promise(r=>proxy.listen(0,'127.0.0.1',r));
 const browser=await ({chromium,firefox,webkit}[engine]).launch({headless:true,proxy:{server:'http://127.0.0.1:'+proxy.address().port}});
 return {browser,blocked,async close(){await browser.close();await new Promise(r=>proxy.close(r));}};
}
function originalHashes(page,kind){return baseline.moved.filter(m=>m.from===page&&m.to.endsWith(kind==='script'?'.js':'.css')).map(m=>"'sha256-"+Buffer.from(m.sha256,'hex').toString('base64')+"'").join(' ');}
async function fixture(browser,candidate,resourcesDir,mode,options={}){
 const captured=JSON.parse(fs.readFileSync(path.join(resourcesDir,'manifest.json')));
 const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1280,height:900},deviceScaleFactor:1,reducedMotion:'reduce'});
 const requests=[],unexpected=[],redirects=[];
 await context.addInitScript(()=>{
  window.__cspEvents=[];window.__beaconCalls=[];window.__embedLoaded=false;window.__themeChanges=[];window.__contentFrames=[];
  let seed=123456789;Math.random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
  window.addEventListener('message',event=>{if(event.data==='cm-csp-child-loaded')window.__embedLoaded=true;});
  document.addEventListener('securitypolicyviolation',event=>window.__cspEvents.push({directive:event.effectiveDirective,blockedURI:event.blockedURI,disposition:event.disposition,sourceFile:event.sourceFile,lineNumber:event.lineNumber}));
  const original=navigator.sendBeacon.bind(navigator);Object.defineProperty(navigator,'sendBeacon',{configurable:true,value:(url,data)=>{const u=new URL(url,location.href);window.__beaconCalls.push({origin:u.origin,path:u.pathname});return original(url,data);}});
  localStorage.setItem('cm_theme','dark');
  new MutationObserver(()=>{const value=document.documentElement?.getAttribute('data-theme');if(value&&!window.__themeChanges.some(x=>x.value===value))window.__themeChanges.push({at:performance.now(),value});}).observe(document,{attributes:true,subtree:true,childList:true,attributeFilter:['data-theme']});
  function frame(){if(document.body?.innerText.trim()&&window.__contentFrames.length<12)window.__contentFrames.push({at:performance.now(),theme:document.documentElement.getAttribute('data-theme')});if(window.__contentFrames.length<12)requestAnimationFrame(frame);}requestAnimationFrame(frame);
  if(window.parent!==window)window.addEventListener('DOMContentLoaded',()=>window.parent.postMessage('cm-csp-child-loaded','*'));
 });
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());requests.push({method:request.method(),url:request.url()});
  if(options.latency)await new Promise(r=>setTimeout(r,options.latency));
  const cors={'access-control-allow-origin':origin,'access-control-allow-credentials':'true','access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'content-type'};
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:cors});
  if(url.origin==='https://embed-check.invalid'||url.origin===origin&&url.pathname==='/__csp_parent.html')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Embedding fixture</title><iframe src="'+origin+'/checklists/"></iframe>'});
  if(captured.resources[request.url()]){const r=captured.resources[request.url()];return route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:{script:'application/javascript',css:'text/css',font:'font/woff2'}[r.kind],body:fs.readFileSync(path.join(resourcesDir,r.file))});}
  if(url.origin==='https://cloudflareinsights.com'&&url.pathname==='/cdn-cgi/rum'||url.origin===origin&&url.pathname==='/cdn-cgi/rum')return route.fulfill({status:204,headers:cors});
  if(url.origin===new URL(captured.report_endpoint).origin)return route.fulfill({status:503,headers:cors,body:'Reporting fixture unavailable'});
  if(url.origin==='https://api.chasingmajors.com'&&url.pathname==='/cv-search'){
   const cv=JSON.parse(fs.readFileSync(path.join(root,'data/v1/checklists/index.json'))).index.find(x=>x.Code==='2026-bowman-baseball');
   return route.fulfill({headers:cors,contentType:'application/json',body:JSON.stringify({ok:true,total:1,results:[{type:'product',code:cv.Code,displayName:cv.DisplayName,year:cv.year,sport:cv.sport,manufacturer:cv.manufacturer}]})});
  }
  if(url.origin==='https://script.google.com'){redirects.push({from:request.url(),to:'https://script.googleusercontent.com/macros/echo?csp_fixture=redirect'});return route.fulfill({status:302,headers:{...cors,location:'https://script.googleusercontent.com/macros/echo?csp_fixture=redirect'}});}
  if(url.origin==='https://script.googleusercontent.com')return route.fulfill({headers:cors,contentType:'application/json',body:'{"ok":true,"fixture":"redirect-target"}'});
  if(url.origin!==origin||!['GET','HEAD'].includes(request.method())){unexpected.push({url:request.url(),method:request.method()});return route.abort('blockedbyclient');}
  if(url.pathname==='/__csp_probe_allowed.js')return route.fulfill({contentType:'application/javascript',body:'window.__cspAllowedSelfRan=true;'});
  let relative=decodeURIComponent(url.pathname).replace(/^\/+/,'');if(!relative||relative.endsWith('/'))relative+='index.html';
  const file=path.resolve(root,relative);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,contentType:'text/plain',body:'Absent from committed snapshot'});
  const entry=(options.framing?candidate.variants.with_frame_ancestors:candidate.pages).find(p=>p.page===relative);
  let body=fs.readFileSync(file),headers={};
  if(entry){
   let value=mode==='live-report'?captured.pages[entry.page].report_only:entry.value;
   if(options.baseline){body=zlib.gunzipSync(fs.readFileSync(path.join(__dirname,'baseline',baseline.pages[relative].file)));for(const kind of ['script','style']){const hashes=originalHashes(relative,kind);if(hashes)value=value.replace(new RegExp(kind+'-src ([^;]+)'),(_,sources)=>kind+'-src '+sources+' '+hashes);}}
   headers[mode==='enforce'?'content-security-policy':'content-security-policy-report-only']=value;
   if(mode!=='live-report')headers['reporting-endpoints']=candidate.reporting_endpoints;
   const html=body.toString();if(/static\.cloudflareinsights\.com/.test(html))throw Error('Duplicate beacon in fixture source');body=Buffer.from(html.replace('</body>',captured.pages[entry.page].beacon_element+'</body>'));
  }
  return route.fulfill({headers,contentType:mime(file),body});
 });
 return {context,requests,unexpected,redirects,captured};
}
async function fonts(page,name){
 await page.evaluate(()=>document.fonts.ready);const result=await page.evaluate(async()=>{
  await document.fonts.load('400 32px Bangers','Chasing Majors');
  const faces=[...document.fonts].map(f=>({family:f.family.replace(/["']/g,''),status:f.status,weight:f.weight}));
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');ctx.font='32px monospace';const fallback=ctx.measureText('Chasing Majors').width;ctx.font='32px Bangers, monospace';const actual=ctx.measureText('Chasing Majors').width;
  return {faces,fallback_width:fallback,font_width:actual,loaded:faces.some(f=>f.family==='Bangers'&&f.status==='loaded')};
 });
 if(!result.loaded||Math.abs(result.fallback_width-result.font_width)<0.01)throw Error('Real Bangers font was not rendered on '+name);
 return {...result,source:name==='index.html'?'Original data: WOFF2 from externalized homepage CSS':'Real captured Google Fonts CSS and gstatic WOFF2'};
}
module.exports={launch,fixture,fonts,root,origin,baseline};
