import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace, decode } from '../server/workspace';
import { git } from '../server/git';

async function fixture(run:(root:string,w:Workspace)=>Promise<void>){
  const root=await mkdtemp(join(tmpdir(),'revu-test-'));
  const w=new Workspace();
  try{
    await git(root,['init','-q']);
    await git(root,['config','user.name','Revu Test']);await git(root,['config','user.email','test@revu.local']);
    await git(root,['config','core.autocrlf','false']);
    await writeFile(join(root,'file.txt'),'one\ntwo\nthree\n');
    await git(root,['add','.']);await git(root,['commit','-qm','base']);
    await run(root,w);
  }finally{w.dispose();await rm(root,{recursive:true,force:true});}
}
test('staged and unstaged modifications share fixed HEAD and saving leaves index intact',()=>fixture(async(root,w)=>{
  const project=await w.add(root),p=w.get(project.id);
  await writeFile(join(root,'file.txt'),'STAGED\ntwo\nthree\n');await git(root,['add','file.txt']);
  await writeFile(join(root,'file.txt'),'STAGED\ntwo\nWORKING\n');
  const indexBefore=await git(root,['show',':file.txt']);
  const status=await w.status(p);
  assert.deepEqual(status.files.map(f=>f.path),['file.txt']);
  assert.equal((await w.baseline(p,'file.txt')).text,'one\ntwo\nthree\n');
  const snapshot=await w.read(p,'file.txt');
  await w.save(p,'file.txt',snapshot.hash,'draft\n',false);
  assert.deepEqual(await git(root,['show',':file.txt']),indexBefore);
  await writeFile(join(root,'file.txt'),'external\n');
  await assert.rejects(w.save(p,'file.txt',snapshot.hash,'wrong\n',false),/changed/);
  assert.equal(await readFile(join(root,'file.txt'),'utf8'),'external\n');
}));
test('BOM and CRLF roundtrip; binary invalid UTF-8 rejected',()=>fixture(async(root,w)=>{
  const p=w.get((await w.add(root)).id);
  await writeFile(join(root,'bom.txt'),'\uFEFFa\r\nb\r\n');
  const snapshot=await w.read(p,'bom.txt');
  assert.equal(snapshot.bom,true);assert.equal(snapshot.text,'a\r\nb\r\n');
  await w.save(p,'bom.txt',snapshot.hash,'a\r\nB',snapshot.bom);
  assert.equal(await readFile(join(root,'bom.txt'),'utf8'),'\uFEFFa\r\nB');
  assert.ok(decode(Buffer.from([255])).reason);
  assert.ok(decode(Buffer.from('a\0b')).reason);
}));
test('project boundary, deduplication, deleted file and staged rename status',()=>fixture(async(root,w)=>{
  const project=await w.add(root),p=w.get(project.id);
  assert.equal((await w.add(root)).id,project.id);
  await assert.rejects(w.read(p,'../outside.txt'),/outside/);
  await assert.rejects(w.read(p,'.git/config'),/denied/);
  await rename(join(root,'file.txt'),join(root,'renamed.txt'));
  await git(root,['add','-A']);
  assert.match((await w.status(p)).files[0].reason!,/Rename/);
  assert.equal((await w.read(p,'file.txt')).exists,false);
}));
test('HEAD change does not silently replace baseline',()=>fixture(async(root,w)=>{
  const p=w.get((await w.add(root)).id),base=p.base;
  await writeFile(join(root,'file.txt'),'new\n');await git(root,['add','.']);await git(root,['commit','-qm','next']);
  const status=await w.status(p);
  assert.equal(status.changedHead,true);assert.equal(p.base,base);
  assert.equal((await w.baseline(p,'file.txt')).text,'one\ntwo\nthree\n');
}));
test('empty repository and non Git folder',async()=>{
  const root=await mkdtemp(join(tmpdir(),'revu-empty-'));const w=new Workspace();
  try{
    const first=await w.add(root);assert.equal(first.git,false);
    const other=join(root,'repo');
    await import('node:fs/promises').then(fs=>fs.mkdir(other));
    await git(other,['init','-q']);await writeFile(join(other,'new.txt'),'new');
    const p=w.get((await w.add(other)).id);
    assert.equal(p.base,null);assert.equal((await w.status(p)).files[0].status,'A');
    assert.equal((await w.baseline(p,'new.txt')).text,'');
  }finally{w.dispose();await rm(root,{recursive:true,force:true});}
});
