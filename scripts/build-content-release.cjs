const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),stamp=process.env.CM_RELEASE_BUILD_TIME;
if(!stamp||!Number.isFinite(Date.parse(stamp)))throw Error('Pinned commit build time required');
// Normalize authoring order BEFORE deriving registry/review/recent metadata.
// Otherwise a clean build consumes export order, but its retry consumes the
// sorted indexes written at the end of the previous build.
for(const name of ['data/v1/checklists/index.json','data/v1/vault/index.json']){
 const file=path.join(root,name),j=JSON.parse(fs.readFileSync(file,'utf8'));
 j.index.sort((a,b)=>String(a.Code).localeCompare(String(b.Code),'en'));
 fs.writeFileSync(file,JSON.stringify(j)+'\n');
}
const report=require('./apply-reviewed-checklists.cjs').apply(root,{stamp,sortIndex:true});
cp.execFileSync(process.execPath,[path.join(__dirname,'build-vault-data.cjs')],{stdio:'inherit',env:{...process.env,CM_RELEASE_BUILD_TIME:stamp}});
// Complete canonical registry + existing reviewed outputs. Never promote
// orphan payloads or fuzzy-match names. Preserve identities and data fields.
for(const name of ['data/v1/checklists/index.json','data/v1/vault/index.json','data/v2/vault/index.json']){
 const file=path.join(root,name),j=JSON.parse(fs.readFileSync(file,'utf8'));
 j.index.sort((a,b)=>String(a.Code).localeCompare(String(b.Code),'en'));
 fs.writeFileSync(file,JSON.stringify(j)+'\n');
}
require('./stamp-publish-release.cjs').stampRelease(root,process.env.GITHUB_SHA);
console.log(JSON.stringify({reviewed_changes:report.changed_files.length,release_sha:process.env.GITHUB_SHA,build_time:stamp}));
