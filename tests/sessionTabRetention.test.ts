import assert from 'node:assert/strict';
import {test} from 'node:test';
import {SessionTabRetention} from '../src/sessionTabRetention';
import {IdleRuntimeTimers} from '../electron/idleRuntimeTimers';

test('three recent projects have a reserved tab and the other three slots follow tab recency',()=>{
  const policy=new SessionTabRetention();
  const tabs=new Map<string,string[]>();
  function visit(project:string,id:string){
    const ids=tabs.get(project)??[];
    if(!ids.includes(id))tabs.set(project,[...ids,id]);
    return policy.update(tabs,project,id);
  }
  visit('A','a');visit('B','b');visit('C','c');visit('D','d');
  for(const id of ['d2','d3','d4'])visit('D',id);
  assert.deepEqual(visit('D','d5'),['d5','c','b','d4','d3','d2']);
  assert.deepEqual(visit('A','a'),['a','d5','c','d4','d3','d2']);
  assert.deepEqual(policy.update(tabs,'B',null),['a','d5','c','d4','d3','d2']);
  tabs.delete('D');
  assert.deepEqual(policy.update(tabs,'B',null),['a','c','b']);
});

test('closing a protected tab releases its slot and reopening cancels its grace timer',t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const policy=new SessionTabRetention(),timers=new IdleRuntimeTimers();
  const ids=['one','two','three','four','five'];
  let open=[...ids];
  const expired:string[]=[];
  function select(id:string|null){
    const kept=policy.update(new Map([['project',open]]),'project',id);
    for(const key of ids)timers.update(key,()=>!kept.includes(key),()=>expired.push(key));
    return kept;
  }
  for(const id of ids)select(id);
  open=open.filter(id=>id!=='five');
  assert.deepEqual(select(null),['four','three','two','one']);
  t.mock.timers.tick(179_999);
  open.push('five');select('five');
  t.mock.timers.tick(1);
  assert.deepEqual(expired,[]);
  t.mock.timers.tick(179_999);
  assert.deepEqual(expired,['one']);
  open=open.filter(id=>id!=='five');select(null);
  t.mock.timers.tick(180_000);
  assert.deepEqual(expired,['one','five']);
});
