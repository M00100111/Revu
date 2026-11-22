import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, rename, unlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, sep } from 'node:path';
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
test('chat browses one directory at a time including parents and siblings, and retains project-wide filename search',()=>fixture(async(root,w)=>{
  await mkdir(join(root,'first','empty'),{recursive:true});
  await mkdir(join(root,'second','child'),{recursive:true});
  await writeFile(join(root,'first','empty','nested.txt'),'');
  const project=w.get((await w.add(join(root,'first'))).id);
  const local=await w.chatDirectory(project,'',false);
  assert.deepEqual(local.breadcrumbs,[{name:basename(root),query:'../'},{name:'first',query:''}]);
  assert.deepEqual(local.entries,[{path:'empty/',kind:'directory'}]);
  assert.ok((await w.chatDirectory(project,'',true)).entries.some(entry=>entry.path==='empty/nested.txt'));
  const parent=await w.chatDirectory(project,'../',false);
  assert.ok(parent.entries.some(entry=>entry.path==='second/'));
  assert.ok(parent.entries.every(entry=>!entry.path.includes('child')&&entry.path!=='.git/'));
  const sibling=await w.chatDirectory(project,'../second/',true);
  assert.equal(sibling.directory,join(root,'second').split(sep).join('/'));
  assert.deepEqual(sibling.breadcrumbs,[{name:basename(root),query:'../'},{name:'second',query:'../second/'}]);
  assert.deepEqual(sibling.entries,[{path:'child/',kind:'directory'}]);
  const missing=await w.chatDirectory(project,'../missing/',false);
  assert.ok(missing.error);
  assert.equal(missing.breadcrumbs[0].query,'../');
  await assert.rejects(w.path(project,'../second'),/outside the project/);
}));
test('staged and unstaged modifications share fixed HEAD and saving leaves index intact',()=>fixture(async(root,w)=>{
  const project=await w.add(root),p=w.get(project.id);
  await writeFile(join(root,'file.txt'),'STAGED\ntwo\nthree\n');await git(root,['add','file.txt']);
  await writeFile(join(root,'file.txt'),'STAGED\ntwo\nWORKING\n');
  const indexBefore=await git(root,['show',':file.txt']);
  const status=await w.status(p);
  assert.deepEqual(status.files.map(f=>f.path),['file.txt']);
  const baseline=await w.baseline(p,'file.txt');
  assert.equal(baseline.text,'one\ntwo\nthree\n');assert.equal(baseline.exists,true);
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
test('mixed working-tree endings are normalized only for a matching read-only code snapshot',()=>fixture(async(root,w)=>{
  const p=w.get((await w.add(root)).id);
  const path='mixed.txt',raw=Buffer.from('\uFEFFa\nb\r\nc\n'),normalized='a\nb\nc\n';
  await writeFile(join(root,path),raw);
  const editable=await w.read(p,path);
  assert.equal(editable.text,'a\nb\r\nc\n');assert.ok(editable.reason);
  assert.ok((await w.status(p)).files.find(file=>file.path===path)?.reason);
  assert.deepEqual(await w.codeSnapshot(p,path,editable.hash),{text:normalized,hash:editable.hash,exists:true,bom:true});
  const wrongHash=decode(Buffer.from('\uFEFF'+normalized)).hash;
  await assert.rejects(w.codeSnapshot(p,path,wrongHash),/Referenced version is unavailable/);
  await assert.rejects(w.save(p,path,editable.hash,normalized,true),/line endings/);
  assert.deepEqual(await readFile(join(root,path)),raw);
  await writeFile(join(root,path),'\uFEFF'+normalized);
  await assert.rejects(w.codeSnapshot(p,path,editable.hash),/Referenced version is unavailable/);
  for(const bytes of [Buffer.from('a\nb\rc\r\n'),Buffer.from('a\0b'),Buffer.from([255])]){
    await writeFile(join(root,path),bytes);
    await assert.rejects(w.codeSnapshot(p,path,decode(bytes).hash),/Referenced version is unavailable/);
  }
}));
test('mixed committed endings are readable by exact revision or matching base hash, but remain status-only in Review',()=>fixture(async(root,w)=>{
  const path='file.txt',mixed='one\ntwo\r\nthree\n';
  await writeFile(join(root,path),mixed);
  await git(root,['add',path]);await git(root,['commit','-qm','mixed endings']);
  const p=w.get((await w.add(root)).id);
  const old=await w.baseline(p,path);
  assert.ok(old.reason);assert.equal(old.text,mixed);
  const edited='one\ntwo\nthree\n';
  await writeFile(join(root,path),edited);
  assert.ok((await w.status(p)).files.find(file=>file.path===path)?.reason);
  const fromRevision=await w.codeSnapshot(p,path,old.hash,p.base!);
  assert.deepEqual(fromRevision,{text:edited,hash:old.hash,exists:true,bom:false});
  assert.deepEqual(await w.codeSnapshot(p,path,old.hash),fromRevision);
  await assert.rejects(w.codeSnapshot(p,path,decode(Buffer.from(edited)).hash,p.base!),/Referenced version is unavailable/);
  assert.equal(await readFile(join(root,path),'utf8'),edited);
}));
test('GB18030 snapshots decode exact bytes read-only and never reclassify a .pyc as text',()=>fixture(async(root,w)=>{
  const path='legacy.py',compiled='cached.PYC';
  const raw=Buffer.concat([Buffer.from([0xd6,0xd0,0xce,0xc4]),Buffer.from('\r\nsecond\n')]);
  await writeFile(join(root,path),raw);
  await writeFile(join(root,compiled),raw);
  await git(root,['add',path]);await git(root,['commit','-qm','legacy encoding']);
  const p=w.get((await w.add(root)).id);
  const regular=await w.read(p,path);
  assert.equal(regular.reason,'Invalid UTF-8 text. Status only.');
  const bytecode=await w.read(p,compiled);
  assert.equal(bytecode.reason,'Binary file. Status only.');
  await assert.rejects(w.codeSnapshot(p,compiled,bytecode.hash,undefined,'gb18030'),/Referenced version is unavailable/);
  await assert.rejects(w.codeSnapshot(p,path,regular.hash),/Referenced version is unavailable/);
  await assert.rejects(w.save(p,path,regular.hash,'normalized',false),/Invalid UTF-8/);
  const snapshot={text:'中文\nsecond\n',hash:regular.hash,exists:true,bom:false,encoding:'gb18030'};
  assert.deepEqual(await w.codeSnapshot(p,path,regular.hash,undefined,'gb18030'),snapshot);
  assert.deepEqual(await readFile(join(root,path)),raw);
  await writeFile(join(root,path),'new content\n');
  assert.deepEqual(await w.codeSnapshot(p,path,regular.hash,p.base!,'gb18030'),snapshot);
  assert.deepEqual(await w.codeSnapshot(p,path,regular.hash,undefined,'gb18030'),snapshot);
  assert.equal(await readFile(join(root,path),'utf8'),'new content\n');
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
test('deleted tracked file is reviewable and can be recreated from a missing snapshot',()=>fixture(async(root,w)=>{
  const p=w.get((await w.add(root)).id);
  await unlink(join(root,'file.txt'));
  const status=await w.status(p);
  assert.equal(status.files[0].status,'D');
  assert.equal(status.files[0].reason,undefined);
  const missing=await w.read(p,'file.txt');
  assert.equal(missing.exists,false);assert.equal(missing.hash,'missing');
  await w.save(p,'file.txt','missing','one\ntwo\nthree\n',false);
  assert.equal(await readFile(join(root,'file.txt'),'utf8'),'one\ntwo\nthree\n');
  const restored=await w.read(p,'file.txt');
  const deleted=await w.save(p,'file.txt',restored.hash,'',false,false);
  assert.equal(deleted.exists,false);
}));
test('deleted tracked file remains reviewable when all empty parent directories are removed',()=>fixture(async(root,w)=>{
  const nested=join(root,'src','storage','migrations','versions','0002.py');
  await mkdir(join(root,'src','storage','migrations','versions'),{recursive:true});
  await writeFile(nested,'migration\n');
  await git(root,['add','.']);await git(root,['commit','-qm','nested base']);
  const p=w.get((await w.add(root)).id);
  await rm(join(root,'src','storage','migrations'),{recursive:true,force:true});
  await writeFile(join(root,'added.py'),'added\n');
  await writeFile(join(root,'file.txt'),'modified\n');

  const status=await w.status(p);
  assert.deepEqual(status.files.map(file=>file.path),[
    'added.py','file.txt','src/storage/migrations/versions/0002.py',
  ]);
  const deleted=status.files.find(file=>file.path.endsWith('0002.py'))!;
  assert.equal(deleted.status,'D');assert.equal(deleted.reason,undefined);
  assert.equal((await w.read(p,deleted.path)).exists,false);

  const restored=await w.save(p,deleted.path,'missing','migration\n',false);
  assert.equal(restored.exists,true);
  assert.equal(await readFile(nested,'utf8'),'migration\n');
}));
test('adopting the latest HEAD removes committed changes and keeps remaining worktree changes',()=>fixture(async(root,w)=>{
  const p=w.get((await w.add(root)).id),base=p.base;
  await writeFile(join(root,'file.txt'),'committed\n');await git(root,['add','.']);await git(root,['commit','-qm','next']);
  const status=await w.status(p);
  assert.equal(status.changedHead,true);assert.equal(p.base,base);
  assert.equal((await w.baseline(p,'file.txt')).text,'one\ntwo\nthree\n');
  p.base=await w.head(p.repo!);
  assert.equal((await w.status(p)).changedHead,false);
  assert.equal((await w.baseline(p,'file.txt')).text,'committed\n');
  await writeFile(join(root,'file.txt'),'remaining\n');
  const remaining=await w.status(p);
  assert.equal(remaining.changedHead,false);
  assert.deepEqual(remaining.files.map(file=>file.path),['file.txt']);
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
    const baseline=await w.baseline(p,'new.txt');
    assert.equal(baseline.text,'');assert.equal(baseline.exists,false);
  }finally{w.dispose();await rm(root,{recursive:true,force:true});}
});
