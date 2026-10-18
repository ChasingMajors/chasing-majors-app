const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
const slug=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
// Match the publisher's complete search representation so reviewed refreshes retain
// exact release verification and the same searchable metadata.
function buildSearchRows(product){
 const m=product.meta;
 const common={sport:m.sport,code:m.code,displayName:m.displayName,year:m.year,manufacturer:m.manufacturer,product:m.product};
 const prefix=[m.displayName,m.keywords,m.year,m.sport,m.manufacturer,m.product];
 return [{term:m.displayName,type:'product',...common,section:'',subset:'',card_no:'',player:'',team:'',tag:'',search_blob:[...prefix,m.code].filter(Boolean).join(' ')},...product.rows.map(r=>({term:r.player||m.displayName,type:'card',...common,sport:r.sport||m.sport,code:r.code,section:r.section,subset:r.subset,card_no:r.card_no,player:r.player,team:r.team,tag:r.tag,search_blob:[...prefix,r.section,r.subset,r.card_no,r.player,r.team,r.tag,r.code].filter(Boolean).join(' ')}))];
}
function apply(root,options={}){
 const stamp=options.stamp||new Date().toISOString(),cache=new Map(),changes=new Map();
 const read=file=>{if(changes.has(file))return changes.get(file);if(!cache.has(file))cache.set(file,JSON.parse(fs.readFileSync(path.join(root,file),'utf8')));return cache.get(file);};
 const write=(file,value)=>{const old=fs.existsSync(path.join(root,file))?JSON.parse(fs.readFileSync(path.join(root,file),'utf8')):null;if(JSON.stringify(old)===JSON.stringify(value))return;changes.set(file,value);};
 const catalog=read('data/cv-reviewed-imports/catalog.json');
 if(catalog.schema_version!==1)throw Error('Unsupported checklist import schema');
 const input=(entry)=>{const file='data/cv-reviewed-imports/'+entry.file;const bytes=fs.readFileSync(path.join(root,file));if(digest(bytes)!==entry.content_sha256)throw Error('Reviewed input checksum mismatch: '+entry.file);return read(file);};
 const index=read('data/v1/checklists/index.json');
 const report={review_id:catalog.review_id,products:[],patches:[],conflicts:[]},active=new Map();
 const productPath=sport=>'data/v1/checklists/products/'+sport+'.json';
 const getProduct=(sport,code)=>{const bundle=read(productPath(sport));const file=bundle.product_map?.[code];return {bundle,file:file&&'data/v1/checklists/products/'+file,product:bundle.products?.[code]||(file&&read('data/v1/checklists/products/'+file).products?.[code])};};
 for(const entry of catalog.products){
  const reviewed=input(entry),{meta,rows}=reviewed;
  if(meta.code!==entry.code||meta.sport!==entry.sport||rows.length!==entry.expected_rows)throw Error('Reviewed checklist identity/count mismatch');
  const counts={};const seen=new Set();
  for(const r of rows){
   if(r.code!==entry.code||r.sport!==entry.sport||!r.subset||!r.card_no||typeof r.player!=='string'||typeof r.team!=='string')throw Error('Malformed reviewed checklist row');
   const key=r.subset+'\0'+r.card_no;if(seen.has(key))throw Error('Duplicate reviewed card identity');seen.add(key);counts[r.subset]=(counts[r.subset]||0)+1;
  }
  if(JSON.stringify(counts)!==JSON.stringify(entry.expected_subset_counts))throw Error('Reviewed subset count mismatch');
  const current=getProduct(entry.sport,entry.code);let product=reviewed,status='imported';
  // A populated export owns its product. Never overwrite a fresh/manual correction.
  if(current.product?.rows?.length && JSON.stringify(current.product)!==JSON.stringify(reviewed)){
   product=current.product;status='source_preserved';
  }else{
   if(current.product?.parallels?.length)product={...reviewed,parallels:current.product.parallels};
   const name=entry.sport+'-reviewed-'+slug(entry.code)+'.json';
   const file='data/v1/checklists/products/'+name;
   write(file,{ok:true,sport:entry.sport,kind:'checklist_products',source:'Reviewed official Topps checklist import',products:{[entry.code]:product}});
   current.bundle.shards=current.bundle.shards||[];if(!current.bundle.shards.includes(name))current.bundle.shards.push(name);
   current.bundle.product_map=current.bundle.product_map||{};current.bundle.product_map[entry.code]=name;
   if(current.bundle.products)delete current.bundle.products[entry.code];
  }
  // Direct payloads avoid the failed per-product fetch before the shard fallback.
  write(`data/v1/checklists/products/${entry.sport}/${entry.code}.json`,product);
  if(!index.index.some(e=>e.Code===entry.code))index.index.push({Code:entry.code,DisplayName:product.meta.displayName,Keywords:product.meta.keywords||product.meta.displayName,year:product.meta.year,sport:product.meta.sport,manufacturer:product.meta.manufacturer,product:product.meta.product});
  active.set(entry.code,{sport:entry.sport,product});
  report.products.push({code:entry.code,status,cards:product.rows.length,withheld:reviewed.source_provenance.withheld_source_records});
 }
 for(const entry of catalog.patches){
  const patch=input(entry);const current=getProduct(patch.sport,patch.code);
  if(!current.product?.rows?.length)throw Error('Missing patch target');
  if(current.product.meta.code!==patch.code||current.product.meta.sport!==patch.sport)throw Error('Patch target identity mismatch');
  let added=0;
  for(const row of patch.rows){
   if(row.code!==patch.code||row.sport!==patch.sport||row.subset!==patch.subset||!row.card_no||!row.player)throw Error('Invalid reviewed patch row');
   const existing=current.product.rows.find(r=>r.subset===patch.subset&&r.card_no===row.card_no);
   if(existing){if(JSON.stringify(existing)!==JSON.stringify(row))report.conflicts.push({code:patch.code,card_no:row.card_no,reason:'Existing source row preserved'});continue;}
   current.product.rows.push(row);added++;
  }
  if(added){
   current.product.reviewed_additions=[...(current.product.reviewed_additions||[]).filter(p=>p.review_id!==catalog.review_id),{review_id:catalog.review_id,subset:patch.subset,source_url:patch.source_url,source_sha256:patch.source_sha256,card_ids:patch.rows.map(r=>r.card_no)}];
   if(current.file)write(current.file,read(current.file));
   else write(productPath(patch.sport),current.bundle);
  }
  write(`data/v1/checklists/products/${patch.sport}/${patch.code}.json`,current.product);
  active.set(patch.code,{sport:patch.sport,product:current.product});report.patches.push({code:patch.code,added});
 }
 for(const entry of catalog.parallel_patches||[]){
  const patch=input(entry),current=getProduct(patch.sport,patch.code);
  if(!current.product?.rows?.length||current.product.meta.code!==patch.code||current.product.meta.sport!==patch.sport)throw Error('Missing parallel patch target');
  if(!patch.source_url||!Array.isArray(patch.parallels))throw Error('Missing parallel patch evidence');
  current.product.parallels=current.product.parallels||[];let added=0;
  const seen=new Set();
  for(const row of patch.parallels){
   const subset=row.applies_to_subset==='[Base]'?'Base':row.applies_to_subset;
   if(row.code!==patch.code||!row.parallel_name||typeof row.serial_no!=='string'||!row.applies_to_section||!subset||!current.product.rows.some(r=>r.section===row.applies_to_section&&r.subset===subset))throw Error('Invalid reviewed parallel scope');
   const key=[row.applies_to_section,row.applies_to_subset,row.parallel_name].map(v=>v.toLowerCase()).join('\0');
   if(seen.has(key))throw Error('Duplicate reviewed parallel');seen.add(key);
   const existing=current.product.parallels.find(r=>[r.applies_to_section,r.applies_to_subset,r.parallel_name].map(v=>String(v||'').toLowerCase()).join('\0')===key);
   if(existing){if(existing.serial_no!==row.serial_no)report.conflicts.push({code:patch.code,parallel:row.parallel_name,subset,reason:'Existing source parallel preserved'});continue;}
   current.product.parallels.push(row);added++;
  }
  if(added){
   current.product.reviewed_parallel_additions=[...(current.product.reviewed_parallel_additions||[]).filter(p=>p.review_id!==patch.review_id),{review_id:patch.review_id,source_url:patch.source_url,parallels:patch.parallels}];
   if(current.file)write(current.file,read(current.file));else write(productPath(patch.sport),current.bundle);
  }
  write(`data/v1/checklists/products/${patch.sport}/${patch.code}.json`,current.product);
  active.set(patch.code,{sport:patch.sport,product:current.product});report.patches.push({code:patch.code,kind:'parallels',added});
 }
 for(const entry of catalog.row_corrections||[]){
  const patch=input(entry),current=getProduct(patch.sport,patch.code);let corrected=0;
  if(!current.product?.rows?.length||!patch.source_url)throw Error('Missing correction target/evidence');
  for(const correction of patch.corrections){
   const {before,after}=correction;
   if(before.code!==patch.code||before.sport!==patch.sport||before.code!==after.code||before.section!==after.section||before.subset!==after.subset||before.card_no!==after.card_no)throw Error('Correction cannot change card identity');
   const matches=current.product.rows.filter(r=>r.section===before.section&&r.subset===before.subset&&r.card_no===before.card_no);
   if(matches.length!==1)throw Error('Ambiguous correction target');
   const row=matches[0];if(JSON.stringify(row)===JSON.stringify(after))continue;
   if(JSON.stringify(row)!==JSON.stringify(before)){report.conflicts.push({code:patch.code,card_no:before.card_no,reason:'Changed source row preserved'});continue;}
   Object.assign(row,after);corrected++;
  }
  if(corrected){
   current.product.reviewed_row_corrections=[...(current.product.reviewed_row_corrections||[]).filter(p=>p.review_id!==patch.review_id),patch];
   if(current.file)write(current.file,read(current.file));else write(productPath(patch.sport),current.bundle);
  }
  write(`data/v1/checklists/products/${patch.sport}/${patch.code}.json`,current.product);
  active.set(patch.code,{sport:patch.sport,product:current.product});report.patches.push({code:patch.code,kind:'row_corrections',corrected});
 }
 for(const entry of catalog.serial_corrections||[]){
  const patch=input(entry),current=getProduct(patch.sport,patch.code);let corrected=0;
  if(!current.product?.rows?.length||current.product.meta.code!==patch.code||current.product.meta.sport!==patch.sport||!patch.source_url||!patch.review_id||!Array.isArray(patch.corrections))throw Error('Missing serial correction target/evidence');
  const seen=new Set(),same=(a,b)=>a&&b&&Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>JSON.stringify(a[k])===JSON.stringify(b[k]));
  for(const {before,after} of patch.corrections){
   if(!before||!after||before.code!==patch.code||!before.applies_to_section||!before.applies_to_subset||!before.parallel_name||!/^\/[1-9]\d*$/.test(after.serial_no))throw Error('Invalid reviewed serial correction');
   const fields=new Set([...Object.keys(before),...Object.keys(after)]);
   if([...fields].some(k=>k!=='serial_no'&&JSON.stringify(before[k])!==JSON.stringify(after[k])))throw Error('Serial correction cannot change parallel identity');
   const identity=r=>[r.code,r.applies_to_section,r.applies_to_subset,r.parallel_name].join('\0');
   const key=identity(before);if(seen.has(key))throw Error('Duplicate serial correction target');seen.add(key);
   const matches=(current.product.parallels||[]).filter(r=>identity(r)===key);
   if(matches.length>1)throw Error('Ambiguous serial correction target');
   const row=matches[0];
   if(same(row,after))continue;
   if(!same(row,before)){report.conflicts.push({code:patch.code,subset:before.applies_to_subset,parallel:before.parallel_name,reason:'Changed or missing source parallel preserved'});continue;}
   Object.assign(row,after);corrected++;
  }
  if(corrected){
   current.product.reviewed_serial_corrections=[...(current.product.reviewed_serial_corrections||[]).filter(p=>p.review_id!==patch.review_id),patch];
   if(current.file)write(current.file,read(current.file));else write(productPath(patch.sport),current.bundle);
  }
  write(`data/v1/checklists/products/${patch.sport}/${patch.code}.json`,current.product);
  active.set(patch.code,{sport:patch.sport,product:current.product});report.patches.push({code:patch.code,kind:'serial_corrections',corrected});
 }
 for(const entry of catalog.metadata_corrections||[]){
  const patch=input(entry),current=getProduct(patch.sport,patch.code);
  const allowed=new Set(['displayName','product','keywords']);
  if(!current.product?.rows?.length||current.product.meta.code!==patch.code||current.product.meta.sport!==patch.sport||!patch.source_url||!patch.review_id||!patch.before||!patch.after)throw Error('Missing metadata correction target/evidence');
  const fields=Object.keys(patch.before);
  if(!fields.length||fields.length!==Object.keys(patch.after).length||fields.some(k=>!allowed.has(k)||typeof patch.before[k]!=='string'||typeof patch.after[k]!=='string'||!patch.after[k].trim()))throw Error('Metadata correction cannot change product identity');
  const matches=values=>fields.every(k=>current.product.meta[k]===values[k]);
  let status='already_correct';
  if(matches(patch.before)){
   Object.assign(current.product.meta,patch.after);status='corrected';
   current.product.reviewed_metadata_corrections=[...(current.product.reviewed_metadata_corrections||[]).filter(p=>p.review_id!==patch.review_id),patch];
   if(current.file)write(current.file,read(current.file));else write(productPath(patch.sport),current.bundle);
  }else if(!matches(patch.after)){
   report.conflicts.push({code:patch.code,reason:'Changed source metadata preserved'});status='source_preserved';
  }
  const entries=index.index.filter(e=>e.Code===patch.code&&e.sport===patch.sport);
  if(entries.length!==1)throw Error('Ambiguous metadata index target');
  // The selected payload remains authoritative, including a later source edit.
  Object.assign(entries[0],{DisplayName:current.product.meta.displayName,product:current.product.meta.product,Keywords:current.product.meta.keywords});
  write(`data/v1/checklists/products/${patch.sport}/${patch.code}.json`,current.product);
  active.set(patch.code,{sport:patch.sport,product:current.product});
  report.patches.push({code:patch.code,kind:'metadata',status});
 }
 const searchBase='data/v1/checklists/search-index/';
 const managed=new Set([...active].map(([code,{sport}])=>sport+'-reviewed-'+slug(code)+'.json'));
 const prune=file=>{
  const data=read(file);if(!Array.isArray(data.rows))return;
  const rows=data.rows.filter(r=>!active.has(r.code||r.Code));if(rows.length===data.rows.length)return;
  data.rows=rows;if(Object.hasOwn(data,'row_count'))data.row_count=rows.length;data.generated_at=stamp;write(file,data);
 };
 for(const sport of new Set([...active.values()].map(p=>p.sport))){
  const search=read(searchBase+sport+'.json');
  for(const name of search.shards||[])if(!managed.has(name))prune(searchBase+name);
  const registry=read(searchBase+'sources.json');
  for(const source of registry.sources?.[sport]||[]){
   const sourceFile=searchBase+source.path,sourceData=read(sourceFile);
   if(sourceData.sharded)for(const name of sourceData.shards)prune(searchBase+'sources/'+name);
   else prune(sourceFile);
  }
  for(const [code,{sport:productSport,product}] of active){
   if(productSport!==sport)continue;
   const meta=product.meta,name=sport+'-reviewed-'+slug(code)+'.json';
   const common={sport,code,displayName:meta.displayName,year:meta.year,manufacturer:meta.manufacturer,product:meta.product};
   const searchRows=buildSearchRows(product);
   write(searchBase+name,{ok:true,sport,kind:'checklist_search',source:'Reviewed official Topps checklist import',rows:searchRows});
   if(!search.shards.includes(name))search.shards.push(name);
   search.product_shards=search.product_shards||{};search.product_shards[code]=[name];
  }
  write(searchBase+sport+'.json',search);
  write(productPath(sport),read(productPath(sport)));
 }
 write('data/v1/checklists/index.json',index);
 if(changes.size){
  const manifest=read('data/v1/manifest.json');manifest.checklists_version=stamp;manifest.version=stamp;manifest.generated_at=stamp;write('data/v1/manifest.json',manifest);
  // Mark only changed index/manifests; product and search payload bodies stay deterministic.
  for(const file of ['data/v1/checklists/index.json',...[...new Set([...active.values()].map(p=>p.sport))].flatMap(s=>[productPath(s),searchBase+s+'.json'])])if(changes.has(file))changes.get(file).generated_at=stamp;
 }
 for(const [file,value] of changes){
  const target=path.join(root,file),old=fs.existsSync(target)?fs.readFileSync(target,'utf8'):'';
  fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.writeFileSync(target,JSON.stringify(value,null,/^[\[{]\r?\n/.test(old)?2:undefined)+'\n');
 }
 report.changed_files=[...changes.keys()];return report;
}
if(require.main===module){const report=apply(path.resolve(__dirname,'..'));console.log(JSON.stringify(report));}
module.exports={apply,buildSearchRows};
