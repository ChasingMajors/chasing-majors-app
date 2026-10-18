const {test}=require('node:test'),assert=require('node:assert/strict');
const model=require('../shared/vault-model.js');
const {review}=require('../scripts/review-prv-integrity.cjs');
const rule={code:'mls',before:'2026 Topps Chrome MLS',after:'2026 Topps Chrome MLS Soccer',source_url:'https://example.test/review',basis:'Reviewed exact identity'};
const record=(rows=[])=>({entry:{Code:'mls',DisplayName:rule.before,sport:'soccer',Keywords:'old search'},product:model.product({meta:{code:'mls',displayName:rule.before,sport:'soccer'},rows},'mls')});
test('display review preserves card measures, identifiers, evidence and old-name search',()=>{
 const r=record([{setType:'Base',setLine:'Gold',printRun:50,serial:'/50',subSetSize:200}]);const before=review([structuredClone(r)],{products:[]}).records[0].product.rows;
 const result=review([r],{products:[],product_name_reviews:[rule]});
 assert.equal(result.records[0].entry.DisplayName,rule.after);assert.equal(r.product.meta.displayName,rule.after);
 assert.ok(r.entry.Keywords.includes(rule.before));assert.deepEqual(r.product.rows,before);
 assert.equal(r.product.display_name_review.source_name,rule.before);
});
test('empty source stays empty and newer source names invalidate display corrections',()=>{
 const r=record();const result=review([r],{products:[],product_name_reviews:[rule]});assert.equal(result.records[0].product.rows.length,0);
 const changed=record();changed.product.meta.displayName='New source identity';
 const blocked=review([changed],{products:[],product_name_reviews:[rule]});assert.equal(blocked.report.stale_reviews.length,1);assert.equal(changed.entry.DisplayName,rule.before);assert.equal(changed.product.meta.displayName,'New source identity');
});
