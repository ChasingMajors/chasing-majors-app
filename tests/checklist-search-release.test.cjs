const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildSearchRows}=require('../scripts/apply-reviewed-checklists.cjs');

test('reviewed refresh preserves publisher search schema and complete metadata',()=>{
 const meta={code:'spx',displayName:'2025-26 Upper Deck SPx Hockey',keywords:'Hologram rookie',year:'2025-26',sport:'hockey',manufacturer:'Upper Deck',product:'SPx'};
 const row={code:'spx',sport:'hockey',section:'Base',subset:'Base',card_no:'1',player:'Teuvo Teravainen',team:'Chicago Blackhawks',tag:''};
 const original=JSON.stringify(row),[product,card]=buildSearchRows({meta,rows:[row]});
 const common={sport:'hockey',code:'spx',displayName:meta.displayName,year:'2025-26',manufacturer:'Upper Deck',product:'SPx'};
 assert.deepEqual(product,{term:meta.displayName,type:'product',...common,section:'',subset:'',card_no:'',player:'',team:'',tag:'',search_blob:meta.displayName+' Hologram rookie 2025-26 hockey Upper Deck SPx spx'});
 assert.deepEqual(card,{term:'Teuvo Teravainen',type:'card',...common,section:'Base',subset:'Base',card_no:'1',player:'Teuvo Teravainen',team:'Chicago Blackhawks',tag:'',search_blob:meta.displayName+' Hologram rookie 2025-26 hockey Upper Deck SPx Base Base 1 Teuvo Teravainen Chicago Blackhawks spx'});
 assert.equal(JSON.stringify(row),original);
});

test('blank player search falls back to product and preserves card tags',()=>{
 const [_,card]=buildSearchRows({meta:{code:'x',displayName:'Example',sport:'hockey'},rows:[{code:'x',section:'Insert',subset:'Buyback',card_no:'DL',player:'',team:'',tag:'/1'}]});
 assert.equal(card.term,'Example');assert.equal(card.sport,'hockey');assert.equal(card.tag,'/1');assert.equal(card.search_blob,'Example hockey Insert Buyback DL /1 x');
});
