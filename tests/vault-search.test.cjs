const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const script=fs.readFileSync('vault/app.js','utf8');
const search=script.slice(script.indexOf('async function runSearch()'),script.indexOf('// ---------------- POP RENDER HELPERS'));
const splitChoice=script.slice(script.indexOf('function renderSplitChoice_('),script.indexOf('// ---------------- HOMEPAGE HANDOFF'));
function fixture(){
 const pending={}; const renders=[];
 const c={initDone:true,elQ:{value:'A'},elResults:{innerHTML:''},searchGeneration:0,selected:null,activeProduct:null,visibleLimit:60,location:{},history:{replaceState(){}},cleanQuery:s=>s,closeDropdown(){},findBestMatch:q=>({Code:q,DisplayName:q}),hideBootOverlay(){},logEventFireAndForget_(){},renderResults:(meta)=>renders.push(meta.code),getStaticVaultProduct_:code=>new Promise(resolve=>pending[code]=resolve)};
 c.STRUCTURED_INDEX=null;c.esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
 vm.createContext(c);vm.runInContext(splitChoice+'\n'+search,c);return {c,pending,renders};
}
test('a late response cannot overwrite a newer product',async()=>{
 const {c,pending,renders}=fixture();const first=c.runSearch();
 c.selected=null;c.elQ.value='B';const second=c.runSearch();
 pending.B({meta:{code:'B'},rows:[{}]});await second;
 pending.A({meta:{code:'A'},rows:[{}]});await first;
 assert.deepEqual(renders,['B']);
});
test('old combined-product URLs offer both products without loading a wrong result',async()=>{
 const {c,pending}=fixture();c.elQ.value='combined';
 c.STRUCTURED_INDEX={aliases:{combined:{products:['NBL','Finest']}},index:[{Code:'NBL',DisplayName:'NBL Basketball'},{Code:'Finest',DisplayName:'Finest Soccer'}]};
 await c.runSearch();assert.equal(Object.keys(pending).length,0);
 assert.match(c.elResults.innerHTML,/\?code=NBL/);assert.match(c.elResults.innerHTML,/\?code=Finest/);
});
test('clear invalidates pending results, and print runs do not request POP',async()=>{
 const {c,pending,renders}=fixture();const request=c.runSearch();
 c.searchGeneration++;pending.A({meta:{code:'A'},rows:[{}]});await request;assert.deepEqual(renders,[]);
 const next=c.runSearch();pending.A({meta:{code:'A'},rows:[{}]});await next;assert.deepEqual(renders,['A']);
 assert.ok(!search.includes('getStaticPopSummary_'));
});
