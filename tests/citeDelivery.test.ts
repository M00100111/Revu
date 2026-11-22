import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {createServer,type ServerResponse} from 'node:http';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import test from 'node:test';
import {packInput,unpackInput} from '../shared/citations';

const bundle=resolve('.pi-runtime/app/bundle');
test('bundled Pi delivers, persists and reopens only the consumed editor selections',{skip:!existsSync(join(bundle,'index.js')),timeout:45000},async()=>{
  const pinned=resolve('.pi-runtime/node/node.exe');if(process.platform==='win32'&&existsSync(pinned)&&resolve(process.execPath).toLowerCase()!==pinned.toLowerCase()){
    const env={...process.env};delete env.NODE_TEST_CONTEXT;await promisify(execFile)(pinned,['--import','tsx','--test',fileURLToPath(import.meta.url)],{env,windowsHide:true,timeout:40000});return;
  }
  const {RpcClient}=await import(pathToFileURL(join(bundle,'index.js')).href);
  const dir=await mkdtemp(join(tmpdir(),'revu-cite-')),agentDir=join(dir,'agent');await mkdir(agentDir);
  const requests:string[]=[];let releaseFirst=()=>{};let firstArrived=()=>{};const first=new Promise<void>(resolve=>{firstArrived=resolve;});
  const finish=(response:ServerResponse)=>{response.writeHead(200,{'content-type':'text/event-stream'});for(const [delta,finish_reason] of [[{role:'assistant',content:'ok'},null],[{},'stop']])response.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta,finish_reason}]})+'\n\n');response.end('data: [DONE]\n\n');};
  const server=createServer((request,response)=>{let body='';request.on('data',data=>{body+=data;});request.on('end',()=>{requests.push(body);if(requests.length===1){releaseFirst=()=>finish(response);firstArrived();}else finish(response);});});server.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address();assert.ok(address&&typeof address==='object');
  const text='Review @"price.ts"#L2';const makeWire=(code:string)=>packInput(text,[{path:'price.ts',offset:7,text:code,language:'typescript',startLine:2,startColumn:3,endLine:2,endColumn:6}]);
  await writeFile(join(agentDir,'models.json'),JSON.stringify({providers:{fixture:{baseUrl:`http://127.0.0.1:${address.port}/v1`,api:'openai-completions',apiKey:'fixture',models:[{id:'fixture',name:'Fixture'}]}}}));
  const client=new RpcClient({cwd:dir,cliPath:join(bundle,'cli.js'),launchCommand:process.execPath,args:['--no-approve','--session-dir',dir,'--provider','fixture','--model','fixture'],env:{PI_CODING_AGENT_DIR:agentDir,PI_SKIP_VERSION_CHECK:'1',PI_OFFLINE:'1'}});
  const initial=makeWire('first_snapshot'),withdrawn=makeWire('removed_snapshot'),retained=makeWire('retained_snapshot'),followUp=makeWire('follow_up_snapshot');
  try{await client.start();await client.revuInput('prompt',unpackInput(initial),initial);await first;
    await client.revuInput('steer',unpackInput(withdrawn),withdrawn);await client.revuInput('steer',unpackInput(retained),retained);
    assert.equal(await client.withdrawInput('steering',0,retained),false);assert.equal(await client.withdrawInput('steering',0,withdrawn),true);assert.equal(await client.withdrawInput('steering',0,withdrawn),false);
    await client.revuInput('follow_up',unpackInput(followUp),followUp);
    const settled=client.waitForIdle(18000);releaseFirst();await settled;
    const check=async()=>{const {entries}=await client.getEntries();const cites=entries.filter((entry:{customType?:string})=>entry.customType==='cite');assert.deepEqual(cites.map((entry:{content:{text:string}[]})=>entry.content[1].text),['first_snapshot','retained_snapshot','follow_up_snapshot']);
      for(const entry of cites){const user=entries[entries.indexOf(entry)-1];assert.equal(user.message.role,'user');assert.equal(user.message.content[0].text,text);assert.equal(user.id,entry.parentId);assert.equal(user.id,entry.details.userEntryId);assert.equal(user.message.revuDeliveryId,entry.details.deliveryId);assert.equal(entry.display,false);}
    };await check();assert.match(requests[0],/first_snapshot/);assert.doesNotMatch(requests[0],/retained_snapshot/);assert.match(requests.at(-1)!,/retained_snapshot/);assert.match(requests.at(-1)!,/follow_up_snapshot/);assert.doesNotMatch(requests.join('\n'),/removed_snapshot|RevuInput/);
    const state=await client.getState();await client.switchSession(state.sessionFile);await check();
  }finally{releaseFirst=()=>{};await client.stop();server.closeAllConnections();server.close();await rm(dir,{recursive:true,force:true});}
});
