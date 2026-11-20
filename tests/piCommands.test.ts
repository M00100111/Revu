import test from 'node:test';
import assert from 'node:assert/strict';
import { activePiBranch,mergePiCommands,parsePiCommand,piCommandAt,piQueueWarning } from '../shared/piCommands';
import type { PiSessionEntry,PiSlashCommand } from '../shared/piTypes';

const commands:PiSlashCommand[]=[
  {name:'extension',source:'extension'},
  {name:'template',source:'prompt'},
  {name:'skill:review',source:'skill'},
];
test('commands require the beginning of input and preserve multiline arguments after a space',()=>{
  assert.deepEqual(parsePiCommand('/skill:review inspect\nthis change'),{name:'skill:review',args:'inspect\nthis change'});
  assert.deepEqual(parsePiCommand('/extension'),{name:'extension',args:''});
  for(const text of [' /extension','message /extension','/extension\nmessage','/extension\tmessage'])assert.equal(parsePiCommand(text),null);
  assert.equal(piCommandAt('path/to/file',5),null);
  assert.equal(piCommandAt('text /model',11),null);
  assert.deepEqual(piCommandAt('/model arguments',3),{query:'mo',end:6});
});
test('only prompt templates, skills and ordinary messages can enter queues',()=>{
  for(const text of ['/extension argument',' /extension argument ','/model','/quit','!echo hello','!!echo hello'])assert.ok(piQueueWarning(text,commands));
  for(const text of ['/template argument','/skill:review argument','message /extension','ordinary'])assert.equal(piQueueWarning(text,commands),undefined);
  assert.equal(piQueueWarning('/template',commands),undefined);
  assert.ok(piQueueWarning('/template',[{name:'template',source:'extension'}]));
});
test('built-in dispatch takes precedence and command names remain unique',()=>{
  const merged=mergePiCommands([{name:'model',source:'extension'},...commands,{name:'template',source:'skill'}]);
  assert.equal(merged.filter(item=>item.source==='builtin').length,24);
  assert.equal(merged.find(item=>item.name==='model')?.source,'builtin');
  assert.equal(merged.filter(item=>item.name==='template').length,1);
});
test('Fork follows the active leaf ancestry and excludes sibling branches and later entries',()=>{
  const entry=(id:string,parentId:string|null):PiSessionEntry=>({id,parentId,type:'message',timestamp:'2026-11-19'});
  const entries=[entry('root',null),entry('old','root'),entry('other','root'),entry('leaf','old'),entry('later','other')];
  assert.deepEqual(activePiBranch(entries,'leaf').map(item=>item.id),['root','old','leaf']);
  assert.deepEqual(activePiBranch(entries,null),[]);
  assert.deepEqual(activePiBranch([entry('a','b'),entry('b','a')],'a').map(item=>item.id),['b','a']);
});
