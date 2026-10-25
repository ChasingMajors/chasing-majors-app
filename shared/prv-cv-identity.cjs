// CV is the product registry. Dataset rows remain owned by their respective vaults.
const fields=['DisplayName','year','sport','manufacturer','product'];
const text=v=>String(v??'').trim();
const fold=v=>text(v).toLowerCase().replace(/\s+/g,' ');
const year=e=>text(e.year)||text(e.DisplayName).match(/\b(?:19|20)\d{2}(?:[-–/]\d{2,4})?\b/)?.[0]||'';
function standardize(records,cv,policy={}) {
 const aliases={},report={compliant:[],changed:[],held:[]},used=new Set();
 const blocked=new Map((policy.hold||[]).map(e=>[fold(e.cv_code),e.reason]));
 function candidates(entry){
  const same=cv.filter(c=>fold(c.sport)===fold(entry.sport));
  const direct=same.filter(c=>c.Code===entry.Code);
  return direct.length?direct:same.filter(c=>fold(c.DisplayName)===fold(entry.DisplayName)&&year(c)===year(entry));
 }
 const targets=new Map();
 for(const r of records){const m=candidates(r.entry);if(m.length===1)targets.set(m[0].Code,(targets.get(m[0].Code)||0)+1);}
 const resolved=records.map(record=>{
  const {entry,product}=record;
  const sameSport=cv.filter(c=>fold(c.sport)===fold(entry.sport));
  let matches=sameSport.filter(c=>c.Code===entry.Code);
  if(!matches.length)matches=sameSport.filter(c=>fold(c.DisplayName)===fold(entry.DisplayName)&&year(c)===year(entry));
  let reason=matches.length!==1?(matches.length?'Ambiguous CV identity':'No verified CV identity'):null;
  const c=matches[0];
  if(!reason&&fold(c.DisplayName)!==fold(entry.DisplayName))reason='Same code has conflicting display names';
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
  if(changes.length)report.changed.push({source_code:previous,canonical_code:c.Code,fields:changes});
  return {...record,entry:{...entry,...canonical,identity_status:'compliant'},product:{...product,meta,rows}};
 });
 // An alias may never shadow a retained product or create an alias chain.
 const codes=new Set(resolved.map(r=>r.entry.Code));
 for(const old of Object.keys(aliases))if(codes.has(old)||!codes.has(aliases[old].products[0]))throw Error('Unsafe canonical alias: '+old);
 return {records:resolved,aliases,report};
}
module.exports={standardize};
