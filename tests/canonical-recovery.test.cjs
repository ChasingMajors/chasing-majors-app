const {test}=require('node:test'),assert=require('node:assert/strict'),cp=require('node:child_process'),path=require('node:path');
const runtime=path.resolve('.github/recovery/canonical-runtime.cjs');
test('simulated Linux and native gzip frames normalize to identical accepted bytes without altering payload',()=>{
 const code=`const z=require('zlib'),assert=require('assert/strict'),native=z.gzipSync,raw=Buffer.from('real deterministic gzip framing check'),expected=native(raw,{level:6});expected[9]=19;z.gzipSync=(...args)=>{const b=native(...args);b[9]=3;return b;};require(${JSON.stringify(runtime)});const b=z.gzipSync(raw,{level:6});assert(b.equals(expected));assert(z.gunzipSync(b).equals(raw));assert.equal(b.readUInt32LE(4),0);`;
 cp.execFileSync(process.execPath,['-e',code]);
});
test('unsorted directory enumeration is explicitly normalized for strings and Dirents',()=>{
 const code=`const fs=require('fs'),assert=require('assert/strict');fs.readdirSync=()=>['z','a','m'];require(${JSON.stringify(runtime)});assert.deepEqual(fs.readdirSync('unused'),['a','m','z']);`;
 cp.execFileSync(process.execPath,['-e',code]);
});
