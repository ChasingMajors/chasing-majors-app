// Local-only adapter for the exact Worker handler and Durable Object class.
import http from 'node:http';
import {Readable} from 'node:stream';
import {createHandler,ReportStore} from './core.mjs';
export class MemoryStorage{
 constructor(){this.data=new Map();this.alarmAt=null;this.tail=Promise.resolve();}
 async get(k){return structuredClone(this.data.get(k));}
 async put(k,v){this.data.set(k,structuredClone(v));}
 async delete(k){return this.data.delete(k);}
 async list({prefix='',limit=Infinity}={}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)).slice(0,limit).map(([k,v])=>[k,structuredClone(v)]));}
 async getAlarm(){return this.alarmAt;}
 async setAlarm(at){this.alarmAt=at;}
 async transaction(fn){const run=this.tail.then(async()=>{const snapshot=structuredClone(this.data);try{return await fn(this);}catch(e){this.data=snapshot;throw e;}});this.tail=run.catch(()=>{});return run;}
}
function rate(limit,clock){const counters=new Map();return {counters,async limit({key}){const minute=Math.floor(clock()/60000);for(const [k,v]of counters)if(v.minute!==minute)counters.delete(k);const old=counters.get(key)||{minute,count:0};old.count++;counters.set(key,old);return {success:old.count<=limit};}};}
export function localEnvironment({clock=Date.now,clientLimit=30,globalLimit=120}={}){
 const storage=new MemoryStorage(),store=new ReportStore({storage});
 return {storage,env:{SUMMARY_TOKEN:'local-only-summary-token-for-tests',RATE_SALT:'local-only-rate-salt-for-tests',CLIENT_RATE:rate(clientLimit,clock),GLOBAL_RATE:rate(globalLimit,clock),REPORTS:{idFromName:name=>name,get:()=>({fetch:input=>store.fetch(input instanceof Request?input:new Request(input))})}}};
}
export async function startLocal({port=0,clock=Date.now,...options}={}){
 const local=localEnvironment({clock,...options}),handler=createHandler({clock});
 const server=http.createServer(async(req,res)=>{try{const init={method:req.method,headers:req.headers};if(!['GET','HEAD'].includes(req.method)){init.body=Readable.toWeb(req);init.duplex='half';}const result=await handler.fetch(new Request('http://127.0.0.1'+req.url,init),local.env);res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));}catch{res.writeHead(500);res.end('Local adapter error');}});
 await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
 return {url:'http://127.0.0.1:'+server.address().port,server,...local};
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){const local=await startLocal({port:Number(process.env.PORT||8789)});console.log('Local-only collector '+local.url+' (never deployed)');}
