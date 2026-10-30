const {test}=require('node:test'),assert=require('node:assert/strict');
const {productionVerificationUrl}=require('../scripts/production-verification-url.cjs');
test('HTTP deployment metadata becomes HTTPS on the same approved host and path',()=>{
 assert.equal(productionVerificationUrl('http://app.chasingmajors.com/'),'https://app.chasingmajors.com/');
 assert.equal(productionVerificationUrl('http://app.chasingmajors.com/checklists/?release=abc'),'https://app.chasingmajors.com/checklists/?release=abc');
 assert.equal(productionVerificationUrl('https://app.chasingmajors.com/'),'https://app.chasingmajors.com/');
});
test('unexpected origins, credentials and protocols remain blocking errors',()=>{
 for(const input of ['https://app.chasingmajors.com.evil.test/','https://other.test/','ftp://app.chasingmajors.com/','https://name:secret@app.chasingmajors.com/','https://app.chasingmajors.com:8443/','garbage'])assert.throws(()=>productionVerificationUrl(input));
});
test('the content verifier still refuses HTTP instead of weakening the security guard',async()=>{
 const {verifyLive}=require('../scripts/content-release.cjs');
 await assert.rejects(verifyLive('http://app.chasingmajors.com/',{}, {fetchImpl:()=>{throw Error('Must reject before fetch');}}),/HTTPS release verification required/);
});
