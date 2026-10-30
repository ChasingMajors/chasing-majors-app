(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else {const api=factory();root.CMSearchJson=api.create();root.CMSearchJson.create=api.create;}})(globalThis,function(){
 'use strict';
 const PREFIX='/data/v1/checklists/search-index/';
 const hex=b=>Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,'0')).join('');
 function create({fetchImpl=(...a)=>fetch(...a),concurrency=4,baseUrl=typeof location==='object'?location.href:'https://local.invalid/',decompress=typeof DecompressionStream==='function'?()=>new DecompressionStream('gzip'):null,cryptoImpl=globalThis.crypto,gunzip=globalThis.fflate?.gunzipSync}={}){
  if(!Number.isInteger(concurrency)||concurrency<1||concurrency>8)throw Error('Invalid search download limit');
  const maps=new Map(),pending=new Map(),queue=[];let active=0;
  function pump(){while(active<concurrency&&queue.length){const item=queue.shift();if(item.signal?.aborted){item.reject(item.signal.reason||Error('Search load cancelled'));continue;}active++;Promise.resolve().then(item.run).then(item.resolve,item.reject).finally(()=>{active--;pump();});}}
  function schedule(run,signal){let cancel;return new Promise((resolve,reject)=>{const item={run,resolve,reject,signal};queue.push(item);cancel=()=>{const i=queue.indexOf(item);if(i>=0){queue.splice(i,1);reject(signal.reason||Error('Search load cancelled'));}};signal?.addEventListener('abort',cancel,{once:true});pump();}).finally(()=>signal?.removeEventListener("abort",cancel));}
  async function bytes(response,limit,signal){
   const declared=Number(response.headers?.get('content-length')||0);if(declared>limit)throw Error('Search payload exceeds size limit');
   const reader=response.body?.getReader();if(!reader)throw Error('Search response stream unavailable');
   const parts=[];let length=0;
   try{while(true){if(signal?.aborted)throw signal.reason||Error('Search load cancelled');const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>limit)throw Error('Search payload exceeds size limit');parts.push(value);}}
   catch(e){await reader.cancel().catch(()=>{});throw e;}
   const out=new Uint8Array(length);let offset=0;for(const part of parts){out.set(part,offset);offset+=part.byteLength;}return out;
  }
  async function sha(b){if(!cryptoImpl?.subtle)throw Error('Search integrity verification unavailable');return hex(await cryptoImpl.subtle.digest('SHA-256',b));}
  async function request(url,{timeoutMs=6000,cache='no-cache',signal}={},entry){
   const controller=new AbortController(),abort=()=>controller.abort(signal.reason);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
   const timer=setTimeout(()=>controller.abort(Error('Search file timed out')),timeoutMs);
   try{
    const res=await fetchImpl(url,{method:'GET',cache,signal:controller.signal});
    if(!res.ok){const e=Error('Search file unavailable: HTTP '+res.status);e.status=res.status;throw e;}
    if(!entry)return await res.json();
    const body=await bytes(res,Math.max(entry.decoded_bytes,entry.compressed_bytes),controller.signal);
    let decoded;
    if(body[0]===0x1f&&body[1]===0x8b){
     if(await sha(body)!==entry.compressed_sha256)throw Error('Compressed search integrity mismatch');
     if(decompress){const stream=new Blob([body]).stream().pipeThrough(decompress());decoded=await bytes(new Response(stream),entry.decoded_bytes,controller.signal);}
     else if(gunzip)decoded=gunzip(body);
     else throw Error('Compressed search is unsupported in this browser; refresh or use the server search');
    }else decoded=body; // Fetch may have already decoded Content-Encoding: gzip.
    if(decoded.byteLength!==entry.decoded_bytes||await sha(decoded)!==entry.decoded_sha256)throw Error('Decoded search integrity mismatch');
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decoded));
   }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  async function delivery(url,options){
   const mapUrl=new URL('/data/search-delivery.json',url).href;
   if(!maps.has(mapUrl)){
    const p=request(mapUrl,{timeoutMs:options.timeoutMs,cache:'no-cache'}).then(j=>{
     if(j?.schema_version!==1||j.codec!=='gzip-json-v1'||!/^[a-f0-9]{40}$/.test(j.release_sha)||!j.files||typeof j.files!=='object'||Array.isArray(j.files))throw Error('Invalid search delivery manifest');
     return j;
    }).catch(e=>{if(e.status===404)return null;maps.delete(mapUrl);throw e;});maps.set(mapUrl,p);
   }
   return maps.get(mapUrl);
  }
  async function address(url,options){
   const map=await delivery(url,options),entry=map?.files[url.pathname];
   if(map&&!entry)throw Error('Search file absent from release manifest');
   if(entry){
    if(!Number.isSafeInteger(entry.decoded_bytes)||entry.decoded_bytes<0||entry.decoded_bytes>16*1024*1024||!Number.isSafeInteger(entry.compressed_bytes)||entry.compressed_bytes<0||entry.compressed_bytes>16*1024*1024||!/^[a-f0-9]{64}$/.test(entry.decoded_sha256)||!/^[a-f0-9]{64}$/.test(entry.compressed_sha256)||!/^\/data\/search-delivery\/[a-f0-9]{64}\.json\.gz$/.test(entry.url))throw Error('Invalid search delivery entry');
   }
   return {entry,target:entry?new URL(entry.url,url).href:url.href};
  }
  async function load(input,options={}){
   const url=new URL(input,baseUrl);if(!url.pathname.startsWith(PREFIX)||!url.pathname.endsWith('.json'))throw Error('Not a static search JSON path');
   if(options.signal?.aborted)throw options.signal.reason||Error('Search load cancelled');
   const {entry,target}=await address(url,options),key=target+'|'+(entry?.decoded_sha256||'legacy');
   // Shared in-flight work only; completed row arrays remain owned by consumers.
   // Requests with caller cancellation are not shared with other callers.
   if(!options.signal&&pending.has(key))return pending.get(key);
   const work=schedule(()=>request(target,options,entry),options.signal).catch(async e=>{
    // A tab may retain an old map (or the bridge's absent-map result) across
    // releases. Refresh exactly once on 404; never hide integrity/parse errors.
    if(e.status!==404)throw e;
    maps.delete(new URL('/data/search-delivery.json',url).href);
    const next=await address(url,options);
    return schedule(()=>request(next.target,options,next.entry),options.signal);
   });
   if(options.signal)return work;
   pending.set(key,work);try{return await work;}finally{pending.delete(key);}
  }
  async function read(entry,options={}){if(!entry||!/^\/data\/search-query\/[a-f0-9]{64}\.json\.gz$/.test(entry.url)||!Number.isSafeInteger(entry.decoded_bytes)||entry.decoded_bytes<0||entry.decoded_bytes>16*1024*1024||!Number.isSafeInteger(entry.compressed_bytes)||entry.compressed_bytes<0||entry.compressed_bytes>16*1024*1024||!/^[a-f0-9]{64}$/.test(entry.decoded_sha256)||!/^[a-f0-9]{64}$/.test(entry.compressed_sha256))throw Error('Invalid bounded-search shard');return schedule(()=>request(new URL(entry.url,baseUrl).href,options,entry),options.signal); }
  return {load,read};
 }
 return {create};
});
