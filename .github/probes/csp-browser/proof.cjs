 'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {launch,fixture,fonts,root,origin}=require('./fixture.cjs');
const candidate=JSON.parse(fs.readFileSync(process.argv[2]));
const out=process.argv[3],resources=process.argv[4],engine=process.env.BROWSER_ENGINE||'chromium';
assert.equal(process.env.GITHUB_REF,'refs/heads/stage/csp-lean-finish');
assert.equal(candidate.source_sha,process.env.GITHUB_SHA);
fs.mkdirSync(out,{recursive:true});
const cv=JSON.parse(fs.readFileSync(path.join(root,'data/v1/checklists/index.json'))).index;
const prv=JSON.parse(fs.readFileSync(path.join(root,'data/v1/vault/index.json'))).index;
const homeProduct=cv.find(x=>x.Code==='2026-bowman-baseball');
const checklist=cv.find(x=>x.Code==='2026_bowman_sapphire_football_football_checklist');
const vaultProduct=prv.find(x=>x.Code==='19TFmbl');
const report={state:'STAGED',source_sha:candidate.source_sha,engine,cases:[],browser_remote_requests_continued:0,d1_reads:0,d1_writes:0,
limitations:['Intercepted source-data flows; no real API/Apps Script or analytics writes','WebKit engine on Linux; not physical iPhone acceptance','Homepage observed report-only is expected to flag the Cloudflare script','Owner clean-profile console check and Kiro review remain required']};
let launched;
async function functionalFlow(page, name) {
  if (name === 'index.html') {
    assert(await page.evaluate(() => Boolean(window.CMHomeSearch && window.CMGuided)), 'Home scripts must run');
    await page.getByRole('button', {name: /Checklist search/}).click();
    await page.getByRole('button', {name: 'Football', exact: true}).click();
    await page.getByRole('heading', {name: 'Which year?'}).waitFor();
    await page.locator('#searchInput').fill(homeProduct.DisplayName);
    await page.locator('#searchForm button[type=submit]').click();
    await page.locator('#results .resultCard').first().waitFor();
    assert((await page.locator('#results').innerText()).includes(homeProduct.DisplayName));
    await page.locator('#results a[href^="/vault/"]').first().waitFor({timeout: 15000});
    return 'guided mode/sport + direct search + actual static PRV hydration';
  }
  if (name === 'checklists/index.html') {
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark', 'Inline bootstrap must run');
    await page.waitForFunction(code => typeof INDEX !== 'undefined' && INDEX.some(row => row.Code === code) &&
      typeof initDone !== 'undefined' && initDone, checklist.Code);
    await page.locator('#sport').selectOption(checklist.sport);
    await page.locator('#q').fill(checklist.DisplayName);
    await page.locator('#dropdown [data-code="' + checklist.Code + '"]').waitFor();
    await page.locator('#dropdown [data-code="' + checklist.Code + '"]').click();
    await page.locator('#btnSearch').click();
    await page.waitForFunction(() => document.querySelectorAll('#results .cv-tab-btn').length > 0, null, {timeout: 20000});
    assert((await page.locator('#results').innerText()).includes('Bowman'));
    return 'real catalog autocomplete + actual static checklist rows/section tabs';
  }
  if (name === 'vault/index.html') {
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    await page.waitForFunction(code => typeof INDEX !== 'undefined' && INDEX.some(row => row.Code === code) &&
      typeof initDone !== 'undefined' && initDone, vaultProduct.Code);
    await page.locator('#q').fill(vaultProduct.DisplayName);
    await page.locator('#dropdown [data-code="' + vaultProduct.Code + '"]').waitFor();
    await page.locator('#dropdown [data-code="' + vaultProduct.Code + '"]').click();
    await page.locator('#btnSearch').click();
    await page.waitForFunction(() => /2019 Topps Finest Baseball/.test(document.querySelector('#results').textContent) &&
      !/Loading print runs/.test(document.querySelector('#results').textContent), null, {timeout: 20000});
    return 'real catalog autocomplete + actual static print-run rows';
  }
  await page.locator('#chatMessages .message-row.assistant').first().waitFor();
  await page.locator('#chatInput').fill('Print runs for 2019 Topps Finest Baseball');
  await page.locator('#sendBtn').click();
  await page.waitForFunction(() => document.querySelectorAll('#chatMessages .message-row.assistant').length >= 2 &&
    !document.querySelector('#chatMessages [data-loading-bubble]'), null, {timeout: 30000});
  const response = await page.locator('#chatMessages .message-row.assistant').last().innerText();
  assert(/Finest/i.test(response), 'Chat must render the requested product response');
  assert(!/could not load|couldn't load|temporarily unavailable/i.test(response));
  return 'welcome + actual local-data print-run query and rendered response';
}

(async()=>{
 launched=await launch(engine);report.browser=launched.browser.version();
 for(const entry of candidate.pages){
  const home=entry.page==='index.html',mode=home?'live-report':'enforce';
  const f=await fixture(launched.browser,candidate,resources,mode),page=await f.context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const result={page:entry.page,mode};report.cases.push(result);
  try{
   await page.goto(origin+entry.paths[0],{waitUntil:'load'});
   result.flow=await functionalFlow(page,entry.page);
   result.fonts=await fonts(page,entry.page);
   // The pinned beacon uses XHR at load and sendBeacon when the page becomes hidden.
   await page.waitForFunction(()=>window.__beaconCalls.some(x=>x.path==='/cdn-cgi/rum'),null,{timeout:10000});
   result.analytics=await page.evaluate(()=>window.__beaconCalls.filter(x=>x.path==='/cdn-cgi/rum'));
   assert(result.analytics.length&&result.analytics.every(x=>x.origin===origin),'Captured beacon must report same-origin');
   if(!home){
    await page.waitForFunction(()=>window.__loggingCalls.length>0,null,{timeout:15000});
    result.logging=await page.evaluate(()=>window.__loggingCalls);
   }
   result.normal_events=await page.evaluate(()=>window.__cspEvents);
   const unexpected=result.normal_events.filter(e=>!(home&&e.disposition==='report'&&e.directive==='script-src-elem'&&e.blockedURI.startsWith('https://static.cloudflareinsights.com')));
   assert.deepEqual(unexpected,[],'Unexplained normal-flow CSP events');
   if(home)assert(result.normal_events.some(e=>e.blockedURI.startsWith('https://static.cloudflareinsights.com')),'Current homepage RO must flag beacon');
   assert.deepEqual(errors,[],'Runtime errors');assert.deepEqual(f.unexpected,[],'Unexpected intercepted request');
   if(!home){
    assert(result.logging.some(x=>x.transport===(entry.page==='ChatBot/index.html'?'fetch':'sendBeacon')),'Actual application logging transport required');
    assert(f.redirects.length,'Actual Apps Script logging redirect required');
    assert(f.requests.some(x=>x.url.startsWith('https://script.googleusercontent.com/')),'Browser must follow Apps Script redirect');
    result.redirects=f.redirects;
   }
   await page.evaluate(()=>{const s=document.createElement('script');s.src='/__csp_probe_allowed.js';document.head.appendChild(s);});
   await page.waitForFunction(()=>window.__cspAllowedSelfRan);
   await page.evaluate(()=>{const s=document.createElement('script');s.textContent='window.__cspDisallowedRan=true;';document.head.appendChild(s);const css=document.createElement('style');css.textContent='html {--cm-csp-negative: ran;}';document.head.appendChild(css);});
   await page.waitForFunction(()=>window.__cspEvents.some(e=>e.blockedURI==='inline'&&e.directive.startsWith('script-src'))&&window.__cspEvents.some(e=>e.blockedURI==='inline'&&e.directive.startsWith('style-src')));
   result.controls=await page.evaluate(()=>({scriptRan:Boolean(window.__cspDisallowedRan),styleRan:getComputedStyle(document.documentElement).getPropertyValue('--cm-csp-negative').trim()==='ran',events:window.__cspEvents}));
   assert.equal(result.controls.scriptRan,home);assert.equal(result.controls.styleRan,home);
   result.intercepted_requests=f.requests;result.status='PASS';
   await page.screenshot({path:path.join(out,entry.page.replace(/\W/g,'-')+'.png'),fullPage:true});
  }catch(e){result.status='FAIL';result.error=e.message;result.errors=errors;result.events=await page.evaluate(()=>window.__cspEvents).catch(()=>[]);result.logging=await page.evaluate(()=>window.__loggingCalls).catch(()=>[]);result.intercepted_requests=f.requests;throw e;}
  finally{await f.context.close();}
 }
 report.status='PASS';
})().catch(e=>{report.status='FAIL';report.error=e.stack;process.exitCode=1;}).finally(async()=>{
 if(launched){report.proxy_denied=launched.blocked;await launched.close();}
 fs.writeFileSync(path.join(out,'browser-proof.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({status:report.status,engine,cases:report.cases.map(c=>({page:c.page,status:c.status})),error:report.error}));
});
