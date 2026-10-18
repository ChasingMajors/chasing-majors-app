const {test}=require('node:test'),assert=require('node:assert/strict');
const model=require('../shared/vault-model.js');
const {review}=require('../scripts/review-prv-integrity.cjs');
const fixture=require('./fixtures/prv-integrity-reviewed-source.json');

// Build live records exactly like tests/prv-integrity.test.cjs does.
function sources(){
 return fixture.records.map(({entry,raw})=>({entry:structuredClone(entry),product:model.product(structuredClone(raw),entry.Code)}));
}
// Deep clone the catalog so each test can corrupt one rule without touching the others.
function catalog(){return structuredClone(fixture.catalog);}
function rule(cat,code){return cat.products.find(p=>p.code===code);}
// Capture a product's pre-review source rows (by raw/measurement/serial) for comparison.
function snapshot(records,code){
 const rec=records.find(r=>r.entry.Code===code);
 return rec.product.rows.map(r=>({id:r.id,raw:structuredClone(r.raw),measurement:structuredClone(r.measurement),serial_limit:r.serial_limit,checklist_size:r.checklist_size,set_name:r.set_name}));
}
// A product's record as it appears in the published output.
function published(result,code){return result.records.find(r=>r.entry.Code===code);}
// Assert the failed product was published with its original, un-corrected source rows.
function assertOriginalPreserved(result,code,before){
 const out=published(result,code);
 assert.ok(out,`failed product ${code} must still be published`);
 assert.equal(out.product.rows.length,before.length,'row count must be unchanged');
 const byId=new Map(out.product.rows.map(r=>[r.id,r]));
 for(const old of before){
  const row=byId.get(old.id);
  assert.ok(row,`source row ${old.id} must survive`);
  assert.deepEqual(row.raw,old.raw);
  assert.deepEqual(row.measurement,old.measurement);
  assert.equal(row.serial_limit,old.serial_limit);
  assert.equal(row.set_name,old.set_name);
  assert.ok(!row.identity_review,'no correction should have been written to a failed product');
 }
}
// Shared assertions for a single-product failure with one healthy control product.
const CONTROL='2025_26_bowman_basketball';
function assertFailureIsolated(result,failedCode){
 const failed=result.report.failed.find(f=>f.code===failedCode);
 assert.ok(failed,`${failedCode} must be recorded in report.failed`);
 assert.equal(failed.kind,'review_failed');
 assert.ok(typeof failed.reason==='string'&&failed.reason.length>0,'failure must carry a non-empty reason');
 // The healthy control product still got corrections applied and still publishes.
 assert.ok(result.report.applied.some(a=>a.code===CONTROL),'healthy product corrections must still apply');
 assert.ok(published(result,CONTROL),'healthy product must still publish');
 // The failed product is NOT also in stale_reviews (distinct paths).
 assert.ok(!result.report.stale_reviews.some(s=>s.code===failedCode),'a review failure is not a stale review');
}

test('invalid reviewed row position is recorded as a failure, not thrown',()=>{
 const cat=catalog();
 const target='2025_26_topps_three_basketball';
 rule(cat,target).actions[0].position=999999; // beyond source-row count
 const records=sources();
 const before=snapshot(records,target);
 let result;
 assert.doesNotThrow(()=>{result=review(records,cat);});
 assertFailureIsolated(result,target);
 assert.match(result.report.failed.find(f=>f.code===target).reason,/Invalid reviewed row position/);
 assertOriginalPreserved(result,target,before);
});

test('invalid pending identity row is recorded as a failure, not thrown',()=>{
 const cat=catalog();
 const target='2025_26_topps_signature_class_basketball';
 rule(cat,target).pending_identity_reviews=[{candidate_positions:[999999],reason:'forced out-of-range pending'}];
 const records=sources();
 const before=snapshot(records,target);
 let result;
 assert.doesNotThrow(()=>{result=review(records,cat);});
 assertFailureIsolated(result,target);
 assert.match(result.report.failed.find(f=>f.code===target).reason,/Invalid pending identity row/);
 assertOriginalPreserved(result,target,before);
});

test('illegal set key is recorded as a failure, not thrown',()=>{
 const cat=catalog();
 const target='2025_26_topps_chrome_update_sapphire_basketball';
 // Add an illegal key to an action that actually carries a `set` (quarantine actions
 // short-circuit before the set loop, so they would never reach the throw).
 const setAction=rule(cat,target).actions.find(a=>a.set);
 setAction.set={...setAction.set,serial_limit:1}; // serial_limit not in set_name|section|category
 const records=sources();
 const before=snapshot(records,target);
 let result;
 assert.doesNotThrow(()=>{result=review(records,cat);});
 assertFailureIsolated(result,target);
 assert.match(result.report.failed.find(f=>f.code===target).reason,/cannot change counts or raw evidence/);
 assertOriginalPreserved(result,target,before);
});

test('split target collision is recorded as a failure, not thrown',()=>{
 const cat=catalog();
 const target='clean_up_analysis_2025_26_topps_nbl_australian_basketball_league_2025_26_finest_uefa_club_competitions_soccer';
 // Point a split part at an already-present input product code.
 rule(cat,target).split[0].entry.Code=CONTROL;
 const records=sources();
 const before=snapshot(records,target);
 let result;
 assert.doesNotThrow(()=>{result=review(records,cat);});
 assertFailureIsolated(result,target);
 assert.match(result.report.failed.find(f=>f.code===target).reason,/Split target already exists/);
 assertOriginalPreserved(result,target,before);
 // The collided-with control product is not duplicated in output.
 assert.equal(result.records.filter(r=>r.entry.Code===CONTROL).length,1);
});

