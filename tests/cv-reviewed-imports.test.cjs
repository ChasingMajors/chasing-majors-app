const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {apply}=require('../scripts/apply-reviewed-checklists.cjs');
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cv-import-'));
 const write=(file,d)=>{fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),JSON.stringify(d)+'\n');};
 const read=file=>JSON.parse(fs.readFileSync(path.join(root,file)));
 const meta={code:'new',displayName:'2026-27 New Basketball',year:'2026-27',sport:'basketball',manufacturer:'Topps',product:'New'};
 const row={code:'new',sport:'basketball',section:'Base',subset:'Base',card_no:'1',player:'Reviewed Player',team:'Team',tag:''};
 const data={ok:true,meta,rows:[row],parallels:[],source_provenance:{review_id:'test',withheld_source_records:0}};
 write('data/cv-reviewed-imports/new.json',data);
 const hash=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'data/cv-reviewed-imports/new.json'))).digest('hex');
 write('data/cv-reviewed-imports/catalog.json',{schema_version:1,review_id:'test',products:[{code:'new',sport:'basketball',file:'new.json',expected_rows:1,expected_subset_counts:{Base:1},content_sha256:hash}],patches:[]});
 write('data/v1/checklists/index.json',{index:[{Code:'unrelated',DisplayName:'Unrelated'}]});
 write('data/v1/checklists/products/basketball.json',{sharded:true,shards:['original.json'],product_map:{new:'original.json',unrelated:'original.json'}});
 write('data/v1/checklists/products/original.json',{products:{new:{meta,rows:[],parallels:[]},unrelated:{meta:{code:'unrelated'},rows:[{player:'Keep me'}],parallels:[{parallel_name:'Keep'}]}}});
 write('data/v1/checklists/search-index/basketball.json',{sharded:true,shards:['original-search.json']});
 write('data/v1/checklists/search-index/original-search.json',{rows:[{code:'new',type:'product',term:'Old title'},{code:'unrelated',type:'card',term:'Keep me'}]});
 write('data/v1/checklists/search-index/sources.json',{sources:{basketball:[]}});
 write('data/v1/manifest.json',{vault_version:'vault-unchanged',checklists_version:'old'});
 return {root,read,write};
}
test('reviewed imports add season-scoped products, preserve unrelated data, and rebuild idempotently',()=>{
 const f=fixture();try{
  const before=f.read('data/v1/checklists/products/original.json');const report=apply(f.root,{stamp:'new-version'});assert.ok(report.changed_files.length);
  assert.deepEqual(f.read('data/v1/checklists/products/original.json'),before);
  assert.equal(f.read('data/v1/manifest.json').vault_version,'vault-unchanged');
  const p=f.read('data/v1/checklists/products/basketball/new.json');assert.equal(p.meta.year,'2026-27');assert.equal(p.rows[0].player,'Reviewed Player');
  assert.equal(f.read('data/v1/checklists/index.json').index.filter(e=>e.Code==='new').length,1);
  assert.deepEqual(f.read('data/v1/checklists/search-index/original-search.json').rows,[{code:'unrelated',type:'card',term:'Keep me'}]);
  const next=apply(f.root,{stamp:'later'});assert.deepEqual(next.changed_files,[]);assert.equal(f.read('data/v1/manifest.json').checklists_version,'new-version');
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('a later populated export wins over the reviewed fallback and updates direct/search payloads',()=>{
 const f=fixture();try{
  apply(f.root);const bundle='data/v1/checklists/products/basketball-reviewed-new.json';let d=f.read(bundle);d.products.new.rows[0].player='Newer source';d.products.new.parallels=[{parallel_name:'Source parallel'}];f.write(bundle,d);
  const report=apply(f.root);assert.equal(report.products[0].status,'source_preserved');assert.equal(f.read(bundle).products.new.rows[0].player,'Newer source');
  assert.equal(f.read('data/v1/checklists/products/basketball/new.json').rows[0].player,'Newer source');
  assert.equal(f.read('data/v1/checklists/search-index/basketball-reviewed-new.json').rows.find(r=>r.type==='card').player,'Newer source');
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('changed reviewed input fails validation before publishing',()=>{
 const f=fixture();try{
  const before=f.read('data/v1/manifest.json');const d=f.read('data/cv-reviewed-imports/new.json');d.rows[0].player='Unreviewed edit';f.write('data/cv-reviewed-imports/new.json',d);
  assert.throws(()=>apply(f.root),/checksum mismatch/);assert.deepEqual(f.read('data/v1/manifest.json'),before);
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
function parallelPatch(f,overrides={}){
 const patch={review_id:'parallel-review',code:'new',sport:'basketball',source_url:'https://example.com/official',parallels:[{code:'new',applies_to_section:'Base',applies_to_subset:'[Base]',parallel_name:'Gold',serial_no:'1/1',...overrides}]};
 f.write('data/cv-reviewed-imports/parallels.json',patch);
 const catalog=f.read('data/cv-reviewed-imports/catalog.json');catalog.parallel_patches=[{file:'parallels.json',content_sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(f.root,'data/cv-reviewed-imports/parallels.json'))).digest('hex')}];f.write('data/cv-reviewed-imports/catalog.json',catalog);
}
test('reviewed parallels reach both payloads, survive refresh, and stay idempotent',()=>{
 const f=fixture();try{
  parallelPatch(f);apply(f.root);
  const p=f.read('data/v1/checklists/products/basketball/new.json');assert.equal(p.parallels[0].serial_no,'1/1');assert.equal(p.reviewed_parallel_additions[0].source_url,'https://example.com/official');
  assert.deepEqual(f.read('data/v1/checklists/products/basketball-reviewed-new.json').products.new,p);
  assert.deepEqual(apply(f.root).changed_files,[]);
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('parallel patches preserve a conflicting populated source and report the conflict',()=>{
 const f=fixture();try{
  parallelPatch(f);apply(f.root);const file='data/v1/checklists/products/basketball-reviewed-new.json',d=f.read(file);d.products.new.parallels[0].serial_no='/25';f.write(file,d);
  const report=apply(f.root);assert.equal(report.conflicts.length,1);assert.equal(f.read('data/v1/checklists/products/basketball/new.json').parallels[0].serial_no,'/25');
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('a parallel assigned to a missing subset fails before any files are written',()=>{
 const f=fixture();try{
  parallelPatch(f,{applies_to_subset:'Missing subset'});const before=f.read('data/v1/manifest.json');assert.throws(()=>apply(f.root),/parallel scope/);assert.deepEqual(f.read('data/v1/manifest.json'),before);assert.ok(!fs.existsSync(path.join(f.root,'data/v1/checklists/products/basketball/new.json')));
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('reviewed name corrections update search and both payloads without overwriting later source edits',()=>{
 const f=fixture();try{
  const before=f.read('data/cv-reviewed-imports/new.json').rows[0],after={...before,player:'Correct Name'};
  f.write('data/cv-reviewed-imports/correction.json',{review_id:'names',code:'new',sport:'basketball',source_url:'https://example.com/checklist',corrections:[{before,after}]});
  const catalog=f.read('data/cv-reviewed-imports/catalog.json');catalog.row_corrections=[{file:'correction.json',content_sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(f.root,'data/cv-reviewed-imports/correction.json'))).digest('hex')}];f.write('data/cv-reviewed-imports/catalog.json',catalog);
  apply(f.root);assert.equal(f.read('data/v1/checklists/products/basketball/new.json').rows[0].player,'Correct Name');assert.equal(f.read('data/v1/checklists/search-index/basketball-reviewed-new.json').rows[1].player,'Correct Name');assert.deepEqual(apply(f.root).changed_files,[]);
  const file='data/v1/checklists/products/basketball-reviewed-new.json',d=f.read(file);d.products.new.rows[0].player='Later manual edit';f.write(file,d);const report=apply(f.root);assert.equal(report.conflicts.length,1);assert.equal(f.read('data/v1/checklists/products/basketball/new.json').rows[0].player,'Later manual edit');
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('official Flagship scopes and dual-subject cards remain separate',()=>{
 const p=require('../data/cv-reviewed-imports/2026_27_topps_flagship_basketball.json');
 assert.equal(p.rows.length,3244);const count=name=>p.rows.filter(r=>r.subset===name).length;
 assert.equal(count('Base'),300);assert.equal(count('Base Cards Blackout'),300);
 for(const roman of ['I','II','III'])assert.equal(count('Base Cards Golden Mirror Image Variation '+roman),100);
 assert.equal(count('The Flagship Collection Base Cards'),90);assert.equal(count('The Flagship Collection Chrome Base Cards'),90);
 const dual=p.rows.find(r=>r.card_no==='RPD-AD');assert.equal(dual.player,'AJ Dybantsa / Darryn Peterson');assert.equal(count('Rookie Photo Shoot Dual Autograph'),10);
 assert.ok(p.rows.filter(r=>r.subset==='Base Facsimile Autographs').every(r=>r.section==='Base'));
 assert.equal(p.parallels.length,0);
});
test('KAWS wrapped names, art-only IDs and separate autograph pools are preserved',()=>{
 const p=require('../data/cv-reviewed-imports/2026_topps_mlb_x_kaws_baseball.json');
 assert.equal(p.rows.length,146);assert.equal(p.rows.find(r=>r.card_no==='9-A').player,'Gunnar Henderson');assert.equal(p.rows.find(r=>r.card_no==='32-A').player,'Vladimir Guerrero Jr.');
 assert.equal(p.rows.filter(r=>r.subset==='Autographs').length,41);assert.equal(p.rows.filter(r=>r.subset==='On-Card Autographs').length,5);
 assert.equal(p.rows.filter(r=>/^SP-K\d+$/.test(r.card_no)&&r.player==='').length,10);
});
test('malformed Finest identities stay held; All Kings patch contains only the five missing IDs',()=>{
 const p=require('../data/cv-reviewed-imports/2024-topps-finest-football.json');assert.equal(p.source_provenance.withheld_source_records,301);assert.ok(!p.rows.some(r=>r.subset==='Mystery Finest'||r.card_no.includes('"')));
 const patch=require('../data/cv-reviewed-imports/all-kings-patch.json');assert.deepEqual(patch.rows.map(r=>r.card_no),['AK-26','AK-27','AK-28','AK-29','AK-30']);assert.equal(patch.rows[0].player,'Fernando Mendoza');
});
test('Base UI keeps overlapping card numbers in their own named checklist',()=>{
 const vm=require('node:vm'),script=fs.readFileSync('checklists/app.js','utf8');
 const helpers=script.slice(script.indexOf('function normalizeSubsetName('),script.indexOf('function getSerialSortValue('));
 const c={norm:s=>String(s||'').trim(),lower:s=>String(s||'').toLowerCase(),sortRowsByCardNo:rows=>rows};vm.createContext(c);vm.runInContext(helpers,c);
 const p=require('../data/cv-reviewed-imports/2026_27_topps_flagship_basketball.json'),rows=p.rows.filter(r=>r.section==='Base');
 let chosen=c.selectBaseChecklist(rows,'');assert.equal(chosen.selected.subset,'Base');assert.equal(chosen.rows.length,300);assert.equal(chosen.rows[0].player,'Alex Sarr');
 chosen=c.selectBaseChecklist(rows,'Base Cards Blackout');assert.equal(chosen.rows.length,300);assert.ok(chosen.rows.every(r=>r.subset==='Base Cards Blackout'));
 chosen=c.selectBaseChecklist(rows,'The Flagship Collection Chrome Base Cards');assert.equal(chosen.rows.length,90);assert.ok(chosen.rows.every(r=>r.subset==='The Flagship Collection Chrome Base Cards'));
 assert.equal(c.selectBaseChecklist(rows,'Previous product scope').selected.subset,'Base');
});
function serialPatch(f,change={}){
 const before={code:'new',applies_to_section:'Base',applies_to_subset:'Base',parallel_name:'Gold',serial_no:'corrupted date'};
 const bundle=f.read('data/v1/checklists/products/original.json');bundle.products.new.parallels=[before];f.write('data/v1/checklists/products/original.json',bundle);
 const after={...before,serial_no:'/1',...change};
 f.write('data/cv-reviewed-imports/serials.json',{review_id:'serial-review',code:'new',sport:'basketball',source_url:'https://example.com/verified-checklist',corrections:[{before,after}]});
 const catalog=f.read('data/cv-reviewed-imports/catalog.json');catalog.serial_corrections=[{file:'serials.json',content_sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(f.root,'data/cv-reviewed-imports/serials.json'))).digest('hex')}];f.write('data/cv-reviewed-imports/catalog.json',catalog);
}
test('reviewed serial corrections update shard and direct payload, retain evidence, and repeat safely',()=>{
 const f=fixture();try{
  serialPatch(f);const result=apply(f.root);assert.equal(result.patches.find(p=>p.kind==='serial_corrections').corrected,1);
  const p=f.read('data/v1/checklists/products/basketball/new.json');assert.equal(p.parallels[0].serial_no,'/1');assert.equal(p.reviewed_serial_corrections[0].corrections[0].before.serial_no,'corrupted date');
  assert.deepEqual(f.read('data/v1/checklists/products/basketball-reviewed-new.json').products.new,p);assert.deepEqual(apply(f.root).changed_files,[]);
  const file='data/v1/checklists/products/basketball-reviewed-new.json',fresh=f.read(file);fresh.products.new.parallels[0]=Object.fromEntries(Object.entries(p.reviewed_serial_corrections[0].corrections[0].before).reverse());f.write(file,fresh);assert.equal(apply(f.root).patches.find(x=>x.kind==='serial_corrections').corrected,1,'object key order must not invalidate the reviewed row');
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('changed or removed serial targets are preserved and reported instead of guessed',()=>{
 const f=fixture();try{
  serialPatch(f);apply(f.root);const file='data/v1/checklists/products/basketball-reviewed-new.json',p=f.read(file);p.products.new.parallels[0].serial_no='/10';f.write(file,p);
  let result=apply(f.root);assert(result.conflicts.some(c=>/Changed or missing/.test(c.reason)));assert.equal(f.read('data/v1/checklists/products/basketball/new.json').parallels[0].serial_no,'/10');
  p.products.new.parallels=[];f.write(file,p);result=apply(f.root);assert(result.conflicts.some(c=>/Changed or missing/.test(c.reason)));assert.equal(f.read('data/v1/checklists/products/basketball/new.json').parallels.length,0);
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('serial correction cannot change a parallel identity or invent a noninteger limit',()=>{
 for(const change of [{parallel_name:'Other'},{serial_no:'/0'},{serial_no:'/2.5'}]){
  const f=fixture();try{serialPatch(f,change);const before=f.read('data/v1/manifest.json');assert.throws(()=>apply(f.root),/Serial correction cannot change|Invalid reviewed serial/);assert.deepEqual(f.read('data/v1/manifest.json'),before);}finally{fs.rmSync(f.root,{recursive:true,force:true});}
 }
});
test('duplicate serial correction scopes fail before writing any product files',()=>{
 const f=fixture();try{
  serialPatch(f);const file='data/cv-reviewed-imports/serials.json',patch=f.read(file);patch.corrections.push(patch.corrections[0]);f.write(file,patch);
  const c=f.read('data/cv-reviewed-imports/catalog.json');c.serial_corrections[0].content_sha256=crypto.createHash('sha256').update(fs.readFileSync(path.join(f.root,file))).digest('hex');f.write('data/cv-reviewed-imports/catalog.json',c);
  assert.throws(()=>apply(f.root),/Duplicate serial correction/);assert.ok(!fs.existsSync(path.join(f.root,'data/v1/checklists/products/basketball/new.json')));
 }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
