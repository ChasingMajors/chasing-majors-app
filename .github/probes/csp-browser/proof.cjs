'use strict';
// Linux-only, intercepted browser proof. No browser request is continued remotely.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '../../..'), origin = 'https://app.chasingmajors.com';
const candidate = JSON.parse(fs.readFileSync(process.argv[2]));
const out = process.argv[3];
assert.equal(process.env.GITHUB_REF, 'refs/heads/stage/csp-enforcement-prep');
assert.equal(candidate.source_sha, process.env.GITHUB_SHA);
fs.mkdirSync(out, {recursive: true});
const cv = JSON.parse(fs.readFileSync(path.join(root, 'data/v1/checklists/index.json'))).index;
const prv = JSON.parse(fs.readFileSync(path.join(root, 'data/v1/vault/index.json'))).index;
const homeProduct = cv.find(x => x.Code === '2026-bowman-baseball');
const checklist = cv.find(x => x.Code === '2026_bowman_sapphire_football_football_checklist');
const vaultProduct = prv.find(x => x.Code === '19TFmbl');
assert(homeProduct && checklist && vaultProduct, 'Real source products required');
const mime = file => ({'.html': 'text/html; charset=utf-8', '.js': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.gz': 'application/gzip',
  '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon'}[path.extname(file)] || 'application/octet-stream');
const report = {state: 'STAGED', source_sha: candidate.source_sha, browser: '', cases: [], embeds: [],
  browser_remote_requests_continued: 0, d1_reads: 0, d1_writes: 0,
  limitations: ['All browser traffic intercepted; no live API/Apps Script calls',
    'Google font stylesheet mocked; font rendering not accepted',
    'Home API results use real source identity in a mocked API envelope',
    'Not a clean real-traffic observation window; external legitimate embed usage unknown']};
