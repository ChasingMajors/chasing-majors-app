const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const script=fs.readFileSync('vault/app.js','utf8');

// Slice the specific functions/handlers under test out of the browser module so
// they can run in a node:vm with stubbed DOM + collaborators (same pattern as
// tests/vault-search.test.cjs).
function sliceBetween(start,end){
  const a=script.indexOf(start);
  const b=script.indexOf(end);
  if(a<0||b<0||b<a) throw new Error(`slice markers not found: ${start} .. ${end}`);
  return script.slice(a,b);
}
function sliceFn(name){
  const start=script.indexOf('function '+name+'(');
  if(start<0) throw new Error('function not found: '+name);
  // Find the closing brace for a top-level function declaration.
  let depth=0,started=false;
  for(let i=start;i<script.length;i++){
    const ch=script[i];
    if(ch==='{'){depth++;started=true;}
    else if(ch==='}'){depth--;if(started&&depth===0){return script.slice(start,i+1);}}
  }
  throw new Error('could not slice function: '+name);
}

const NORMALIZE_INDEX=sliceFn('normalizeIndexRows_');
const IS_EMPTY=sliceFn('isEmptyProduct_');
const FIND_BEST=sliceFn('findBestMatch');
const RESOLVE_CODE=sliceFn('resolveByCode_');
const RENDER_RESULTS=sliceFn('renderResults');
// The typeahead handler is an inline event listener block.
const TYPEAHEAD=sliceBetween('// ---------------- TYPEAHEAD ----------------','// ---------------- BUTTONS ----------------');

// normalizeQuery_/cleanQuery are needed by the search helpers.
const NORMALIZE_QUERY=sliceFn('normalizeQuery_');
const CLEAN_QUERY=sliceFn('cleanQuery');
const ESC=sliceFn('esc');

function baseContext(extra){
  const c=Object.assign({
    console,
    String,Number,Array,Boolean,JSON,Math,Date,Object,encodeURIComponent,
  },extra||{});
  vm.createContext(c);
  return c;
}

test('normalizeIndexRows_ carries status/row_count and defaults status from row_count',()=>{
  const c=baseContext();
  vm.runInContext(NORMALIZE_INDEX,c);
  const out=c.normalizeIndexRows_([
    {Code:'A',DisplayName:'Alpha',status:'empty',row_count:0},
    {Code:'B',DisplayName:'Beta',row_count:5},            // status derived -> 'ok'
    {Code:'C',DisplayName:'Gamma',row_count:0},           // status derived -> 'empty'
    {Code:'',DisplayName:'Dropped'}                       // filtered out (no Code)
  ]);
  assert.equal(out.length,3);
  const byCode=Object.fromEntries(out.map(r=>[r.Code,r]));
  assert.equal(byCode.A.status,'empty');
  assert.equal(byCode.A.row_count,0);
  assert.equal(byCode.B.status,'ok');
  assert.equal(byCode.B.row_count,5);
  assert.equal(byCode.C.status,'empty');
  assert.equal(byCode.C.row_count,0);
});

test('isEmptyProduct_ treats empty status or zero row_count as empty',()=>{
  const c=baseContext();
  vm.runInContext(IS_EMPTY,c);
  assert.equal(c.isEmptyProduct_({status:'empty',row_count:5}),true);
  assert.equal(c.isEmptyProduct_({status:'ok',row_count:0}),true);
  assert.equal(c.isEmptyProduct_({status:'ok',row_count:3}),false);
  assert.equal(c.isEmptyProduct_(null),false);
});

const SAMPLE_INDEX=[
  {Code:'OK1',DisplayName:'Topps Chrome',Keywords:'chrome',status:'ok',row_count:12},
  {Code:'MT1',DisplayName:'Topps Finest',Keywords:'finest',status:'empty',row_count:0}
];

test('findBestMatch excludes status:empty entries and returns the ok one',()=>{
  const c=baseContext({INDEX:SAMPLE_INDEX});
  vm.runInContext(NORMALIZE_QUERY+'\n'+CLEAN_QUERY+'\n'+IS_EMPTY+'\n'+FIND_BEST,c);
  // Exact display name of the empty product must not auto-select.
  assert.equal(c.findBestMatch('Topps Finest'),null);
  // Exact code of the empty product must not auto-select.
  assert.equal(c.findBestMatch('MT1'),null);
  // The populated product resolves normally.
  const hit=c.findBestMatch('Topps Chrome');
  assert.ok(hit);
  assert.equal(hit.Code,'OK1');
});

test('resolveByCode_ returns an empty product by exact code (deep-link bypass)',()=>{
  const c=baseContext({INDEX:SAMPLE_INDEX});
  vm.runInContext(NORMALIZE_QUERY+'\n'+CLEAN_QUERY+'\n'+RESOLVE_CODE,c);
  const hit=c.resolveByCode_('mt1'); // case-insensitive
  assert.ok(hit);
  assert.equal(hit.Code,'MT1');
  assert.equal(hit.status,'empty');
  // The empty entry is still present in the index (not deleted).
  assert.ok(SAMPLE_INDEX.some(e=>e.Code==='MT1'));
});

