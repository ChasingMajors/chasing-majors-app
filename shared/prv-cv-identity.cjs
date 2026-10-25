// CV is the product registry. Dataset rows remain owned by their respective vaults.
const fields=['DisplayName','year','sport','manufacturer','product'];
const text=v=>String(v??'').trim();
const fold=v=>text(v).toLowerCase().replace(/\s+/g,' ');
const year=e=>text(e.year)||text(e.DisplayName).match(/\b(?:19|20)\d{2}(?:[-–/]\d{2,4})?\b/)?.[0]||'';
function standardize(records,cv,policy={}) {
 const catalog=(policy.catalog_products||[]).map(c=>({...c,cv_indexed:false}));
 for(const c of catalog){
  if(!c.identity_only||!/^https:\/\//.test(c.source_url||'')||['Code',...fields].some(k=>!text(c[k])))throw Error('Unreviewed catalog-only identity');
  if(cv.some(e=>e.Code===c.Code)||catalog.filter(e=>e.Code===c.Code).length!==1)throw Error('Catalog-only identity duplicates CV or another catalog record');
 }
 const registry=cv.map(c=>({...c,cv_indexed:true})).concat(catalog);
 const reviews=policy.reviewed_mappings||[];
 if(new Set(reviews.map(r=>r.source.Code)).size!==reviews.length)throw Error('Duplicate reviewed identity source');
 function approved(entry){
  const r=reviews.find(r=>r.source.Code===entry.Code),target=r&&registry.find(c=>c.Code===r.canonical_code);
  const exact=r&&['Code',...fields].every(k=>text(r.source[k])===text(entry[k]));
  // Maintenance can correct all metadata while retaining a legacy source code.
  const canonical=r&&target&&fields.every(k=>text(target[k])===text(entry[k]));
  return r&&(exact||canonical)&&r.review_id&&/^https:\/\//.test(r.source_url||'')?r:null;
 }
 const aliases={},report={scope:'Product identity compliance; catalog-only identities do not establish CV checklist coverage.',compliant:[],changed:[],held:[],catalog_only:[]},used=new Set();
 const blocked=new Map((policy.hold||[]).map(e=>[fold(e.cv_code),e.reason]));
 function candidates(entry){
  const review=approved(entry);
  if(reviews.some(r=>r.source.Code===entry.Code))return review?registry.filter(c=>c.Code===review.canonical_code):[];
  const same=registry.filter(c=>fold(c.sport)===fold(entry.sport));
  const direct=same.filter(c=>c.Code===entry.Code);
  return direct.length?direct:same.filter(c=>fold(c.DisplayName)===fold(entry.DisplayName)&&year(c)===year(entry));
 }
 const targets=new Map();
 for(const r of records){const m=candidates(r.entry);if(m.length===1)targets.set(m[0].Code,(targets.get(m[0].Code)||0)+1);}
 const resolved=records.map(record=>{
  const {entry,product}=record;
  const matches=candidates(entry),review=approved(entry);
  let reason=matches.length!==1?(matches.length?'Ambiguous CV identity':'No verified CV identity'):null;
  const c=matches[0];
  if(!reason&&!review&&fold(c.DisplayName)!==fold(entry.DisplayName))reason='Same code has conflicting display names';
  if(!reason&&blocked.has(fold(c.Code)))reason=blocked.get(fold(c.Code));
  if(!reason&&fields.some(k=>!text(c[k])))reason='CV registry has incomplete required metadata';
  if(!reason&&(used.has(c.Code)||targets.get(c.Code)>1))reason='Multiple PRV records resolve to one CV product';
  // Detect collisions before changing ANY record, including a later exact-code entry.
  if(!reason&&records.some(r=>r!==record&&r.entry.Code===c.Code))reason='Canonical code already belongs to another PRV record';
  if(reason){report.held.push({code:entry.Code,cv_code:c?.Code||null,reason});return {...record,entry:{...entry,identity_status:'needs_review'}};}
  used.add(c.Code);
  const changes=['Code',...fields].filter(k=>text(entry[k])!==text(c[k]));
  const canonical={Code:c.Code};for(const k of fields)canonical[k]=c[k];
  const meta={...product.meta,code:c.Code,displayName:c.DisplayName,year:c.year,sport:c.sport,manufacturer:c.manufacturer,product:c.product};
  const previous=entry.Code;
  if(previous!==c.Code)aliases[previous]={displayName:c.DisplayName,products:[c.Code],kind:'canonical_identity'};
  const rows=product.rows.map(r=>({...r,product_id:c.Code,
   id:typeof r.id==='string'&&r.id.startsWith(previous+':')?c.Code+r.id.slice(previous.length):r.id,
   group_id:typeof r.group_id==='string'&&r.group_id.startsWith(previous+':')?c.Code+r.group_id.slice(previous.length):r.group_id}));
  report.compliant.push(c.Code);
  if(!c.cv_indexed)report.catalog_only.push(c.Code);
  if(changes.length)report.changed.push({source_code:previous,canonical_code:c.Code,fields:changes});
  return {...record,entry:{...entry,...canonical,identity_status:'compliant',cv_indexed:c.cv_indexed},product:{...product,meta,rows}};
 });
 // An alias may never shadow a retained product or create an alias chain.
 const codes=new Set(resolved.map(r=>r.entry.Code));
 for(const old of Object.keys(aliases))if(codes.has(old)||!codes.has(aliases[old].products[0]))throw Error('Unsafe canonical alias: '+old);
 return {records:resolved,aliases,report,registry};
}
module.exports={standardize};
