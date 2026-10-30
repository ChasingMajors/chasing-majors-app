'use strict';
// Preserve the already accepted legacy gzip framing on every build platform.
// OS byte is informational. Payload, CRC and decoded JSON are never altered.
const zlib=require('node:zlib'),fs=require('node:fs');
function canonicalGzip(bytes){
 if(bytes[0]!==31||bytes[1]!==139||bytes[2]!==8||bytes[3]!==0||bytes.readUInt32LE(4)!==0)throw Error('Unexpected gzip frame; pinned recovery runtime required');
 bytes[9]=19;return bytes;
}
const gzip=zlib.gzipSync;zlib.gzipSync=function(...args){return canonicalGzip(gzip.apply(this,args));};
const readdir=fs.readdirSync;fs.readdirSync=function(...args){const entries=readdir.apply(this,args);return entries.sort((a,b)=>{const x=typeof a==='string'?a:Buffer.isBuffer(a)?a.toString():a.name,y=typeof b==='string'?b:Buffer.isBuffer(b)?b.toString():b.name;return x<y?-1:x>y?1:0;});};
module.exports={canonicalGzip};
