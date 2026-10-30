'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function load(root,extra={}){
 const ctx={window:{CMChat:{}},console:{warn(){}},AbortController,setTimeout,clearTimeout,...extra};vm.createContext(ctx);
 for(const f of ['config.js','utils.js','cache.js'])vm.runInContext(fs.readFileSync(path.join(root,'ChatBot',f),'utf8'),ctx);
 let api=fs.readFileSync(path.join(root,'ChatBot/api.js'),'utf8');api=api.replace('  ns.submitErrorReport =','  ns.__legacy={normalizeSearchRows,playerNameFromRow,rowSearchMatchesPlayer,makePlayerCardsResponse};\n  ns.submitErrorReport =');vm.runInContext(api,ctx);
 const cv=fs.readFileSync(path.join(root,'checklists/app.js'),'utf8'),c={STATIC_DATA_BASE:'/data/v1',STATIC_FETCH_TIMEOUT_MS:6000,STATIC_SPORTS:['baseball','basketball','football','hockey','soccer'],STATIC_CACHE:{},BROAD_PAGE_SIZE:50,AbortController,setTimeout,clearTimeout,...extra};vm.createContext(c);
 const seg=(a,b)=>cv.slice(cv.indexOf(a),cv.indexOf(b));
 vm.runInContext(seg('function norm(s)','function fmtType('),c);
 vm.runInContext(seg('function sortByDisplayPriority(','function getThemeVars('),c);
 vm.runInContext(seg('function toCardNoSortValue(','function normalizeSectionName('),c);
 vm.runInContext(seg('function normalizeQuery_(','function inferSearchKind_('),c);
 vm.runInContext(seg('async function fetchJsonWithTimeout_(','async function fetchFreshJsonWithTimeout_('),c);
 vm.runInContext(seg('async function loadStaticJsonCached_(','function normalizeIndexRows_('),c);
 vm.runInContext(seg('function normalizeSearchRows_(','// ---------------- LIVE SEARCH ENDPOINT'),c);
 vm.runInContext(seg('async function searchStaticCards_(','function normalizeStaticPlayer_('),c);
 return {chat:ctx.window.CMChat.api,chatUtils:ctx.window.CMChat.utils,chatContext:ctx,cv:c};
}
module.exports={load};