let browser;
async function fixture(mode) {
  const context = await browser.newContext({serviceWorkers: 'block', viewport: {width: 1280, height: 900}});
  const requests = [], unexpected = [];
  await context.addInitScript(() => {
    window.__cspEvents = [];
    window.__embedLoaded = false;
    window.addEventListener('message', event => {if (event.data === 'cm-csp-child-loaded') window.__embedLoaded = true;});
    document.addEventListener('securitypolicyviolation', event => window.__cspEvents.push({
      directive: event.effectiveDirective, blockedURI: event.blockedURI, disposition: event.disposition,
      sourceFile: event.sourceFile, lineNumber: event.lineNumber}));
    localStorage.setItem('cm_theme', 'dark');
    if (window.parent !== window) window.addEventListener('DOMContentLoaded', () => window.parent.postMessage('cm-csp-child-loaded', '*'));
  });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    requests.push({method: request.method(), url: request.url()});
    const cors = {'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type'};
    if (request.method() === 'OPTIONS') return route.fulfill({status: 204, headers: cors});
    if (url.origin === 'https://embed-check.invalid' || url.pathname === '/__csp_parent.html') {
      return route.fulfill({contentType: 'text/html', body: '<!doctype html><title>Embedding fixture</title><iframe src="' + origin + '/checklists/"></iframe>'});
    }
    if (url.origin === 'https://api.chasingmajors.com' && url.pathname === '/cv-search') {
      return route.fulfill({headers: cors, contentType: 'application/json', body: JSON.stringify({ok: true, total: 1, results: [{
        type: 'product', code: homeProduct.Code, displayName: homeProduct.DisplayName, year: homeProduct.year,
        sport: homeProduct.sport, manufacturer: homeProduct.manufacturer}]})});
    }
    if (['https://script.google.com', 'https://script.googleusercontent.com'].includes(url.origin)) {
      return route.fulfill({headers: cors, contentType: 'application/json', body: '{"ok":true}'});
    }
    if (url.origin === 'https://fonts.googleapis.com') {
      return route.fulfill({contentType: 'text/css', body: '/* Intercepted font CSS; no remote request. */'});
    }
    if (url.origin !== origin || !['GET', 'HEAD'].includes(request.method())) {
      unexpected.push({url: request.url(), method: request.method()}); return route.abort('blockedbyclient');
    }
    if (url.pathname === '/__csp_probe_allowed.js') {
      return route.fulfill({contentType: 'application/javascript', body: 'window.__cspAllowedSelfRan = true;'});
    }
    let relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (!relative || relative.endsWith('/')) relative += 'index.html';
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      return route.fulfill({status: 404, contentType: 'text/plain', body: 'Absent from isolated committed snapshot'});
    }
    const entry = candidate.pages.find(p => p.page === relative);
    const headers = entry ? {[mode === 'report' ? 'content-security-policy-report-only' : 'content-security-policy']: entry.value} : {};
    return route.fulfill({headers, contentType: mime(file), body: fs.readFileSync(file)});
  });
  return {context, requests, unexpected};
}
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
(async () => {
  browser = await chromium.launch({headless: true}); report.browser = browser.version();
  for (const mode of ['report', 'enforce']) for (const entry of candidate.pages) {
    const f = await fixture(mode), page = await f.context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const result = {mode, page: entry.page}; report.cases.push(result);
    try {
      await page.goto(origin + entry.paths[0], {waitUntil: 'load'});
      result.flow = await functionalFlow(page, entry.page);
      result.legitimate_violations = await page.evaluate(() => window.__cspEvents);
      assert.deepEqual(result.legitimate_violations, [], 'Normal isolated flow emitted CSP violations');
      assert.deepEqual(errors, [], 'Normal isolated flow emitted runtime errors');
      assert.deepEqual(f.unexpected, [], 'Unreviewed intercepted endpoint');
      await page.evaluate(() => {const script = document.createElement('script'); script.src = '/__csp_probe_allowed.js'; document.head.appendChild(script);});
      await page.waitForFunction(() => window.__cspAllowedSelfRan === true);
      await page.evaluate(() => {
        const script = document.createElement('script'); script.textContent = 'window.__cspDisallowedRan = true;'; document.head.appendChild(script);
        const style = document.createElement('style'); style.textContent = 'html { --cm-csp-negative: ran; }'; document.head.appendChild(style);
      });
      await page.waitForFunction(() => window.__cspEvents.some(e => e.directive === 'script-src-elem') &&
        window.__cspEvents.some(e => e.directive === 'style-src-elem'));
      result.controls = await page.evaluate(() => ({scriptRan: Boolean(window.__cspDisallowedRan),
        styleRan: getComputedStyle(document.documentElement).getPropertyValue('--cm-csp-negative').trim() === 'ran', events: window.__cspEvents}));
      assert.equal(result.controls.scriptRan, mode === 'report'); assert.equal(result.controls.styleRan, mode === 'report');
      assert(result.controls.events.every(e => e.disposition === mode));
      result.status = 'PASS'; result.intercepted_requests = f.requests;
      if (mode === 'enforce') await page.screenshot({path: path.join(out, entry.page.replace(/\W/g, '-') + '.png'), fullPage: true});
    } catch (error) {
      result.status = 'FAIL'; result.error = error.message; result.runtime_errors = errors;
      result.events = await page.evaluate(() => window.__cspEvents).catch(() => []);
      result.intercepted_requests = f.requests; throw error;
    } finally { await f.context.close(); }
  }
  for (const sameOrigin of [true, false]) {
    const f = await fixture('enforce'), page = await f.context.newPage(), messages = [];
    page.on('console', message => messages.push(message.text()));
    await page.goto(sameOrigin ? origin + '/__csp_parent.html' : 'https://embed-check.invalid/', {waitUntil: 'load'});
    if (sameOrigin) await page.waitForFunction(() => window.__embedLoaded === true);
    else {
      await page.waitForTimeout(1000);
      assert.equal(await page.evaluate(() => window.__embedLoaded), false);
      assert(messages.some(m => /frame-ancestors/.test(m)), 'Foreign frame rejection must be observed');
    }
    report.embeds.push({same_origin: sameOrigin, child_loaded: sameOrigin, status: 'PASS'});
    await f.context.close();
  }
  report.status = 'PASS';
})().catch(error => {report.status = 'FAIL'; report.error = error.message; process.exitCode = 1;})
  .finally(async () => {
    if (browser) await browser.close();
    fs.writeFileSync(path.join(out, 'browser-proof.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({status: report.status, cases: report.cases.map(c => ({page: c.page, mode: c.mode, status: c.status})), error: report.error}));
  });
