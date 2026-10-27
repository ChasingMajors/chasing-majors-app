const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const G=require('../shared/guided-search.js');
const entry=(Code,extra={})=>({Code,DisplayName:'2026 Topps Heritage Baseball',sport:'Baseball',year:'2026',manufacturer:'Topps',product:'Heritage',...extra});
test('guided options come from real catalog scope and preserve exact codes',()=>{
 const rows=G.catalog({index:[entry('base'),entry('basketball',{sport:'Basketball',year:'2025-26',manufacturer:'Panini'}),entry('historic',{year:'2018',manufacturer:'Bowman'})]},'cv');
 assert.deepEqual(G.options(rows,'year',{sport:'baseball'}),['2026','2018']);assert.deepEqual(G.options(rows,'manufacturer',{sport:'baseball',year:'2018'}),['Bowman']);
 assert.deepEqual(G.scoped(rows,{sport:'baseball',year:'2026',mfr:'Topps'}).map(e=>e.code),['base']);assert.equal(new URL(G.href('cv',rows[0]),'https://fixture.invalid').searchParams.get('code'),'base');
});
test('PRV paths exclude empty and non-Topps entries while recent vault updates retain populated legacy brands',()=>{
 const data={index:[entry('topps',{row_count:3}),entry('empty',{row_count:0,status:'empty'}),entry('panini',{manufacturer:'Panini',row_count:2}),entry('bowman',{manufacturer:'Bowman',row_count:1})]};
 assert.deepEqual(G.catalog(data,'prv').map(e=>e.code),['topps','bowman']);assert.equal(G.catalog(data,'prv-all').length,3);
});
test('ambiguous duplicate codes are held rather than fuzzy merged',()=>{
 assert.equal(G.catalog({index:[entry('duplicate'),entry('duplicate',{DisplayName:'Different product'})]},'cv').length,0);
 const rows=G.catalog({index:[entry('a'),entry('b')]},'cv');assert.equal(rows.length,2);assert.notEqual(G.href('cv',rows[0]),G.href('cv',rows[1]));
});
test('player years are exact-name and sport scoped; no invented ranges, aliases or multi-sport collapse',()=>{
 const data={players:[{player_name:'Mike Trout',sport:'baseball',checklist_years:[2018,2026,2018]},{player_name:'Mike Trout',sport:'basketball',checklist_years:[2025]}]};
 assert.deepEqual(G.playerYears(data,' mike   trout ','Baseball').years,['2026','2018']);assert.deepEqual(G.playerYears(data,'Mike Trout','basketball').years,['2025']);
 assert.equal(G.playerYears(data,'Michael Trout','baseball').status,'not_found');assert.equal(G.playerYears({players:[...data.players,data.players[0]]},'Mike Trout','baseball').status,'ambiguous');assert.throws(()=>G.playerYears({},'Mike Trout','baseball'));
});
test('recent lists filter before limiting, stay independent, and cannot cross CV/PRV codes',()=>{
 const cv=G.catalog({index:[entry('cv-code')]},'cv'),prv=G.catalog({index:[entry('prv-code',{row_count:1})]},'prv-all');
 const items=[...Array.from({length:20},()=>({vault:'PRV',code:'prv-code',sport:'baseball'})),{vault:'CV',code:'cv-code',sport:'baseball'}];
 const rows=G.recent({items},cv,prv);assert.equal(rows.cv.length,1);assert.equal(rows.prv.length,1);assert(rows.prv[0].href.includes('prv-code'));assert.equal(G.recent({items},cv,[]).cv.length,1);
});
test('homepage uses the approved truthful copy and no prototype data or comparative claim',()=>{
 const html=fs.readFileSync('index.html','utf8'),js=fs.readFileSync('assets/guided-home.js','utf8');
 assert(html.includes('Your checklist source.<br>Your print-run source.<br>Your next chase.'));assert(!html.includes('Every checklist.<br>'));assert(!html.includes('Local design preview'));assert(!html.includes('Direct demo search'));assert(!js.includes('most on the web'));assert(!/DEMO_|REC_CV|PRV_COUNT=238/.test(js));
 assert(js.includes('publishedPrvCount=j.index.filter(G.populated).length'));assert(js.includes('No indexed matches on this page.'));assert(html.includes('id="recCV"'));assert(html.includes('id="recPRV"'));
});
