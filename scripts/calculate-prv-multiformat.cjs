const model=require('../shared/vault-model.js');
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const finite=a=>Array.isArray(a)&&a.every(Number.isFinite);
function system(input){
  const n=input.formats?.length,t=input.method?.anchor_tolerance,scale=input.method?.pack_scale;
  if(!n || !(input.method.max_relative_width>0&&input.method.max_relative_width<=.1) || !(t>0&&t<=.03) || scale!==1000000 || input.anchors.length<3)throw Error('Invalid multiformat calibration');
  const A=input.anchors.map(a=>{
    if(!(a.subjects>0&&a.serial_limit>1) || a.odds.length!==n)throw Error('Invalid numbered anchor');
    return a.odds.map(d=>d===null?0:(d>0?scale/d/(a.subjects*a.serial_limit):NaN));
  });
  if(!A.every(finite))throw Error('Invalid anchor odds');
  return {U:[...A,...A.map(r=>r.map(v=>-v))],b:[...A.map(()=>1+t),...A.map(()=>-(1-t))],n,scale};
}
// Verify primal/dual certificates generated during review. CI needs no numerical
// solver: feasibility plus matching objectives proves each bound is optimal.
function certifiedMinimum(cost,primal,dual,{U,b,n}){
  if(!finite(primal)||!finite(dual)||primal.length!==n||dual.length!==b.length)throw Error('Invalid bound certificate');
  if(primal.some(x=>x< -1e-8)||dual.some(y=>y>1e-8))throw Error('Certificate sign violation');
  for(let i=0;i<U.length;i++)if(dot(U[i],primal)>b[i]+1e-6)throw Error('Infeasible format mix');
  for(let j=0;j<n;j++){
    const lhs=U.reduce((s,row,i)=>s+row[j]*dual[i],0);
    if(lhs>cost[j]+1e-8*Math.max(1,Math.abs(cost[j])))throw Error('Invalid dual bound');
  }
  const p=dot(cost,primal),d=dot(b,dual);
  if(Math.abs(p-d)>1e-6*Math.max(1,Math.abs(p),Math.abs(d)))throw Error('Unproven bound optimum');
  return p;
}
function calculate(input){
  const s=system(input),seen=new Set();
  const rows=input.records.map((r,i)=>{
    if(seen.has(r.id))throw Error('Duplicate calculated record');seen.add(r.id);
    if(!r.name||!Number.isInteger(r.subjects)||r.subjects<=0||r.odds.length!==s.n||r.odds.some(d=>d!==null&&(!Number.isFinite(d)||d<=0)))throw Error('Invalid mapped odds record');
    if(r.serial_is_maximum!==undefined&&(r.serial_is_maximum!==true||r.kind!=='serial_limit'))throw Error('Invalid serial maximum');
    let value,lower=null,upper=null,unrounded=null;
    if(r.kind==='serial_limit'){
      if(!Number.isInteger(r.serial_limit)||r.serial_limit<=0)throw Error('Invalid serial limit');
      value=r.serial_limit;
    }else{
      if(!['estimate','average'].includes(r.kind)||!(r.round_to>0))throw Error('Invalid estimate meaning');
      const c=r.odds.map(d=>d===null?0:s.scale/d),p=r.proof;
      lower=certifiedMinimum(c,p.min_primal,p.min_dual,s)/r.subjects;
      upper=-certifiedMinimum(c.map(v=>-v),p.max_primal,p.max_dual,s)/r.subjects;
      unrounded=(lower+upper)/2;
      if(!(lower>0&&upper>=lower) || (upper-lower)/unrounded>Math.min(.1,input.method.max_relative_width)+1e-8)throw Error('Format mix is too uncertain to publish');
      value=Math.max(1,Math.round(unrounded/r.round_to)*r.round_to);
    }
    const numbered=r.kind==='serial_limit';
    const raw={code:input.code,setType:r.category==='Autographs'?'Auto':r.category==='Relics'?'Relic':r.category==='Parallels'?'Parallel':r.category==='Variations'?'Variation':'Insert',setLine:r.name,printRun:value,serial:numbered?'/'+r.serial_limit:'',subSetSize:r.subjects,
      notes:numbered?'Nominal serial limit per card, not a verified count reaching packs.':`Estimated ${r.kind==='average'?'checklist average':'copies per card'} from reconciled format odds. Model range ${lower.toFixed(3)}–${upper.toFixed(3)} per card; rounded midpoint, nearest ${r.round_to}. Conditional on reviewed serial anchors and 3% model tolerance; not a confidence interval or manufacturer-confirmed total.`,cmURL:input.sources.odds_url};
    const row=model.row(raw,input.code,i+1);
    row.id=input.code+':multiformat:'+r.id;row.category=r.category;
    row.measurement={value,kind:r.serial_is_maximum?'upper_bound':r.kind,unit:'cards',scope:'per_card',lower_bound:lower,upper_bound:r.serial_is_maximum?value:upper};
    if(r.serial_is_maximum){row.measurement.basis='nominal_serial_ceiling';row.notes=row.raw.notes='Maximum nominal serial ceiling per card; subjects can be numbered lower or omitted. Not an estimated packed count.';}
    row.calculation={method:input.method.name,odds_label:r.odds_label,odds_by_format:r.odds,subjects:r.subjects,unrounded_estimate:unrounded,round_to:r.round_to||null,source_page:r.page};
    row.source={url:input.sources.odds_url,checklist_url:input.sources.checklist_url,serial_reference_url:input.sources.serial_reference_url};
    return row;
  });
  return {schema_version:2,meta:input.meta,rows,calculation_provenance:{method:input.method,formats:input.formats,anchors:input.anchors.map(({label,subjects,serial_limit,odds,page})=>({label,subjects,serial_limit,odds,page})),sources:input.sources,withheld:input.withheld,checklist_counts:input.checklist_counts}};
}
module.exports={calculate};
