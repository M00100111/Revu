import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {build} from 'esbuild';
import type {PiManager} from '../electron/piManager';

// Keep lifecycle tests independent of Electron, installed shells, and user data.
const bundle=await build({entryPoints:['electron/piManager.ts'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{
  name:'runtime-fixtures',setup(build){
    build.onResolve({filter:/^(electron|\.\/piRuntime)$/},args=>({path:args.path,namespace:'fixture'}));
    build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='electron'
      ?"export const app={getPath:()=>process.cwd(),getAppPath:()=>process.cwd()};export const safeStorage={};export const shell={};"
      :"export const runtimeInfo=async()=>({ready:false,error:'Test target unavailable'});export const directoryExists=()=>true,replaceSessionCwd=()=>{},runtimeLaunch=()=>{},sessionCwd=()=>{},wslPath=()=>{};"}));
  },
}]});
const {PiManager:Manager}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text+'\n//# sourceURL=revu-pi-test.mjs').toString('base64')) as {PiManager:typeof PiManager};
function fixture(client:{start:()=>Promise<void>;stop:()=>Promise<void>;getAvailableModels?:()=>Promise<unknown[]>;getCommands?:()=>Promise<unknown[]>}){
  const manager=new Manager({resolveProject:id=>({id,root:process.cwd()}),emit:()=>{}});
  const internal=manager as unknown as {clients:Set<unknown>;createClient:()=>Promise<unknown>};
  const stop=client.stop;
  client.stop=async()=>{try{await stop();}finally{internal.clients.delete(client);}};
  internal.createClient=async()=>{internal.clients.add(client);return client;};
  return manager;
}

test('failed model discovery closes its temporary client and does not block later runtime switches',async()=>{
  let stopped=0;
  const manager=fixture({start:async()=>{throw new Error('Startup failed');},stop:async()=>{stopped++;}});
  await assert.rejects(manager.listModels('project'),/Startup failed/);
  assert.equal(stopped,1);
  await assert.rejects(manager.setRuntime({kind:'native'}),/Test target unavailable/);
});

test('runtime switching waits for command discovery to finish and close its temporary client',async()=>{
  let release!:()=>void;let started!:()=>void;let stopped=false;let switchFinished=false;
  const loading=new Promise<void>(resolve=>{release=resolve;});
  const entered=new Promise<void>(resolve=>{started=resolve;});
  const manager=fixture({start:async()=>{},stop:async()=>{stopped=true;},getCommands:async()=>{started();await loading;return [];}});
  const commands=manager.getCommands('project');await entered;
  const switching=assert.rejects(manager.setRuntime({kind:'native'}),/Test target unavailable/).then(()=>{switchFinished=true;});
  await setImmediate();assert.equal(switchFinished,false);assert.equal(stopped,false);
  release();await commands;await switching;assert.equal(stopped,true);
});
