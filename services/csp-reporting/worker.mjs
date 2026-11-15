import {DurableObject} from 'cloudflare:workers';
import {createHandler,ReportStore as StoreCore} from './core.mjs';
export default createHandler();
export class ReportStore extends DurableObject{
 constructor(state,env){super(state,env);this.core=new StoreCore(state);}
 fetch(request){return this.core.fetch(request);}
 alarm(){return this.core.alarm();}
}
