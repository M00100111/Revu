import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {existsSync} from 'node:fs';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {subagentView} from '../src/subagentView';

const root=resolve('.pi-runtime/app'),entry=join(root,'revu-extensions/subagent/index.ts');
const node=resolve('.pi-runtime',process.platform==='win32'?'node/node.exe':'node-linux-x64/node');
test('packaged Pi delegates to two bundled workers and emits parallel JSONL records',{skip:(!existsSync(node)||!existsSync(entry))&&'run npm run prepare:pi first'},async()=>{
  const dir=await mkdtemp(join(tmpdir(),'revu-subagent-test-'));
  const tasks=['Alpha','Bravo'].map(task=>({agent:'worker',task}));
  const server=createServer(async(request,response)=>{
    const chunks=[];for await(const chunk of request)chunks.push(chunk);
    const payload=JSON.parse(Buffer.concat(chunks).toString());
    const isParent=payload.tools?.some((tool:{function:{name:string}})=>tool.function.name==='subagent');
    const dispatched=payload.messages.some((message:{role:string})=>message.role==='tool');
    const delegate=isParent&&!dispatched;
    const alpha=payload.messages.some((message:{role:string;content:unknown})=>message.role==='user'&&JSON.stringify(message.content).includes('Alpha'));
    const readFixture=!isParent&&alpha&&!dispatched;
    const toolCall=delegate?{name:'subagent',arguments:JSON.stringify({tasks})}:readFixture?{name:'read',arguments:JSON.stringify({path:'sample.txt'})}:undefined;
    const delta=toolCall?{role:'assistant',tool_calls:[{index:0,id:'fixture-call',type:'function',function:toolCall}]}
      :{role:'assistant',content:isParent?'Collected results':alpha?'Alpha done':'Bravo done'};
    response.writeHead(200,{'content-type':'text/event-stream'});
    for(const [part,finish] of [[delta,null],[{},toolCall?'tool_calls':'stop']])response.write('data: '+JSON.stringify({
      id:'fixture',object:'chat.completion.chunk',model:'fixture',choices:[{index:0,delta:part,finish_reason:finish}]})+'\n\n');
    response.end('data: [DONE]\n\n');
  });
  try{
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address==='object');
    const agentDir=join(dir,'agent');await mkdir(agentDir);
    await writeFile(join(dir,'sample.txt'),'Child tool result');
    await writeFile(join(agentDir,'models.json'),JSON.stringify({providers:{fixture:{baseUrl:`http://127.0.0.1:${address.port}/v1`,api:'openai-completions',apiKey:'unused',models:[{id:'fixture',name:'Fixture'}]}}}));
    const run=promisify(execFile)(node,[join(root,'bundle/cli.js'),'--mode','json','-p','--no-session','--no-approve',
      '--extension',entry,'--model','fixture/fixture','Delegate both tasks'],{cwd:dir,windowsHide:true,timeout:45000,maxBuffer:4_000_000,
      env:{...process.env,PI_CODING_AGENT_DIR:agentDir,PI_OFFLINE:'1',PI_SKIP_VERSION_CHECK:'1'}});
    run.child.stdin?.end();
    const {stdout,stderr}=await run;
    const events=stdout.trim().split(/\r?\n/).map(line=>JSON.parse(line));
    const end=events.find(event=>event.type==='tool_execution_end'&&event.toolName==='subagent');
    assert.ok(end?.result?.details?.results,stderr+'\n'+JSON.stringify(end??events.at(-1)));
    assert.ok(events.some(event=>event.type==='tool_execution_update'&&event.partialResult.details.results.some((child:{exitCode:number})=>child.exitCode===-1)));
    for(const [index,child] of end.result.details.results.entries()){
      assert.equal(child.exitCode,0,child.stderr);assert.equal(child.model,'fixture/fixture');assert.match(JSON.stringify(child.messages),new RegExp(tasks[index].task+' done'));
    }
    assert.equal(end.result.details.results.length,2);
    const [alpha,bravo]=subagentView({args:{tasks},status:'done',result:end.result}).tasks;
    assert.ok(alpha.items.some(item=>item.kind==='call'&&item.result?.includes('Child tool result')));
    assert.equal(alpha.output,'Alpha done');assert.deepEqual(bravo.items,[]);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(dir,{recursive:true,force:true});}
});
