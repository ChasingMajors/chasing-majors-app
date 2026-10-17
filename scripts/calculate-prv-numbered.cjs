const model=require('../shared/vault-model.js');
function calculate(input){
 if(input.schema_version!==3||!input.code||input.method?.name!=='reviewed_serial_limits_v1'||input.anchors||input.estimated_packs)throw Error('Invalid numbered-only input');
 if(input.formats&&(!Array.isArray(input.formats)||!input.formats.length||input.formats.some(f=>typeof f!=='string'||!f)))throw Error('Invalid source formats');
 const seen=new Set();
 const rows=input.records.map((r,i)=>{
  if(!r.id||seen.has(r.id))throw Error('Duplicate numbered record');seen.add(r.id);
  if(!r.name||!Number.isInteger(r.subjects)||r.subjects<=0||!Number.isInteger(r.serial_limit)||r.serial_limit<=0||!['Autographs','Relics'].includes(r.category))throw Error('Invalid numbered record');
  if(r.kind||r.proof||r.estimated_packs||r.estimate!==undefined)throw Error('Production estimates are not allowed in numbered-only inputs');
  if(r.odds_denominator!==null&&(!Number.isInteger(r.odds_denominator)||r.odds_denominator<=0))throw Error('Invalid source odds');
  if(input.formats&&(!Array.isArray(r.odds_by_format)||r.odds_by_format.length!==input.formats.length||r.odds_by_format.some(d=>d!==null&&(!Number.isInteger(d)||d<=0))))throw Error('Invalid format odds');
  const value=r.serial_limit,maximum=value>1;
  const raw={code:input.code,setType:r.category==='Autographs'?'Auto':'Relic',setLine:r.name,printRun:value,serial:'/'+value,subSetSize:r.subjects,
   notes:maximum?'Maximum nominal numbered ceiling per card; individual subjects can be numbered lower or omitted. Not an estimated production count.':'Nominal one-of-one serial designation per card/design. Does not establish complete subject coverage or copies reaching packs.',cmURL:r.serial_source_url||input.sources.serial_reference_url};
  const row=model.row(raw,input.code,i+1);row.id=input.code+':numbered:'+r.id;row.category=r.category;
  row.measurement={value,kind:maximum?'upper_bound':'serial_limit',unit:'cards',scope:'per_card',basis:'nominal_serial_ceiling',upper_bound:value};
  row.calculation={method:input.method.name,subjects:r.subjects,odds_label:r.odds_label||null,odds_denominator:r.odds_denominator,source_page:r.page||null,unrounded_estimate:null};
  if(input.formats)row.calculation.odds_by_format=r.odds_by_format;
  row.source={url:r.serial_source_url||input.sources.serial_reference_url,odds_url:input.sources.odds_url,checklist_url:input.sources.checklist_url};
  return row;
 });
 return {schema_version:2,meta:input.meta,rows,calculation_provenance:{method:input.method,...(input.formats?{formats:input.formats}:{}),sources:input.sources,withheld:input.withheld,checklist_counts:input.checklist_counts}};
}
module.exports={calculate};
