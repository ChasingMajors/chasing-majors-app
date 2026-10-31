'use strict';
const cp=require('node:child_process');
const sha=/^[a-f0-9]{40}$/;
function ensureReleaseHistory({cwd=process.cwd(),env=process.env}={}){
 const git=(args,extra={})=>cp.execFileSync('git',args,{cwd,env:{...env,...extra},encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const head=env.GITHUB_SHA,before=env.CM_BEFORE_SHA||'';
 if(!sha.test(head||'')||git(['rev-parse','HEAD'])!==head)throw Error('Release checkout is not pinned to GITHUB_SHA');
 if(!before||/^0{40}$/.test(before))return {head,before:null,mode:'no-before'};
 if(!sha.test(before))throw Error('Invalid before SHA; refusing incomplete product-code derivation');
 const present=()=>{try{git(['cat-file','-e',before+'^{commit}']);return true;}catch{return false;}};
 let mode='already-present';
 if(!present()){
  const remote=git(['remote','get-url','origin']),auth={};
  // Persist-credentials stays false. Pass this one fetch's credential through
  // environment-only Git configuration, never argv, logs, URL or repository config.
  if(env.GH_TOKEN){
   if(!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(remote))throw Error('Unexpected authenticated history origin');
   const n=Number(env.GIT_CONFIG_COUNT||0);if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid Git configuration count');
   auth.GIT_CONFIG_COUNT=String(n+1);auth['GIT_CONFIG_KEY_'+n]='http.https://github.com/.extraheader';
   auth['GIT_CONFIG_VALUE_'+n]='AUTHORIZATION: basic '+Buffer.from('x-access-token:'+env.GH_TOKEN).toString('base64');
  }
  const fetch=args=>{try{git(['fetch','--no-tags',...args,'origin',...(args.includes('--depth=1')?[before]:[env.GITHUB_REF||head])],auth);return true;}catch{return false;}};
  fetch(['--depth=1']);mode='exact-before-fetch';
  if(!present())for(const depth of [64,256]){fetch(['--deepen='+depth]);mode='deepened-'+depth;if(present())break;}
  if(!present()){
   const shallow=git(['rev-parse','--is-shallow-repository'])==='true';
   fetch(shallow?['--unshallow']:[]);mode='full-history-fallback';
  }
  if(!present())throw Error('Before commit unavailable after history fallback; refusing incomplete product-code derivation');
 }
 // Comparing exact endpoint trees does not require every intervening commit.
 // Force Git to prove the diff can be read BEFORE expected-code derivation.
 git(['diff','--name-only',before,head]);
 return {head,before,mode};
}
module.exports={ensureReleaseHistory};
if(require.main===module){try{console.log(JSON.stringify(ensureReleaseHistory()));}catch(error){console.error(error.message);process.exitCode=1;}}