test('typeahead dropdown hides empty products but shows ok ones',()=>{
  const dd={innerHTML:'',style:{},children:[]};
  const q={value:'topps',attributes:{},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];},addEventListener(){}};
  const c=baseContext({
    INDEX:SAMPLE_INDEX,
    elQ:q,
    elDD:dd,
    searchGeneration:0,
    selected:null,
    openDropdown(html){dd.innerHTML=html;dd.style.display='block';},
    closeDropdown(){dd.style.display='none';dd.innerHTML='';},
  });
  // esc + normalizeQuery_ + cleanQuery + isEmptyProduct_ are used by the handler.
  vm.runInContext(ESC+'\n'+NORMALIZE_QUERY+'\n'+CLEAN_QUERY+'\n'+IS_EMPTY,c);
  // Capture the input listener the handler registers on elQ.
  let handler=null;
  c.elQ.addEventListener=(evt,fn)=>{if(evt==='input')handler=fn;};
  // document is only used for an outside-click listener; stub it out.
  c.document={addEventListener(){}};
  vm.runInContext(TYPEAHEAD,c);
  assert.equal(typeof handler,'function');
  handler();
  assert.match(dd.innerHTML,/Topps Chrome/);
  assert.doesNotMatch(dd.innerHTML,/Topps Finest/);
});

test('renderResults with no rows shows a Data unavailable card, not the old string',()=>{
  const el={innerHTML:''};
  const c=baseContext({
    elResults:el,
    activeProduct:{checklist:{code:'CV1',sport:'baseball'}},
    selected:{DisplayName:'Topps Finest'},
  });
  vm.runInContext(ESC+'\n'+RENDER_RESULTS,c);
  c.renderResults({year:'2024',sport:'Baseball',manufacturer:'Topps',displayName:'Topps Finest'},[]);
  assert.match(el.innerHTML,/Data unavailable/);
  assert.match(el.innerHTML,/Print-run data isn't available/);
  assert.match(el.innerHTML,/role="status"/);
  assert.match(el.innerHTML,/Topps Finest/);          // still shows product name
  assert.match(el.innerHTML,/Open checklist/);         // still shows cv link
  assert.doesNotMatch(el.innerHTML,/No print-run entries for this product yet/);
  assert.doesNotMatch(el.innerHTML,/No matching product/);
});

test('renderResults with rows renders the entries card (populated path)',()=>{
  const nodes={};
  function makeNode(){return {innerHTML:'',textContent:'',hidden:false,value:'',dataset:{},onclick:null,addEventListener(){}};}
  const el={innerHTML:''};
  const rows=[{category:'Base',set_name:'Base Set',section:'Base',measurement:{value:100,kind:'reported',scope:'set'},serial_limit:null,checklist_size:200}];
  const c=baseContext({
    elResults:el,
    activeProduct:{checklist:null,rows},
    selected:{DisplayName:'Topps Chrome',Code:'OK1',sport:'Baseball'},
    visibleLimit:60,
    searchGeneration:0,
    document:{getElementById:id=>(nodes[id]||(nodes[id]=makeNode()))},
    fmtNum:x=>String(x),
    getStaticPopSummary_:async()=>null,
    renderPopInsights:()=>'',
    renderEntries(){},
  });
  vm.runInContext(ESC+'\n'+RENDER_RESULTS,c);
  c.renderResults({year:'2024',sport:'Baseball',manufacturer:'Topps',displayName:'Topps Chrome'},rows);
  assert.match(el.innerHTML,/entriesCard/);
  assert.match(el.innerHTML,/<strong>1<\/strong> entries/);
  assert.doesNotMatch(el.innerHTML,/Data unavailable/);
});

test('legacy indices without row counts remain searchable while structured data rebuilds',()=>{
 const c=baseContext({INDEX:[]});
 vm.runInContext(NORMALIZE_INDEX+'\n'+NORMALIZE_QUERY+'\n'+CLEAN_QUERY+'\n'+IS_EMPTY+'\n'+FIND_BEST,c);
 c.INDEX=c.normalizeIndexRows_([{Code:'legacy',DisplayName:'2025-26 Topps Basketball'},{Code:'empty',DisplayName:'Empty',row_count:0}]);
 assert.equal(c.INDEX[0].row_count,null);assert.equal(c.INDEX[0].status,'unknown');
 assert.equal(c.isEmptyProduct_(c.INDEX[0]),false);
 assert.equal(c.isEmptyProduct_({Code:'raw-legacy'}),false);
 assert.equal(c.findBestMatch('2025-26 Topps Basketball').Code,'legacy');
 assert.equal(c.findBestMatch('Empty'),null);
});

test('static JSON requests use the source revision and share the in-page cache',async()=>{
 const urls=[];
 const c=baseContext({STATIC_CACHE:{},STATIC_MANIFEST:{vault_version:'sheet update 2'},fetchJsonWithTimeout_:async url=>{urls.push(url);return {ok:true};}});
 vm.runInContext(sliceFn('staticVersion_')+'\n'+sliceFn('loadStaticJsonCached_'),c);
 await c.loadStaticJsonCached_('index','/data/v2/vault/index.json');
 await c.loadStaticJsonCached_('index','/data/v2/vault/index.json');
 assert.deepEqual(urls,['/data/v2/vault/index.json?v=sheet%20update%202']);
});
