'use strict';
const model=require('../shared/vault-model.js');
const method='reviewed_creator_estimates_v1';
function validateTarget(input,cv){
 const matches=cv.filter(p=>p.Code===input.code);
 if(matches.length!==1)throw Error('Reviewed estimate requires one existing exact CV identity');
 for(const [meta,key]of [['code','Code'],['displayName','DisplayName'],['sport','sport'],['year','year'],['manufacturer','manufacturer'],['product','product']]){
  if(input.meta?.[meta]!==matches[0][key])throw Error('Reviewed estimate CV metadata conflict: '+meta);
 }
}
function sourceURL(value){
 let url;try{url=new URL(value);}catch{throw Error('Reviewed estimate source URL required');}
 if(url.protocol!=='https:'||url.username||url.password)throw Error('Reviewed estimate source must be a public HTTPS URL');
 return url.href;
}
function calculate(input){
 if(input.schema_version!==4||input.method?.name!==method||!input.code||input.meta?.code!==input.code||!input.meta?.displayName||!input.meta?.sport)throw Error('Invalid reviewed estimate identity or method');
 if(input.anchors!==undefined||input.formats!==undefined||input.odds_rows!==undefined||input.estimated_packs!==undefined||input.method.round_estimates_to!==undefined)throw Error('Direct estimates cannot use odds calibration or rounding');
 const url=sourceURL(input.sources?.estimate_url),date=input.sources?.reviewed_date;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw Error('Valid estimate review date required');
 if(!Array.isArray(input.records)||!input.records.length)throw Error('Reviewed estimate records required');
 const seen=new Set(),groups=new Set(),types={Base:'Base',Insert:'Insert',Autograph:'Auto'};
 const rows=input.records.map((r,i)=>{
  if(typeof r.id!=='string'||!r.id||seen.has(r.id))throw Error('Duplicate or missing reviewed estimate ID');seen.add(r.id);
  if(typeof r.name!=='string'||!r.name.trim()||!Object.hasOwn(types,r.category)||!Number.isInteger(r.subjects)||r.subjects<0)throw Error('Invalid reviewed estimate label or checklist size');
  if(r.kind!=='estimate'||!Number.isFinite(r.estimate)||r.estimate<=0||r.estimate>Number.MAX_SAFE_INTEGER||r.serial_limit!==null)throw Error('Reviewed estimates must stay unnumbered estimates');
  if(['odds','odds_denominator','odds_by_format','proof','round_to'].some(k=>r[k]!==undefined))throw Error('Direct estimates cannot invent odds, proofs or rounding');
  if(r.parallel!==undefined&&typeof r.parallel!=='string')throw Error('Invalid reviewed estimate parallel');
  const group=JSON.stringify([r.category,r.name.trim(),r.parallel||'']);if(groups.has(group))throw Error('Duplicate reviewed estimate subset');groups.add(group);
  const notes='Unverified creator estimate of copies per card; not manufacturer-confirmed. Source-reported estimate retained exactly, without rounding.';
  const raw={code:input.code,setType:types[r.category],setLine:r.name.trim(),parallel:r.parallel||'',printRun:r.estimate,serial:'',subSetSize:r.subjects||'',notes,cmURL:url};
  const row=model.row(raw,input.code,i+1);
  if(row.serial_limit!==null)throw Error('Reviewed estimate label cannot claim a serial limit');
  row.id=input.code+':reviewed-estimate:'+r.id;
  row.measurement={value:r.estimate,kind:'estimate',unit:'cards',scope:'per_card',basis:'reviewed_creator_estimate',verified:false};
  row.source={url,reviewed_date:date};
  row.estimate_provenance={method,reported_value:r.estimate,rounded:false,source_page:r.page??null};
  return row;
 });
 return {schema_version:2,meta:input.meta,rows,calculation_provenance:{method:input.method,sources:input.sources,basis:'reviewed_creator_estimate',verified:false}};
}
module.exports={calculate,validateTarget};
