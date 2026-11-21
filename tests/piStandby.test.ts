import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import {PiStandby} from '../electron/piStandby';

function fixture(){
  const child=Object.assign(new EventEmitter(),{stdin:new PassThrough()});
  let signal!:()=>void;
  const ready=new Promise<void>(resolve=>{signal=resolve;});
  return {child:child as unknown as ChildProcessWithoutNullStreams,ready,signal};
}

test('one caller adopts a starting standby and replenishment happens once',async()=>{
  const processes:ReturnType<typeof fixture>[]=[];
  const pool=new PiStandby(async()=>{const process=fixture();processes.push(process);return process;});
  pool.enable(true);pool.enable(true);
  const claim=pool.take();assert.equal(await pool.take(),undefined);
  assert.equal(processes.length,1);processes[0].signal();
  assert.equal(await claim,processes[0].child);assert.equal(processes.length,2);
  pool.enable(false);processes[1].signal();
  assert.equal(processes[0].child.stdin.writableEnded,false);
  assert.equal(processes[1].child.stdin.writableEnded,true);
});

test('runtime changes invalidate unfinished claims and keep the new slot',async()=>{
  const processes:ReturnType<typeof fixture>[]=[];
  const pool=new PiStandby(async()=>{const process=fixture();processes.push(process);return process;});
  pool.enable(true);const old=pool.take();pool.enable(false);pool.enable(true);
  processes[0].signal();assert.equal(await old,undefined);
  assert.equal(processes[0].child.stdin.writableEnded,true);
  processes[1].signal();assert.equal(await pool.take(),processes[1].child);
  pool.enable(false);processes[2].signal();
});

test('unexpected exit backs off and shutdown cancels replenishment',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const processes:ReturnType<typeof fixture>[]=[];
  const pool=new PiStandby(async()=>{const process=fixture();processes.push(process);return process;});
  pool.enable(true);await Promise.resolve();processes[0].signal();await Promise.resolve();
  processes[0].child.emit('exit',1);
  assert.equal(await pool.take(),undefined);
  t.mock.timers.tick(999);assert.equal(processes.length,1);
  t.mock.timers.tick(1);assert.equal(processes.length,2);
  pool.enable(false);processes[1].signal();t.mock.timers.tick(60000);
  assert.equal(processes.length,2);
});
