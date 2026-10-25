const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const {updateRecentProducts} = require('../scripts/update-recent-products.cjs');
const product = (code, name = code) => ({meta:{code,displayName:name,sport:'Football'},rows:[{card_no:'1',player:'Test'}],source_revision:'old'});
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'cm-recent-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  return {root, read:file=>JSON.parse(fs.readFileSync(path.join(root,'data',file),'utf8'))};
}
test('first snapshots create an empty feed without inventing recency; rebuilds ignore revision-only changes', t=>{
  const f=fixture(t), p=product('a');
  updateRecentProducts(f.root,'CV',[p],'2026-10-24T10:00:00Z');
  assert.deepEqual(f.read('recent.json'),{items:[]});
  assert.deepEqual(updateRecentProducts(f.root,'CV',[{...p,source_revision:'new',generated_at:'new'}]),[]);
});
test('real additions/edits append newest-first, deduplicate identities, separate CV/PRV, and cap at ten', t=>{
  const f=fixture(t);
  updateRecentProducts(f.root,'CV',[]); updateRecentProducts(f.root,'PRV',[]);
  const products=Array.from({length:12},(_,i)=>product(String(i)));
  updateRecentProducts(f.root,'CV',products,'2026-10-24T11:00:00Z');
  assert.equal(f.read('recent.json').items.length,10);
  products[0].rows[0].player='Changed';
  updateRecentProducts(f.root,'CV',products,'2026-10-24T12:00:00Z');
  updateRecentProducts(f.root,'PRV',[product('0')],'2026-10-24T13:00:00Z');
  const items=f.read('recent.json').items;
  assert.deepEqual(items.slice(0,2).map(i=>[i.code,i.vault,i.updated_at]),[['0','PRV','2026-10-24T13:00:00.000Z'],['0','CV','2026-10-24T12:00:00.000Z']]);
  assert.equal(items.filter(i=>i.code==='0'&&i.vault==='CV').length,1);
  assert.equal(items.length,10);
  assert.equal(items[0].sport,'football');
});
test('empty products are never announced; removals drop stale links',t=>{
  const f=fixture(t); updateRecentProducts(f.root,'PRV',[]);
  updateRecentProducts(f.root,'PRV',[product('a'),{...product('empty'),rows:[]}]);
  assert.deepEqual(f.read('recent.json').items.map(i=>i.code),['a']);
  updateRecentProducts(f.root,'PRV',[]);
  assert.deepEqual(f.read('recent.json'),{items:[]});
});

test('PRV publisher records content updates but ignores routine source-version rebuilds',t=>{
  const vm=require('node:vm'),{createRequire}=require('node:module');
  const f=fixture(t);
  const write=(file,value)=>{const target=path.join(f.root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(value));};
  fs.mkdirSync(path.join(f.root,'data/prv-calculations'),{recursive:true});
  write('data/v1/manifest.json',{vault_version:'first'});
  write('data/v1/vault/index.json',{index:[{Code:'p',DisplayName:'Test Football',sport:'football'}]});
  write('data/v1/checklists/index.json',{index:[]});
  write('data/prv-checklist-sizes.json',{products:[]});
  write('data/prv-integrity-reviews.json',{products:[]});
  write('data/prv-cv-identity-policy.json',{hold:[]});
  const source={products:{p:{meta:{code:'p',displayName:'Test Football',sport:'football'},rows:[{setType:'Base',setLine:'Gold',printRun:'25'}]}}};
  write('data/v1/vault/products/all.json',source);
  const builder=path.resolve('scripts/build-vault-data.cjs');
  const build=()=>vm.runInNewContext(fs.readFileSync(builder,'utf8'),{require:createRequire(builder),__dirname:path.join(f.root,'scripts'),console:{log(){}}});
  build();assert.deepEqual(f.read('recent.json'),{items:[]});
  write('data/v1/manifest.json',{vault_version:'second'});build();
  assert.deepEqual(f.read('recent.json'),{items:[]});
  source.products.p.rows[0].printRun='30';write('data/v1/vault/products/all.json',source);build();
  assert.equal(f.read('recent.json').items[0].code,'p');assert.equal(f.read('recent.json').items[0].vault,'PRV');
  const before=f.read('recent.json');build();assert.deepEqual(f.read('recent.json'),before);
});
