import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {nativeBash,replaceSessionCwd,sessionCwd,runFile} from '../electron/piRuntime';

test('cwd recovery changes only the session header and preserves branch data and line endings',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'revu-cwd-'));const path=join(dir,'session.jsonl');
  try{const header={type:'session',version:3,id:'original',cwd:'D:\\Project',parentSession:'D:\\sessions\\parent.jsonl'};const body='{"type":"message","id":"a","parentId":null,"message":{"role":"user","content":"keep D:\\\\Project"}}\r\n';
    await writeFile(path,JSON.stringify(header)+'\r\n'+body);await replaceSessionCwd(path,header.cwd,'/mnt/d/Project');const result=await readFile(path,'utf8');assert.deepEqual(JSON.parse(result.split('\n')[0]),{...header,cwd:'/mnt/d/Project'});assert.equal(result.slice(result.indexOf('\n')+1),body);assert.equal(await sessionCwd(path),'/mnt/d/Project');assert.ok(result.split('\n')[0].endsWith('\r'));
    await replaceSessionCwd(path,'/mnt/d/Project',header.cwd);assert.equal(await sessionCwd(path),header.cwd);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('cwd recovery rejects a changed header without overwriting newer session data',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'revu-cwd-'));const path=join(dir,'session.jsonl');
  try{const content=JSON.stringify({type:'session',cwd:'new-directory',id:'original'});await writeFile(path,content);await assert.rejects(replaceSessionCwd(path,'old-directory','/mnt/d/Project'),/changed/);assert.equal(await readFile(path,'utf8'),content);}finally{await rm(dir,{recursive:true,force:true});}
});

test('Bash selection rejects an existing executable that is not Bash',async()=>{
  await assert.rejects(nativeBash(process.execPath),/not Bash/);
});

test('runtime probes close stdin so non-interactive checks can finish',async()=>{
  assert.equal(await runFile(process.execPath,['-e',"process.stdin.resume();process.stdin.on('end',()=>console.log('closed'))"]),'closed');
});
test('runtime probes preserve diagnostics written to stdout on failure',async()=>{
  await assert.rejects(runFile(process.execPath,['-e',"console.log('WSL diagnostic');process.exit(1)"]),/WSL diagnostic/);
});
test('runtime probes identify timeouts instead of reporting an unexplained command failure',async()=>{
  await assert.rejects(runFile(process.execPath,['-e','setInterval(()=>{},1000)'],undefined,200),/Command timed out after 0.2s/);
});
