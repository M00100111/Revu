import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Chunk, ReviewRecord, Snapshot } from '../shared/types';
import { diff } from '../server/git';
import { externalSyncKind, rebaseExternalReview, resetForExternalSnapshot } from '../src/externalSync';

const snapshot=(hash:string,text='disk'):Snapshot=>({hash,text,exists:true,bom:false});
const chunk:Chunk={id:'chunk',kind:'modify',oldStart:0,oldEnd:3,start:0,end:5,
  oldText:'old',newText:'draft',line:1};
const record:ReviewRecord={...chunk,id:'record',decision:'rejected'};

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

test('external changes keep disjoint decisions and reset overlapping decisions',async()=>{
  const base='one\nold\nkeep-1\nkeep-2\nlast\n';
  const reviewed='one\nnew\nkeep-1\nkeep-2\nlast\n';
  const [reviewedChunk]=await diff(base,reviewed);
  const accepted:ReviewRecord={...reviewedChunk,id:'accepted',decision:'accepted'};
  const rejected:ReviewRecord={...reviewedChunk,id:'rejected',decision:'rejected',
    end:reviewedChunk.start+reviewedChunk.oldText.length};
  const external='one\nnew\nkeep-1\nkeep-2\nLAST\n';
  const externalChunks=await diff(base,external);

  const keptAccepted=rebaseExternalReview([accepted],externalChunks,external);
  assert.equal(keptAccepted.text,external);
  assert.deepEqual(keptAccepted.records.map(item=>item.id),['accepted']);

  const keptRejected=rebaseExternalReview([rejected],externalChunks,external);
  assert.equal(keptRejected.text,'one\nold\nkeep-1\nkeep-2\nLAST\n');
  assert.deepEqual(keptRejected.records.map(item=>item.id),['rejected']);

  const overlapping='one\nexternal\nkeep-1\nkeep-2\nlast\n';
  const reset=rebaseExternalReview([accepted,rejected],await diff(base,overlapping),overlapping);
  assert.equal(reset.text,overlapping);
  assert.deepEqual(reset.records,[]);
});

test('external changes always reset whole-file add and delete decisions',()=>{
  const fileAdd:ReviewRecord={id:'file-add',kind:'add',oldStart:0,oldEnd:0,start:0,end:4,
    oldText:'',newText:'new\n',line:1,fileChange:'add',decision:'accepted'};
  const fileDelete:ReviewRecord={id:'file-delete',kind:'delete',oldStart:0,oldEnd:4,start:0,end:0,
    oldText:'old\n',newText:'',line:1,fileChange:'delete',decision:'accepted'};
  const state=rebaseExternalReview([fileAdd,fileDelete],[],'external\n');
  assert.equal(state.text,'external\n');
  assert.deepEqual(state.records,[]);
});
