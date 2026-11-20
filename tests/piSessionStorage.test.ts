import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { copyPiSessions, nativePiSessionDir, piSessionHostPath } from '../electron/piSessionStorage';
import { piSessionProjectKey } from '../shared/piSession';

test('Windows and WSL drive paths share a project key without merging unrelated projects',()=>{
  const native=piSessionProjectKey('D:\\CodeProject\\Test1');
  assert.equal(piSessionProjectKey(piSessionHostPath('/mnt/d/CodeProject/Test1/','win32')),native);
  assert.equal(piSessionProjectKey(piSessionHostPath('/mnt/d','win32')),piSessionProjectKey('d:/'));
  assert.notEqual(piSessionProjectKey(piSessionHostPath('/mnt/c/CodeProject/Test1','win32')),native);
  assert.notEqual(piSessionProjectKey(piSessionHostPath('/home/user/Test1','win32')),native);
  assert.equal(piSessionHostPath('/mnt/d/CodeProject/Test1','linux'),'/mnt/d/CodeProject/Test1');
});

test('native session directory uses Pi cwd encoding',()=>{
  const path=nativePiSessionDir('D:\\CodeProject\\Revu','C:\\Users\\RaY');
  assert.equal(path,join('C:\\Users\\RaY','.pi','agent','sessions','--D--CodeProject-Revu--'));
});

test('explicit session copy preserves sources, existing targets, and parent links',async()=>{
  const root=await mkdtemp(join(tmpdir(),'revu-pi-sessions-'));const source=join(root,'old','--project--');const target=join(root,'shared');
  const parent=join(source,'parent.jsonl');const child=join(source,'child.jsonl');const targetParent=join(target,'parent.jsonl');
  await mkdir(source,{recursive:true});await mkdir(target,{recursive:true});
  await writeFile(parent,'{"type":"session","id":"parent"}\n','utf8');
  await writeFile(child,`${JSON.stringify({type:'session',id:'child',parentSession:parent})}\n{"type":"message"}\n`,'utf8');
  await writeFile(targetParent,'existing','utf8');
  assert.deepEqual(await copyPiSessions([{path:parent},{path:child,parentSessionPath:parent}],target),{copied:1,skipped:1});
  assert.equal(await readFile(targetParent,'utf8'),'existing');
  assert.match(await readFile(parent,'utf8'),/"parent"/);
  const copiedChild=(await readFile(join(target,'child.jsonl'),'utf8')).split(/\r?\n/)[0];
  assert.equal(JSON.parse(copiedChild).parentSession,targetParent);
});
