const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const script=fs.readFileSync('vault/app.js','utf8');

// Slice a top-level function declaration out of the browser module so it can run
// in a node:vm with stubbed DOM + collaborators (same pattern as
// tests/prv-empty-products.test.cjs).
function sliceFn(name){
  const start=script.indexOf('function '+name+'(');
  if(start<0) throw new Error('function not found: '+name);
  let depth=0,started=false;
  for(let i=start;i<script.length;i++){
    const ch=script[i];
    if(ch==='{'){depth++;started=true;}
    else if(ch==='}'){depth--;if(started&&depth===0){return script.slice(start,i+1);}}
  }
  throw new Error('could not slice function: '+name);
}

const ESC=sliceFn('esc');
const RENDER_ENTRIES=sliceFn('renderEntries');

// Render renderEntries against a single-row fixture and return the produced
// entryList innerHTML.
function renderRow(row){
  const nodes={
    entryQuery:{value:''},
    entryCategory:{value:''},
    entrySort:{value:'source'},
    entryCount:{textContent:''},
    entryList:{innerHTML:''},
    showMore:{hidden:false},
  };
  const c={
    console,String,Number,Array,Boolean,JSON,Math,Date,Object,encodeURIComponent,
    activeProduct:{rows:[row]},
    visibleLimit:60,
    document:{getElementById:id=>nodes[id]},
    fmtNum:x=>String(x),
  };
  vm.createContext(c);
  vm.runInContext(ESC+'\n'+RENDER_ENTRIES,c);
  c.renderEntries();
  return nodes.entryList.innerHTML;
}

const base={category:'Base',set_name:'Gold Refractor',section:'Base'};

test('reported row shows a clean name and count without redundant section or Reported badge',()=>{
  const html=renderRow({...base,measurement:{value:100,kind:'reported',scope:'set'},serial_limit:null,checklist_size:200});
  assert.doesNotMatch(html,/class="entryQualifier"/);
  assert.doesNotMatch(html,/<small>/);
  assert.match(html,/<strong[^>]*>100<\/strong>/);
  // The qualifier is no longer carried only inside a muted <small>.
  assert.doesNotMatch(html,/<small>Reported<\/small>/);
  // Screen-reader text keeps the qualifier + number together.
  assert.match(html,/Reported print run 100/);
});

test('upper_bound row shows the "Up to" qualifier',()=>{
  const html=renderRow({...base,measurement:{value:500,kind:'upper_bound',scope:'set'},serial_limit:null,checklist_size:50});
  assert.match(html,/class="entryQualifier"[^>]*>Up to</);
  assert.match(html,/Up to print run 500/);
});

test('lower_bound row shows the "At least" qualifier',()=>{
  const html=renderRow({...base,measurement:{value:250,kind:'lower_bound',scope:'set'},serial_limit:null,checklist_size:50});
  assert.match(html,/class="entryQualifier"[^>]*>At least</);
});

test('per_card scope is appended to the qualifier',()=>{
  const html=renderRow({...base,measurement:{value:12,kind:'estimate',scope:'per_card'},serial_limit:null,checklist_size:50});
  assert.match(html,/class="entryQualifier"[^>]*>Estimated · per card</);
});

test('numbered-only row (value null, serial present) is unmistakable: no print-run estimate, /25, no bare 0',()=>{
  const html=renderRow({...base,measurement:{value:null,kind:'unknown',scope:'set'},serial_limit:25,checklist_size:30});
  assert.match(html,/class="entryQualifier"[^>]*>No print-run estimate</);
  assert.match(html,/No known print run; serial limit \/25/);
  assert.match(html,/\/25/);
  // The big number is a dash placeholder, never a count of 0.
  assert.match(html,/<strong[^>]*>—<\/strong>/);
  assert.doesNotMatch(html,/<strong[^>]*>0<\/strong>/);
});

test('fully-unknown row (value null, serial null) shows "Print run unknown"',()=>{
  const html=renderRow({...base,measurement:{value:null,kind:'unknown',scope:'set'},serial_limit:null,checklist_size:null});
  assert.match(html,/class="entryQualifier"[^>]*>Print run unknown</);
  assert.match(html,/<span class="srOnly">Print run unknown<\/span>/);
  assert.doesNotMatch(html,/No print-run estimate/);
});

test('serial and checklist cells keep srOnly / mobileLabel accessibility hooks',()=>{
  const html=renderRow({...base,measurement:{value:100,kind:'reported',scope:'set'},serial_limit:25,checklist_size:200});
  assert.match(html,/class="entrySerial"><span class="mobileLabel">Numbered <\/span>\/25/);
  assert.match(html,/<span class="srOnly">Checklist size: <\/span>/);
  assert.match(html,/<span class="mobileLabel" aria-hidden="true">Checklist size <\/span>/);
});
