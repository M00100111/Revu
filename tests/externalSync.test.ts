import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Chunk, ReviewRecord, Snapshot } from '../shared/types';
import { externalSyncKind, resetForExternalSnapshot } from '../src/externalSync';

const snapshot=(hash:string,text='disk'):Snapshot=>({hash,text,exists:true,bom:false});
const chunk:Chunk={id:'chunk',kind:'modify',oldStart:0,oldEnd:3,start:0,end:5,
  oldText:'old',newText:'draft',line:1};
const record:ReviewRecord={...chunk,id:'record',decision:'rejected',stale:false};

test('external sync preserves state only when the disk hash is unchanged',()=>{
  assert.equal(externalSyncKind('same',snapshot('same')),'unchanged');
  assert.equal(externalSyncKind('old',snapshot('new')),'replace');
  const missing:Snapshot={text:'',hash:'missing',exists:false,bom:false};
  assert.equal(externalSyncKind('old',missing),'remove');
  assert.equal(externalSyncKind('missing',missing),'unchanged');
});

test('external replacement discards drafts and review decisions',()=>{
  const external=snapshot('new','latest disk text');
  const state={synced:snapshot('old','old disk text'),draftExists:true,dirty:true,version:7,reviewText:'draft',
    chunks:[chunk],records:[record],computing:true,syncError:'previous error',notice:''};
  resetForExternalSnapshot(state,external);
  assert.equal(state.synced,external);
  assert.equal(state.draftExists,true);
  assert.equal(state.dirty,false);
  assert.equal(state.version,8);
  assert.equal(state.reviewText,external.text);
  assert.deepEqual(state.chunks,[]);
  assert.deepEqual(state.records,[]);
  assert.equal(state.computing,false);
  assert.equal(state.syncError,'');
});
