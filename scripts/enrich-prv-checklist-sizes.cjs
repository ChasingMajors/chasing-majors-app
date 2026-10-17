const model=require('../shared/vault-model.js');
function enrich(product,review){
 if(!review)return product;
 const subsets=new Map();
 for(const s of review.subsets){
  if(!s.name||!Number.isInteger(s.size)||s.size<1||!s.source_url||!Array.isArray(s.card_ids)||!s.card_ids.length)throw Error('Invalid reviewed checklist size');
  if(subsets.has(s.name))throw Error('Duplicate reviewed subset');subsets.set(s.name,s);
 }
 const applied=[];
 for(const rule of review.rules){
  const s=subsets.get(rule.subset);if(!s||!['fill_missing','replace_expected'].includes(rule.mode))throw Error('Invalid checklist mapping');
  for(const row of product.rows){
   if(row.set_name!==rule.name)continue;
   const before=row.checklist_size;
   if(rule.mode==='fill_missing'&&Number.isInteger(before)&&before>0)continue;
   if(rule.mode==='replace_expected'&&before!==rule.expected)continue;
   row.checklist_size=s.size;
   row.checklist_size_provenance={basis:'reviewed_parent_checklist',subset:s.name,source_url:s.source_url,source_sha256:s.source_sha256,previous_value:before};
   applied.push({id:row.id,before,after:s.size});
  }
 }
 for(const name of review.count_only_subsets){
  const s=subsets.get(name);if(!s)throw Error('Missing checklist-only subset');
  const id=review.code+':checklist-size:'+model.key(name);
  if(product.rows.some(r=>r.id===id))continue;
  const raw={code:review.code,setType:'Checklist',setLine:name,printRun:'',serial:'',subSetSize:s.size,notes:'',cmURL:s.source_url};
  const row=model.row(raw,review.code,product.rows.length+1);row.id=id;row.category='Checklist sizes';row.section='Checklist';
  row.checklist_size_provenance={basis:'reviewed_parent_checklist',subset:s.name,source_url:s.source_url,source_sha256:s.source_sha256};
  product.rows.push(row);
 }
 product.checklist_size_review={reviewed:true,updated_rows:applied.length,count_only_rows:review.count_only_subsets.length};
 return product;
}
module.exports={enrich};
