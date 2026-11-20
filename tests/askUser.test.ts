import test from 'node:test';
import assert from 'node:assert/strict';
import askUser from '../pi-extensions/ask-user';
import type {ExtensionAPI,ExtensionToolContext} from '@earendil-works/pi-coding-agent';

type Reply={value:string}|{confirmed:boolean}|{cancelled:true};
interface Request {method:string;title:string;options?:string[];prefill?:string;placeholder?:string}
interface Options {signal:AbortSignal;timeout?:number}
interface Result {details:{answers:{id:string;value:string|boolean;label:string;wasCustom:boolean}[];cancelled:boolean;reason?:string};content:{text:string}[]}
interface Tool {execute:(id:string,params:unknown,signal:AbortSignal|undefined,onUpdate:undefined,ctx:ExtensionToolContext)=>Promise<Result>}
function fixture(reply:(request:Request,options:Options,index:number)=>Promise<Reply>){
  let tool!:Tool;const requests:Request[]=[];
  askUser({registerTool:(definition:unknown)=>{tool=definition as Tool;}} as unknown as ExtensionAPI);
  const ctx={hasUI:true,ui:{revuAskUser:(request:Request,options:Options)=>{const index=requests.push(request)-1;return reply(request,options,index);}}} as unknown as ExtensionToolContext;
  return {requests,execute:(params:unknown,signal?:AbortSignal)=>tool.execute('call',params,signal,undefined,ctx)};
}

test('a single question maps displayed options back to stable values and preserves custom answers',async()=>{
  const select=fixture(async request=>({value:request.options![0]}));
  const result=await select.execute({questions:[{id:'scope',prompt:'Choose scope',options:[{label:'Current file',value:'file',description:'Only this file'}]}]});
  assert.equal(select.requests[0].title,'Choose scope');assert.equal(result.details.cancelled,false);
  assert.deepEqual(result.details.answers,[{id:'scope',type:'select',value:'file',label:'Current file',wasCustom:false}]);
  const custom=fixture(async()=>({value:'My own scope'}));
  const answer=await custom.execute({questions:[{id:'scope',prompt:'Choose scope',options:[{label:'Current file'}]}]});
  assert.equal(answer.details.answers[0].value,'My own scope');assert.equal(answer.details.answers[0].wasCustom,true);
});

test('one invocation queues all four question types and returns answers in question order',async()=>{
  const replies:Reply[]=[{value:'First'},{confirmed:false},{value:'One line'},{value:'Line 1\nLine 2'}];
  const batch=fixture(async(_request,_options,index)=>replies[index]);
  const result=await batch.execute({questions:[{id:'select',prompt:'Choose',options:[{label:'First'}]},{id:'confirm',prompt:'Continue?',type:'confirm'},{id:'input',prompt:'Name',placeholder:'Your name'},{id:'editor',prompt:'Review',type:'editor',prefill:'Initial text'}]});
  assert.deepEqual(batch.requests.map(request=>request.method),['select','confirm','input','editor']);
  assert.match(batch.requests[0].title,/^1\/4/);assert.equal(batch.requests[3].prefill,'Initial text');
  assert.deepEqual(result.details.answers.map(answer=>[answer.id,answer.value]),[['select','First'],['confirm',false],['input','One line'],['editor','Line 1\nLine 2']]);
  assert.equal(result.details.cancelled,false);
});

test('cancelling confirmation differs from No and cancels remaining questions while retaining completed answers',async()=>{
  let remainingCancelled=false;
  const batch=fixture(async(_request,{signal},index)=>{
    if(index===0)return {value:'Completed'};if(index===1)return {cancelled:true};
    return new Promise(resolve=>signal.addEventListener('abort',()=>{remainingCancelled=true;resolve({cancelled:true});},{once:true}));
  });
  const result=await batch.execute({questions:[{id:'first',prompt:'First'},{id:'confirm',prompt:'Confirm',type:'confirm'},{id:'last',prompt:'Last'}]});
  assert.equal(result.details.cancelled,true);assert.equal(result.details.reason,'cancelled');assert.equal(result.details.answers.length,1);
  assert.equal(result.details.answers[0].value,'Completed');assert.equal(remainingCancelled,true);
});

test('tool abort cancels every queued question including the multi-line editor',async()=>{
  const controller=new AbortController();let cancelled=0;
  const batch=fixture(async(_request,{signal})=>new Promise(resolve=>signal.addEventListener('abort',()=>{cancelled++;resolve({cancelled:true});},{once:true})));
  const running=batch.execute({questions:[{id:'a',prompt:'First',type:'editor'},{id:'b',prompt:'Second'}]},controller.signal);
  assert.equal(batch.requests.length,2);controller.abort();const result=await running;
  assert.equal(result.details.reason,'aborted');assert.equal(cancelled,2);
});

test('questionnaire timeout returns cancellation instead of treating confirmation as No',async()=>{
  const batch=fixture(async()=>new Promise(resolve=>setTimeout(()=>resolve({cancelled:true}),20)));
  const result=await batch.execute({timeout:5,questions:[{id:'confirm',prompt:'Continue?',type:'confirm'}]});
  assert.equal(result.details.reason,'timeout');assert.equal(result.details.answers.length,0);
});

test('the complete questionnaire is validated before showing any UI',async()=>{
  const batch=fixture(async()=>({value:'unused'}));
  await assert.rejects(batch.execute({questions:[{id:'same',prompt:'First'},{id:'same',prompt:'Second'}]}),/unique/);
  await assert.rejects(batch.execute({questions:[{id:'first',prompt:'First'},{id:'last',prompt:'Choose',type:'select'}]}),/requires options/);
  assert.equal(batch.requests.length,0);
});
