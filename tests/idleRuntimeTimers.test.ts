import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IdleRuntimeTimers } from '../electron/idleRuntimeTimers';

test('returning to a session cancels disposal and leaving again gives it three full minutes',t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const timers=new IdleRuntimeTimers();
  const expired:string[]=[];
  let selected='a';
  const update=()=>{
    for(const id of ['a','b'])timers.update(id,()=>selected!==id,()=>expired.push(id));
  };
  update();t.mock.timers.tick(179_999);
  selected='b';update();t.mock.timers.tick(100);
  selected='a';update();t.mock.timers.tick(179_999);
  assert.deepEqual(expired,[]);
  update();t.mock.timers.tick(1);
  assert.deepEqual(expired,['b']);
});

test('background work suspends the timer until the session becomes eligible again',t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const timers=new IdleRuntimeTimers();
  let idle=true,expired=0;
  const update=()=>timers.update('background',()=>idle,()=>expired++);
  update();t.mock.timers.tick(120_000);
  idle=false;update();t.mock.timers.tick(180_000);
  idle=true;update();t.mock.timers.tick(179_999);
  assert.equal(expired,0);
  t.mock.timers.tick(1);
  assert.equal(expired,1);
});
