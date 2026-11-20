import test from 'node:test';
import assert from 'node:assert/strict';
import {PiExtensionUI,extensionRequest} from '../shared/piExtensionUI';
import type {PiExtensionReply} from '../shared/piTypes';

test('questions are ordered and scoped to their runtime, including custom Select answers',async()=>{
  const replies:{id:string;reply:PiExtensionReply}[]=[];
  const first=new PiExtensionUI(async(id,reply)=>{replies.push({id,reply});},()=>{});
  const second=new PiExtensionUI(async()=>{throw new Error('Wrong runtime');},()=>{});
  first.add({id:'same',title:'Choose',method:'select',options:['Fixed']});
  second.add({id:'same',title:'Other session',method:'input'});
  first.add({id:'next',title:'Confirm',method:'confirm',message:'Proceed?'});
  await first.reply('same',{value:'A custom answer'});
  assert.deepEqual(replies,[{id:'same',reply:{value:'A custom answer'}}]);
  assert.deepEqual(first.requests.map(request=>request.id),['next']);assert.equal(second.size,1);
});

test('invalid reply types do not resolve or remove a question',async()=>{
  let sent=false;const ui=new PiExtensionUI(async()=>{sent=true;},()=>{});
  ui.add({id:'confirm',title:'Confirm',method:'confirm',message:'Proceed?'});
  await assert.rejects(ui.reply('confirm',{value:'Yes'}),/Invalid/);
  assert.equal(ui.size,1);assert.equal(sent,false);
});

test('reply payloads cannot override RPC routing or command type',async()=>{
  let sent:unknown;const ui=new PiExtensionUI(async(id,reply)=>{sent={id,...reply};},()=>{});
  ui.add({id:'owned',title:'Input',method:'input'});
  await ui.reply('owned',{value:'answer',id:'another',type:'prompt'} as PiExtensionReply);
  assert.deepEqual(sent,{id:'owned',value:'answer'});
});

test('replies cannot be submitted twice and a failed write can be retried',async()=>{
  let release!:()=>void;let attempts=0;
  const wait=new Promise<void>(resolve=>{release=resolve;});
  const ui=new PiExtensionUI(async()=>{if(++attempts===1){await wait;throw new Error('Write failed');}},()=>{});
  ui.add({id:'input',title:'Input',method:'input'});
  const first=assert.rejects(ui.reply('input',{value:'first'}),/Write failed/);
  await assert.rejects(ui.reply('input',{value:'second'}),/already being submitted/);
  release();await first;assert.equal(ui.size,1);
  await ui.reply('input',{value:'retry'});assert.equal(ui.size,0);
});

test('expired and cancelled requests never submit a stale answer',async()=>{
  const replies:PiExtensionReply[]=[];const ui=new PiExtensionUI(async(_id,reply)=>{replies.push(reply);},()=>{});
  ui.add({id:'expired',title:'Input',method:'input',deadline:Date.now()-1});
  await ui.reply('expired',{value:'too late'});assert.deepEqual(replies,[{cancelled:true}]);
  ui.add({id:'aborted',title:'Input',method:'input'});ui.remove('aborted');
  await assert.rejects(ui.reply('aborted',{value:'too late'}),/already ended/);assert.equal(replies.length,1);
});

test('closing a session cancels all its pending questions and clears Question state',async()=>{
  const cancelled:string[]=[];let changes=0;const ui=new PiExtensionUI(async(id,reply)=>{assert.deepEqual(reply,{cancelled:true});cancelled.push(id);},()=>{changes++;});
  ui.add({id:'a',title:'First',method:'input'});ui.add({id:'b',title:'Second',method:'editor'});
  await ui.cancel();assert.deepEqual(cancelled,['a','b']);assert.equal(ui.size,0);assert.equal(changes,4);
});

test('only supported well-formed dialog requests enter the input area',()=>{
  assert.equal(extensionRequest({id:'bad',title:'Choose',method:'select',options:[3]}),undefined);
  assert.equal(extensionRequest({id:'custom',title:'Custom',method:'custom'}),undefined);
  assert.deepEqual(extensionRequest({id:'editor',title:'Review',method:'editor',prefill:'keep'}),{id:'editor',title:'Review',method:'editor',prefill:'keep',deadline:undefined});
});
