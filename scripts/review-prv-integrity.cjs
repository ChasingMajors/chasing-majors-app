const crypto=require('node:crypto');
const model=require('../shared/vault-model.js');
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;
const fingerprint=rows=>crypto.createHash('sha256').update(JSON.stringify(stable(rows))).digest('hex');
function quality(product,code){
 const groups=new Map();
 for(const r of product.rows){
  r.issues=r.issues.filter(s=>!['Conflicting counts for matching labels','Repeated source entry','Parallel identity missing'].includes(s));
  if(r.serial_limit!==null&&/^(Base|Chrome|Insert|Autograph|Variation)$/i.test(r.set_name))r.issues.push('Parallel identity missing');
  r.group_id=`${code}:${model.key(r.section)}:${model.key(r.set_name)}:${r.serial_limit??'unnumbered'}`;
  const g=groups.get(r.group_id)||[];g.push(r);groups.set(r.group_id,g);
 }
 for(const group of groups.values()){
  if(group.length<2)continue;
  const conflict=new Set(group.map(r=>JSON.stringify([r.measurement,r.checklist_size]))).size>1;
  for(const r of group)r.issues.push(conflict?'Conflicting counts for matching labels':'Repeated source entry');
 }
 product.quality={...product.quality,records:product.rows.length,flagged_records:product.rows.filter(r=>r.issues.length).length};
 return product;
}
function review(records,catalog){
 const report={schema_version:1,applied:[],stale_reviews:[],quarantined:[],unresolved:[],failed:[]},aliases={};
 const output=[];
 for(const record of records){
  const {entry,product}=record;
  const rule=catalog.products.find(p=>p.code===entry.Code);
  if(!rule){output.push(record);continue;}
  const sourceRows=product.rows.filter(r=>r.id.startsWith(entry.Code+':row:'));
  if(fingerprint(sourceRows.map(r=>r.raw))!==rule.source_sha256){
   report.stale_reviews.push({code:entry.Code,reason:'Source rows changed; review is required before corrections can be applied.'});
   output.push(record);continue;
  }
  // Apply this product's corrections against an isolated deep clone with scratch
  // accumulators. Shared report/output/aliases are only touched on full success, so a
  // throw mid-product can never leave shared build state partially mutated. On failure
  // the ORIGINAL, unmodified record is published and the failure is recorded additively.
  try{
   const work=structuredClone(record);
   const workProduct=work.product;
   const workSourceRows=workProduct.rows.filter(r=>r.id.startsWith(entry.Code+':row:'));
   const localApplied=[],localQuarantined=[],localUnresolved=[],localOutput=[];
   let localAlias=null;
   for(const pending of rule.pending_identity_reviews||[]){
    for(const position of pending.candidate_positions||[]){
     const row=workSourceRows[position-1];if(!row)throw Error('Invalid pending identity row');
     if(!row.issues.includes('Parallel identity unresolved'))row.issues.push('Parallel identity unresolved');
    }
    localUnresolved.push({code:entry.Code,kind:'ambiguous_review_mapping',positions:pending.candidate_positions,reason:pending.reason});
   }
   const removed=new Set();
   for(const action of rule.actions||[]){
    const row=workSourceRows[action.position-1];
    if(!row)throw Error('Invalid reviewed row position: '+entry.Code);
    if(action.quarantine){removed.add(row);localQuarantined.push({source_code:entry.Code,source_row_id:row.id,reason:action.quarantine,row});continue;}
    for(const [key,value] of Object.entries(action.set||{})){
     if(!['set_name','section','category'].includes(key))throw Error('Integrity review cannot change counts or raw evidence');
     row[key]=value;
    }
    row.identity_review={basis:action.basis,source_url:action.source_url};
    localApplied.push({code:entry.Code,id:row.id,original_name:row.raw.setLine,set:action.set});
   }
   workProduct.rows=workProduct.rows.filter(r=>!removed.has(r));
   workProduct.quality.quarantined_records=removed.size;
   if(rule.split){
    const routed=new Set();
    for(const part of rule.split){
     const rows=part.positions.map(position=>{
      const r=workSourceRows[position-1];
      if(!r||removed.has(r)||routed.has(r))throw Error('Invalid or repeated split row');
      routed.add(r);
      return {...r,source_row_id:r.id,product_id:part.entry.Code,id:`${part.entry.Code}:source:${position}`};
     });
     const existing=records.find(r=>r.entry.Code===part.entry.Code);
     if(existing)throw Error('Split target already exists; reconcile populated products before publishing');
     const meta={code:part.entry.Code,displayName:part.entry.DisplayName,year:part.entry.year,sport:part.entry.sport,manufacturer:part.entry.manufacturer,product:part.entry.product};
     localOutput.push({entry:part.entry,product:{...workProduct,meta,rows,split_provenance:{source_code:entry.Code,source_sha256:rule.source_sha256}}});
    }
    if(routed.size!==workProduct.rows.length)throw Error('Split would lose source rows: '+entry.Code);
    localAlias={displayName:entry.DisplayName,products:rule.split.map(p=>p.entry.Code)};
    localApplied.push({code:entry.Code,split_into:localAlias.products});
   }else localOutput.push(work);
   // Per-product body succeeded: merge scratch results into the shared structures.
   report.applied.push(...localApplied);
   report.quarantined.push(...localQuarantined);
   report.unresolved.push(...localUnresolved);
   output.push(...localOutput);
   if(localAlias)aliases[entry.Code]=localAlias;
  }catch(err){
   // Publish the original, unmodified record (clean pre-review source rows) and record
   // the failure additively so one bad rule cannot abort the whole build.
   output.push(record);
   report.failed.push({code:entry.Code,reason:err.message,kind:'review_failed'});
  }
 }
 for(const rule of catalog.product_name_reviews||[]){
  const matches=output.filter(r=>r.entry.Code===rule.code);
  if(matches.length!==1||!rule.before||!rule.after||!rule.source_url){report.stale_reviews.push({code:rule.code,reason:'Display-name review target is missing or ambiguous.'});continue;}
  const {entry,product}=matches[0];
  if(entry.DisplayName===rule.after&&product.meta.displayName===rule.after)continue;
  if(entry.DisplayName!==rule.before||product.meta.displayName!==rule.before){report.stale_reviews.push({code:rule.code,reason:'Source display name changed; reviewed name was not applied.'});continue;}
  entry.DisplayName=rule.after; product.meta={...product.meta,displayName:rule.after};
  entry.Keywords=[entry.Keywords,rule.before].filter(Boolean).join(' ');
  product.display_name_review={source_name:rule.before,basis:rule.basis,source_url:rule.source_url};
  report.applied.push({code:rule.code,display_name:rule.after,source_name:rule.before});
 }
 for(const {entry,product} of output){
  quality(product,entry.Code);
  for(const r of product.rows){
   if(r.issues.includes('Parallel identity missing')||r.set_name.length>160)report.unresolved.push({code:entry.Code,id:r.id,name:r.set_name,serial_limit:r.serial_limit,issues:r.issues});
  }
 }
 return {records:output,report,aliases};
}
module.exports={review,fingerprint,quality};
