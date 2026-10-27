(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.CMGuided=factory();})(globalThis,function(){
 'use strict';
 const sports=['baseball','basketball','football','hockey','soccer'];
 const text=v=>String(v??'').trim();
 const fold=v=>text(v).normalize('NFKC').toLowerCase().replace(/\s+/g,' ');
 function populated(e){return e.status!=='empty'&&Number(e.row_count)>0;}
 function toppsFamily(e){return ['topps','bowman',"bowman's",'bowmans'].includes(fold(e.manufacturer));}
 function catalog(data,mode){
  if(!data||data.ok===false||!Array.isArray(data.index))throw Error('Catalog unavailable');
  const rows=data.index.map(e=>({code:text(e.Code),displayName:text(e.DisplayName),sport:fold(e.sport),year:text(e.year),manufacturer:text(e.manufacturer)||'Unspecified',product:text(e.product),file:text(e.file),row_count:e.row_count,status:e.status}));
  const counts=new Map();for(const e of rows){const key=e.code+'|'+e.sport;counts.set(key,(counts.get(key)||0)+1);}
  return rows.filter(e=>e.code&&e.displayName&&sports.includes(e.sport)&&counts.get(e.code+'|'+e.sport)===1&&(mode!=='prv'||populated(e)&&toppsFamily(e))&&(mode!=='prv-all'||populated(e)));
 }
 function scoped(rows,scope){return rows.filter(e=>(!scope.sport||e.sport===fold(scope.sport))&&(!scope.year||e.year===scope.year)&&(!scope.mfr||fold(e.manufacturer)===fold(scope.mfr)));}
 function options(rows,field,scope){return [...new Set(scoped(rows,scope).map(e=>e[field]).filter(Boolean))].sort((a,b)=>field==='year'?b.localeCompare(a,undefined,{numeric:true}):a.localeCompare(b));}
 function href(mode,e){if(!e.code||!sports.includes(fold(e.sport)))throw Error('Invalid product route');return (mode==='prv'?'/vault/':'/checklists/')+'?'+new URLSearchParams({code:e.code,sport:fold(e.sport),q:e.displayName,...(mode==='cv'?{type:'product'}:{})});}
 function playerYears(data,name,sport){
  if(!data||data.ok===false||!Array.isArray(data.players))throw Error('Player years unavailable');
  const matches=data.players.filter(p=>fold(p.sport)===fold(sport)&&fold(p.player_name||p.player_key)===fold(name));
  if(matches.length!==1)return {status:matches.length?'ambiguous':'not_found',years:[]};
  const years=[...new Set((matches[0].checklist_years||[]).map(text).filter(y=>/^(?:19|20)\d{2}(?:[-–/]\d{2,4})?$/.test(y)))].sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
  return {status:'available',name:text(matches[0].player_name),years};
 }
 function recent(data,cv,prv){
  if(!data||!Array.isArray(data.items))throw Error('Recent updates unavailable');
  const result={cv:[],prv:[]},seen=new Set();
  for(const item of [...data.items].sort((a,b)=>text(b.updated_at).localeCompare(text(a.updated_at)))){
   const mode=item.vault==='CV'?'cv':item.vault==='PRV'?'prv':null;if(!mode)continue;
   const matches=(mode==='cv'?cv:prv).filter(e=>e.code===item.code&&e.sport===fold(item.sport));
   if(matches.length!==1)continue;const key=mode+'|'+item.code+'|'+fold(item.sport);if(seen.has(key))continue;seen.add(key);
   result[mode].push({...matches[0],updated_at:text(item.updated_at),href:href(mode,matches[0])});
  }
  result.cv=result.cv.slice(0,12);result.prv=result.prv.slice(0,12);return result;
 }
 return {sports,text,fold,populated,toppsFamily,catalog,scoped,options,href,playerYears,recent};
});
