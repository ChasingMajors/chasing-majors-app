/* Read-only audit. Candidate aliases never alter names, IDs, counts or links. */
const fs=require('node:fs'),path=require('node:path');
const model=require('../shared/vault-model.js');
const root=path.resolve(__dirname,'..');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const clean=v=>String(v??'').normalize('NFKC').trim().replace(/\s+/g,' ');
const nameKey=v=>clean(v).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[’‘]/g,"'").replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const groupKey=v=>nameKey(v).replace(/\b(?:auto|autos|autograph)\b/g,'autographs');
const serialKind=v=>{const s=clean(v);return !s?'empty':model.serialNumber(s)!==null?'exact':/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s|^\d{4}-\d{2}-\d{2}T/.test(s)?'date_corruption':/^\/?[\d,]+\*+$/.test(s)?'footnoted':/^-\s*\/[\d,]+$/.test(s)?'decorated_exact':/^PR\s*:/i.test(s)?'print_run_in_serial_field':/various|varies|variable|tba|n\/a|not numbered|unnumbered/i.test(s)?'unspecified':/or less|up to|maximum|at most|≤/i.test(s)?'maximum':'unparsed';};
function audit(){
 const cvIndex=read('data/v1/checklists/index.json').index,prvIndex=read('data/v2/vault/index.json').index;
 const report={schema_version:1,source_versions:{checklists:read('data/v1/manifest.json').checklists_version,vault:read('data/v1/manifest.json').vault_version},scope:{cv_index_products:cvIndex.length,cv_manifest_products:0,cv_card_rows:0,cv_parallel_rows:0,prv_products:prvIndex.length,prv_rows:0},serial_formats:{cv:{},prv:{}},serial_repairs:[],serial_reviews:[],product_name_differences:[],unmatched_prv_products:[],ambiguous_product_matches:[],group_reviews:[],player_alias_candidates:[],missing_cv_payloads:[],manifest_only_cv_products:[],index_only_cv_products:[],duplicate_product_names:[],scope_notes:['Only active CV sport-manifest targets and active structured PRV index targets are scanned. Historical orphan files are excluded.','Name and player aliases are candidates, not verified identity merges. No data is changed by this script.','External manufacturer/COMC verification is a separate review step; this report does not claim catalog-wide external verification.']};
 const cv=new Map(),cache=new Map(),players=new Map();
 const load=f=>{if(!cache.has(f))cache.set(f,read('data/v1/checklists/products/'+f));return cache.get(f);};
 const count=(tool,s)=>report.serial_formats[tool][serialKind(s)]=(report.serial_formats[tool][serialKind(s)]||0)+1;
 const serialReview=(tool,code,label,raw,extra={})=>{const kind=serialKind(raw);if(!['empty','exact','unspecified'].includes(kind))report.serial_reviews.push({tool,code,label,raw,kind,...extra});};
 for(const sport of ['baseball','basketball','football','hockey','soccer']){
  const manifest=read('data/v1/checklists/products/'+sport+'.json');
  const codes=new Set([...Object.keys(manifest.product_map||{}),...Object.keys(manifest.products||{})]);
  for(const code of codes){
   const file=manifest.product_map?.[code];const p=manifest.products?.[code]||(file&&load(file).products?.[code]);
   if(!p){report.missing_cv_payloads.push({sport,code,file});continue;}
   const entry=cvIndex.find(e=>e.Code===code&&nameKey(e.sport)===sport);
   const meta={...(p.meta||{}),sport};const groups=new Map(),parallelMap=new Map();
   cv.set(sport+'|'+code,{code,sport,meta,entry,groups,parallelMap});
   for(const r of p.rows||[]){report.scope.cv_card_rows++;const subset=clean(r.subset||r.section);if(subset)groups.set(groupKey(subset),subset);
    const player=clean(r.player);if(player&&player.length<100){const k=sport+'|'+nameKey(player);const variants=players.get(k)||new Map();if(!variants.has(player))variants.set(player,{code,card_no:r.card_no,subset});players.set(k,variants);}}
   for(const r of p.parallels||[]){report.scope.cv_parallel_rows++;count('cv',r.serial_no);serialReview('cv',code,r.parallel_name,r.serial_no,{subset:r.applies_to_subset});
    const key=groupKey(r.applies_to_subset||r.applies_to_section)+'|'+groupKey(r.parallel_name),arr=parallelMap.get(key)||[];arr.push({name:r.parallel_name,subset:r.applies_to_subset,serial:model.serialNumber(r.serial_no),raw_serial:r.serial_no});parallelMap.set(key,arr);}
  }
 }
 report.scope.cv_manifest_products=cv.size;
 const indexed=new Set(cvIndex.map(e=>nameKey(e.sport)+'|'+e.Code));
 report.manifest_only_cv_products=[...cv.keys()].filter(k=>!indexed.has(k));report.index_only_cv_products=[...indexed].filter(k=>!cv.has(k));
 for(const [tool,index] of [['cv',cvIndex],['prv',prvIndex]]){const names=new Map();for(const e of index){const key=nameKey(e.sport)+'|'+nameKey(e.DisplayName);const a=names.get(key)||[];a.push(e.Code);names.set(key,a);}for(const [name,codes] of names)if(new Set(codes).size>1)report.duplicate_product_names.push({tool,name,codes});}
 for(const [key,variants] of players)if(variants.size>1)report.player_alias_candidates.push({key,variants:[...variants].map(([name,example])=>({name,...example}))});
 for(const entry of prvIndex){
  const product=read('data/v2/vault/products/'+entry.file),sport=nameKey(entry.sport),exact=cv.get(sport+'|'+entry.Code);
  const candidates=exact?[exact]:[...cv.values()].filter(c=>c.sport===sport&&nameKey(c.entry?.DisplayName||c.meta.displayName)===nameKey(entry.DisplayName));
  const match=candidates.length===1?candidates[0]:null;
  if(!candidates.length)report.unmatched_prv_products.push({code:entry.Code,name:entry.DisplayName,sport});
  if(candidates.length>1)report.ambiguous_product_matches.push({code:entry.Code,candidates:candidates.map(c=>c.code)});
  if(match){const name=match.entry?.DisplayName||match.meta.displayName;if(name!==entry.DisplayName)report.product_name_differences.push({code:entry.Code,cv_code:match.code,cv_name:name,prv_name:entry.DisplayName});}
  for(const r of product.rows||[]){report.scope.prv_rows++;const raw=r.raw?.serial;count('prv',raw);serialReview('prv',entry.Code,r.set_name,raw,{id:r.id});
   const n=model.serialNumber(raw);if(n!==null&&r.serial_limit!==n)report.serial_repairs.push({code:entry.Code,id:r.id,name:r.set_name,raw,previous:r.serial_limit,canonical:n});
   const label=String(r.raw?.setLine||'').match(/\(\s*\/\s*([\d,]+)\s*\)/);if(n!==null&&label&&model.serialNumber(label[1])!==n)report.serial_reviews.push({tool:'prv',code:entry.Code,id:r.id,label:r.set_name,raw,label_serial:label[1],kind:'conflicting_exact_serials'});
   if(!match)continue;
   const rawName=r.set_name||'',parts=rawName.split(/\s+[—–-]\s+/),candidates=[];
   if(parts.length>1){const parent=groupKey(parts.slice(0,-1).join(' - ')),parallel=groupKey(parts.at(-1));candidates.push(...(match.parallelMap.get(parent+'|'+parallel)||[]));}
   if(candidates.length){const limits=[...new Set(candidates.map(c=>c.serial).filter(n=>n!==null))];if(r.serial_limit!==null&&limits.length&&!limits.includes(r.serial_limit))report.group_reviews.push({code:entry.Code,name:r.set_name,kind:'cv_prv_serial_conflict',prv_serial:r.serial_limit,cv_candidates:candidates});}
   if(/\bauto\.?\b|\[base\]/i.test(rawName))report.group_reviews.push({code:entry.Code,id:r.id,name:rawName,kind:'abbreviated_or_bracketed_label',candidate_key:groupKey(rawName)});
  }
 }
 report.summary={...report.scope,serial_repairs:report.serial_repairs.length,date_corruption:report.serial_reviews.filter(x=>x.kind==='date_corruption').length,cv_prv_serial_conflicts:report.group_reviews.filter(x=>x.kind==='cv_prv_serial_conflict').length,serial_reviews:report.serial_reviews.length,product_name_differences:report.product_name_differences.length,unmatched_prv_products:report.unmatched_prv_products.length,ambiguous_product_matches:report.ambiguous_product_matches.length,player_alias_groups:report.player_alias_candidates.length,duplicate_product_names:report.duplicate_product_names.length,group_reviews:report.group_reviews.length,missing_cv_payloads:report.missing_cv_payloads.length,manifest_only_cv_products:report.manifest_only_cv_products.length,index_only_cv_products:report.index_only_cv_products.length};
 return report;
}
if(require.main===module){const report=audit();const dest=process.argv[2]||'docs/card-identity-audit.json';fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.summary));}
module.exports={audit,nameKey,groupKey,serialKind};