test('partial split that loses source rows is recorded as a failure without losing or duplicating rows',()=>{
 const cat=catalog();
 const target='clean_up_analysis_2025_26_topps_nbl_australian_basketball_league_2025_26_finest_uefa_club_competitions_soccer';
 rule(cat,target).split[1].positions.pop(); // drop one position so routed.size !== rows.length
 const records=sources();
 const before=snapshot(records,target);
 let result;
 assert.doesNotThrow(()=>{result=review(records,cat);});
 assertFailureIsolated(result,target);
 assert.match(result.report.failed.find(f=>f.code===target).reason,/Split would lose source rows/);
 // Original product preserved with all rows, and no split children leaked into output.
 assertOriginalPreserved(result,target,before);
 for(const childCode of ['2025_26_topps_nbl_basketball','2025_26_topps_finest_uefa_club_competitions_soccer']){
  assert.ok(!result.records.some(r=>r.entry.Code===childCode),`failed split must not publish child ${childCode}`);
 }
 // No duplicated source rows anywhere in the published output.
 const ids=result.records.flatMap(r=>r.product.rows.map(row=>row.source_row_id||row.id));
 assert.equal(new Set(ids).size,ids.length,'no duplicate source rows after a failed split');
});

test('multiple corrupted products still let every healthy product publish',()=>{
 const cat=catalog();
 rule(cat,'2025_26_topps_three_basketball').actions[0].position=999999;
 const sigSet=rule(cat,'2025_26_topps_signature_class_basketball').actions.find(a=>a.set);
 sigSet.set={...sigSet.set,serial_limit:1};
 const records=sources();
 // Expected total published-or-accounted-for source rows across all input products.
 const inputRows=records.reduce((n,r)=>n+r.product.rows.length,0);
 let result;
 assert.doesNotThrow(()=>{result=review(records,cat);});
 assert.equal(result.report.failed.length,2);
 assert.ok(result.report.failed.every(f=>f.kind==='review_failed'&&f.reason));
 // Healthy products still publish with corrections applied.
 assert.ok(result.report.applied.some(a=>a.code===CONTROL));
 assert.ok(published(result,CONTROL));
 // Row conservation: every published row + every quarantined row accounts for all input
 // rows (failed products are published whole, so nothing is lost).
 const publishedRows=result.records.reduce((n,r)=>n+r.product.rows.length,0);
 assert.equal(publishedRows+result.report.quarantined.length,inputRows);
});

test('a null reviewed field VALUE is recorded as a failure, not thrown (line ~109 .length-on-null path)',()=>{
 const cat=catalog();
 const target='2025_26_topps_chrome_update_sapphire_basketball';
 // A reviewed set_name of null passes the field-NAME allowlist but would, before the
 // value guard, be written onto the row and later blow up at `r.set_name.length` in the
 // post-review quality/unresolved loop — which sits OUTSIDE the per-product try/catch.
 const setAction=rule(cat,target).actions.find(a=>a.set);
 setAction.set={...setAction.set,set_name:null};
 const records=sources();
 const before=snapshot(records,target);
 let result;
 assert.doesNotThrow(()=>{result=review(records,cat);});
 assertFailureIsolated(result,target);
 assert.match(result.report.failed.find(f=>f.code===target).reason,/must be a string/);
 assertOriginalPreserved(result,target,before);
 // Every published product still has a string set_name (no null leaked to the length check).
 for(const rec of result.records){
  for(const row of rec.product.rows)assert.equal(typeof row.set_name,'string',`set_name must stay a string for ${row.id}`);
 }
});

test('a non-string (numeric) reviewed field VALUE is also isolated per-product',()=>{
 const cat=catalog();
 const target='2025_26_topps_chrome_update_sapphire_basketball';
 const setAction=rule(cat,target).actions.find(a=>a.set);
 setAction.set={...setAction.set,section:42};
 const records=sources();
 const before=snapshot(records,target);
 let result;
 assert.doesNotThrow(()=>{result=review(records,cat);});
 assertFailureIsolated(result,target);
 assert.match(result.report.failed.find(f=>f.code===target).reason,/must be a string/);
 assertOriginalPreserved(result,target,before);
});

test('the fingerprint stale_review path is unchanged by hardening',()=>{
 const cat=catalog();
 const records=sources();
 const target=records.find(r=>r.entry.Code===cat.products[0].code);
 target.product.rows[0].raw.notes=(target.product.rows[0].raw.notes||'')+' changed';
 let result;
 assert.doesNotThrow(()=>{result=review(records,cat);});
 // Lands in stale_reviews, NOT failed, and no correction is applied.
 assert.ok(result.report.stale_reviews.some(s=>s.code===target.entry.Code),'changed source must be stale');
 assert.ok(!result.report.failed.some(f=>f.code===target.entry.Code),'stale is not a failure');
 assert.ok(!result.report.applied.some(a=>a.code===target.entry.Code),'no correction on stale source');
});
