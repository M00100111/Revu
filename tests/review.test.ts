import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diff, merge } from '../server/git';
import { reconcile, replaceExact, mapRange } from '../shared/review';
import { chunkKind } from '../shared/review';
import { planBulkReview } from '../shared/bulkReview';
import type { ReviewRecord } from '../shared/types';

test('exact replacement preserves CRLF, EOF and repeated text',async()=>{
  for(const [base,draft] of [
    ['a\r\nb\r\n','a\r\nB\r\n'],
    ['a\n','a'],['','new'],['one\nrepeat\nrepeat\nend','one\nrepeat\nCHANGE\nend'],
    ['first\nmiddle\nlast','FIRST\nmiddle\nLAST'],
  ]){
    const chunks=await diff(base,draft);
    let restored=draft;
    for(const chunk of [...chunks].reverse())restored=replaceExact(restored,chunk.start,chunk.end,chunk.newText,chunk.oldText);
    assert.equal(restored,base);
    let reapplied=base;
    for(const chunk of [...chunks].reverse())reapplied=replaceExact(reapplied,chunk.oldStart,chunk.oldEnd,chunk.oldText,chunk.newText);
    assert.equal(reapplied,draft);
  }
});
test('accepted record survives disjoint insertion; overlapping edit invalidates it',async()=>{
  const base='a\nb\nc\nd\ne\nf\n';
  const draft='a\nB\nc\nd\ne\nf\n';
  const [chunk]=await diff(base,draft);
  const record:ReviewRecord={...chunk,id:'record',decision:'accepted',stale:false};
  const current='prefix\n'+draft;
  const state=reconcile([record],await diff(base,current),await diff(draft,current),current);
  assert.equal(state.records[0].stale,false);
  assert.equal(state.records[0].start,chunk.start+7);
  assert.equal(state.chunks.length,1);
  const overlap=draft.replace('B','changed');
  assert.equal(reconcile([record],await diff(base,overlap),await diff(draft,overlap),overlap).records[0].stale,true);
});
test('rejected record remains without live diff and can undo through disjoint changes',async()=>{
  const base='a\nb\nc\nd\ne\nf\n',draft='a\nB\nc\nd\ne\nf\n';
  const [chunk]=await diff(base,draft);
  const record:ReviewRecord={...chunk,id:'reject',decision:'rejected',stale:false,end:chunk.start+chunk.oldText.length};
  const rejected=replaceExact(draft,chunk.start,chunk.end,chunk.newText,chunk.oldText);
  const current=rejected+'tail\n';
  const state=reconcile([record],await diff(base,current),await diff(rejected,current),current);
  assert.equal(state.records.length,1);
  assert.equal(state.records[0].stale,false);
  const r=state.records[0];
  assert.equal(replaceExact(current,r.start,r.end,r.oldText,r.newText),draft+'tail\n');
});
test('ambiguous zero length boundary is not moved or replaced',async()=>{
  const changes=await diff('x\ny\n','x\nz\ny\n');
  assert.equal(mapRange(2,2,changes),null);
  assert.throws(()=>replaceExact('wrong',0,5,'right','new'));
});
test('three-way merge preserves disjoint drafts and reports conflicts',async()=>{
  const base='a\nb\nc\nd\ne\nf\n';
  const clean=await merge(base,'A\nb\nc\nd\ne\nf\n','a\nb\nc\nd\ne\nF\n');
  assert.equal(clean.conflict,false);assert.equal(clean.text,'A\nb\nc\nd\ne\nF\n');
  assert.equal((await merge(base,'A\nb\nc\nd\ne\nf\n','OTHER\nb\nc\nd\ne\nf\n')).conflict,true);
});
test('classifies chunks and plans project review actions without partial text edits',async()=>{
  assert.equal(chunkKind('','new'),'add');assert.equal(chunkKind('old',''),'delete');
  assert.equal(chunkKind('old','new'),'modify');
  const base='one\ntwo\nthree\nfour\n',draft='ONE\ntwo\nthree\nFOUR\n';
  const chunks=await diff(base,draft);let id=0;
  const rejected=planBulkReview({text:draft,chunks,records:[]},'reject',()=>String(++id));
  assert.equal(rejected.text,base);assert.equal(rejected.records.length,2);
  for(const record of rejected.records)assert.equal(base.slice(record.start,record.end),record.oldText);
  const restored=planBulkReview(rejected,'undo',()=>String(++id));
  assert.equal(restored.text,draft);assert.equal(restored.records.length,0);
  const accepted=planBulkReview({text:draft,chunks,records:[]},'accept',()=>String(++id));
  assert.equal(accepted.text,draft);assert.equal(accepted.chunks.length,0);
  assert.deepEqual(accepted.records.map(record=>record.decision),['accepted','accepted']);
});
