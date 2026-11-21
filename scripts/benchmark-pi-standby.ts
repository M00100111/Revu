// After prepare:pi and build: .pi-runtime/node/node.exe --import tsx scripts/benchmark-pi-standby.ts [WSL distribution]
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {copyFile,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {runtimeLaunch,wslPath} from '../electron/piRuntime';
import {spawnStandby} from '../electron/piStandby';
import type {PiRuntimeConfig} from '../shared/piTypes';

const root=resolve('.pi-runtime'),dir=await mkdtemp(join(tmpdir(),'revu-standby-'));
const cli=join(root,'app','bundle','cli.js'),agentDir=join(dir,'agent'),sessions=join(dir,'sessions');
const paths={root,agentDir,processDir:join(dir,'pids')};
const {RpcClient}=await import(pathToFileURL(join(root,'app','bundle','index.js')).href);
const config:PiRuntimeConfig=process.argv[2]?{kind:'wsl',distribution:process.argv[2]}:{kind:'native'};
const map=(path:string)=>config.kind==='wsl'?wslPath(config.distribution!,path):Promise.resolve(path);
const server=join(dir,'fixture.cjs');
try{
  for(const folder of [agentDir,sessions,paths.processDir,join(dir,'A'),join(dir,'B')])await mkdir(folder,{recursive:true});
  // A local streaming provider gives both environments a reproducible first response without using credentials.
  await writeFile(server,`const http=require('node:http');const server=http.createServer((req,res)=>{
    req.resume();req.on('end',()=>{res.writeHead(200,{'content-type':'text/event-stream'});
    for(const [delta,finish_reason] of [[{role:'assistant',content:'pong'},null],[{},'stop']]){
      res.write('data: '+JSON.stringify({id:'test',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta,finish_reason}]})+'\\n\\n');
    }res.end('data: [DONE]\\n\\n');});});server.listen(0,'127.0.0.1',()=>console.log(server.address().port));process.stdin.resume();process.stdin.on('end',()=>server.close());`);
  const node=join(root,config.kind==='wsl'?'node-linux-x64':'node',config.kind==='wsl'?'node':'node.exe');
  const provider=config.kind==='wsl'?spawn('wsl.exe',['-d',config.distribution!,'--exec',await map(node),await map(server)],{windowsHide:true})
    :spawn(node,[server],{windowsHide:true});
  try{
    const [port]=await Promise.race([once(provider.stdout,'data'),once(provider,'exit').then(()=>{throw new Error('Fixture provider failed to start.');})]);
    await writeFile(join(agentDir,'models.json'),JSON.stringify({providers:{fixture:{baseUrl:'http://127.0.0.1:'+String(port).trim()+'/v1',api:'openai-completions',apiKey:'fixture',models:[{id:'fixture',name:'Fixture'}]}}}));
    for(const name of ['A','B']){
      const project=join(dir,name);await writeFile(join(project,'project-marker'),name);
      const ext=join(project,'.pi','extensions');await mkdir(ext,{recursive:true});
      await writeFile(join(ext,'fixture.ts'),`export default function(pi){pi.registerCommand('project-${name.toLowerCase()}',{description:'Project marker',handler:async()=>{}});}`);
    }
    for(const scenario of ['cold','starting','ready'] as const){
      const project=join(dir,scenario==='cold'?'A':'B'),name=scenario==='cold'?'A':'B';
      const sessionId=randomUUID(),file=join(sessions,sessionId+'.jsonl'),cwd=await map(project);
      const saved=[{type:'session',version:3,id:sessionId,cwd,timestamp:new Date().toISOString()},
        {type:'message',id:'previous',parentId:null,timestamp:new Date().toISOString(),message:{role:'user',content:[{type:'text',text:'history '+name}],timestamp:Date.now()}}];
      await writeFile(file,saved.map(item=>JSON.stringify(item)).join('\n')+'\n');
      const neutral=await runtimeLaunch(config,paths,root,root);
      const standby=scenario==='cold'?undefined:spawnStandby(neutral.command,neutral.prefix,root);
      if(scenario==='ready')await standby!.ready;
      const start=performance.now();
      const launch=await runtimeLaunch(config,paths,project,sessions);
      const [entry,history,sessionDir]=await Promise.all([launch.targetPath(cli),launch.targetPath(file),launch.targetPath(sessions)]);
      const approved=scenario!=='starting';
      const args=[approved?'--approve':'--no-approve','--session-dir',sessionDir,'--session',history,'--provider','fixture','--model','fixture'];
      const env={...launch.env,PI_SKIP_VERSION_CHECK:'1',PI_OFFLINE:'1'};
      await standby?.ready;
      const client=new RpcClient({cwd:project,cliPath:cli,args,launchCommand:launch.command,launchArgs:[...launch.prefix,entry],
        standbyProcess:standby?.child,bootstrap:JSON.stringify({cwd,env,pidFile:launch.pidFile,cli:entry,args:['--mode','rpc',...args]}),stopProcess:launch.stop});
      try{
        await client.start();assert.equal((await client.getState()).sessionId,sessionId);
        assert.match(JSON.stringify(await client.getEntries()),new RegExp('history '+name));const readable=performance.now();
        assert.equal((await client.bash('cat project-marker')).output.trim(),name);
        assert.equal((await client.getCommands()).some((cmd:{name:string})=>cmd.name==='project-'+name.toLowerCase()),approved);
        if(standby)assert.equal(client.process.pid,standby.child.pid);
        let first=0;
        const idle=client.waitForIdle(30000);
        client.onEvent((event:{type:string;assistantMessageEvent?:{type:string}})=>{
          if(!first&&event.assistantMessageEvent?.type==='text_delta')first=performance.now();
        });
        const submitted=performance.now();await client.prompt('ping');await idle;
        assert.ok(first>0,'Expected a streamed response from the local provider');
        console.log(JSON.stringify({runtime:config.kind,scenario,historyReadyMs:Math.round(readable-start),
          submitToLocalResponseMs:Math.round(first-submitted)}));
      }finally{await client.stop();}
    }
    for(const scenario of ['cold','starting','ready']){
      const profile=join(dir,'profile-'+scenario),project=join(dir,'window-'+scenario),windowAgent=join(profile,'pi-agent');
      await mkdir(project);await mkdir(windowAgent,{recursive:true});
      await copyFile(join(agentDir,'models.json'),join(windowAgent,'models.json'));
      await writeFile(join(windowAgent,'settings.json'),JSON.stringify({defaultProvider:'fixture',defaultModel:'fixture'}));
      await writeFile(join(profile,'pi-runtime.json'),JSON.stringify(config));
      await writeFile(join(profile,'open-folders.json'),JSON.stringify([project]));
      await writeFile(join(profile,'pi-session-folder.json'),JSON.stringify({sessionDir:sessions}));
      const id=randomUUID(),now=new Date().toISOString();
      await writeFile(join(sessions,id+'.jsonl'),[
        {type:'session',version:3,id,cwd:await map(project),timestamp:now},
        {type:'message',id:'message1',parentId:null,timestamp:now,message:{role:'user',content:[{type:'text',text:'window history marker'}],timestamp:Date.now()}},
      ].map(item=>JSON.stringify(item)).join('\n')+'\n');
      const electron=createRequire(import.meta.url)('electron') as string;
      const ui=spawn(electron,[resolve('scripts/benchmark-chat-window.cjs'),profile,scenario],{stdio:'inherit',windowsHide:true});
      assert.equal((await once(ui,'exit'))[0],0,'Desktop smoke test failed');
      console.log(JSON.stringify({runtime:config.kind,scenario,...JSON.parse(await readFile(join(profile,'benchmark-result.json'),'utf8'))}));
    }
  }finally{provider.stdin.end();if(provider.exitCode===null)await once(provider,'exit');}
}finally{await rm(dir,{recursive:true,force:true});}
