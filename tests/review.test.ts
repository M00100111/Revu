import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diff } from '../server/git';
import { invalidateFileReview, reconcile, replaceExact, mapRange } from '../shared/review';
import { chunkKind } from '../shared/review';
import { planBulkReview } from '../shared/bulkReview';
import type { ReviewRecord } from '../shared/types';
import { changedRanges, inlineDiff } from '../shared/inlineDiff';

test('inline diff preserves text and marks changed characters and complete added lines',()=>{
  const before='class TTLCache {\n  keep();\n';
  const after='class LRUCache {\n  keep();\n  added();\n';
  const result=inlineDiff(before,after);
  assert.equal(result.before.map(part=>part.text).join(''),before);
  assert.equal(result.after.map(part=>part.text).join(''),after);
  assert.ok(result.before.some(part=>part.changed&&part.text.includes('T')));
  assert.ok(result.after.some(part=>part.changed&&part.text.includes('R')));
  const ranges=changedRanges(result.after);
  assert.ok(ranges.some(range=>after.slice(range.start,range.end).includes('added')));
});

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
  const record:ReviewRecord={...chunk,id:'record',decision:'accepted'};
  const current='prefix\n'+draft;
  const state=reconcile([record],await diff(base,current),await diff(draft,current),current);
  assert.equal(state.records[0].start,chunk.start+7);
  assert.equal(state.chunks.length,1);
  const overlap=draft.replace('B','changed');
  const changed=reconcile([record],await diff(base,overlap),await diff(draft,overlap),overlap);
  assert.equal(changed.records.length,0);
  assert.equal(changed.chunks.length,1);
});
test('rejected record remains without live diff and can undo through disjoint changes',async()=>{
  const base='a\nb\nc\nd\ne\nf\n',draft='a\nB\nc\nd\ne\nf\n';
  const [chunk]=await diff(base,draft);
  const record:ReviewRecord={...chunk,id:'reject',decision:'rejected',end:chunk.start+chunk.oldText.length};
  const rejected=replaceExact(draft,chunk.start,chunk.end,chunk.newText,chunk.oldText);
  const current=rejected+'tail\n';
  const state=reconcile([record],await diff(base,current),await diff(rejected,current),current);
  assert.equal(state.records.length,1);
  const r=state.records[0];
  assert.equal(replaceExact(current,r.start,r.end,r.oldText,r.newText),draft+'tail\n');
});
test('rejected delete remains visible after its text is restored to the baseline',async()=>{
  const base='one\ntwo\nthree\n',draft='one\nthree\n';
  const [chunk]=await diff(base,draft);
  assert.equal(chunk.kind,'delete');
  const restored=replaceExact(draft,chunk.start,chunk.end,chunk.newText,chunk.oldText);
  const record:ReviewRecord={...chunk,id:'rejected-delete',decision:'rejected',
    end:chunk.start+chunk.oldText.length};
  const state=reconcile([record],await diff(base,restored),await diff(restored,restored),restored);
  assert.equal(state.chunks.length,0);
  assert.deepEqual(state.records.map(item=>item.id),['rejected-delete']);
});
test('file-level review records follow existence and return to pending after later edits',async()=>{
  const deleted={id:'delete',kind:'delete' as const,oldStart:0,oldEnd:4,start:0,end:0,
    oldText:'one\n',newText:'',line:1,fileChange:'delete' as const};
  const rejectedDelete:ReviewRecord={...deleted,id:'rejected-delete',decision:'rejected'};
  const restored=reconcile([rejectedDelete],[],[],'one\n');
  assert.equal(restored.records.length,1);assert.equal(restored.chunks.length,0);
  const edited='THREE\n';
  const changed=reconcile(invalidateFileReview([rejectedDelete]),await diff('one\n',edited),
    await diff('one\n',edited),edited);
  assert.equal(changed.records.length,0);assert.equal(changed.chunks.length,1);
  const acceptedDelete:ReviewRecord={...deleted,id:'accepted-delete',decision:'accepted'};
  assert.equal(reconcile([acceptedDelete],[deleted],[],'').chunks.length,0);
  const recreated=reconcile(invalidateFileReview([acceptedDelete]),await diff('one\n',edited),
    await diff('',edited),edited);
  assert.equal(recreated.records.length,0);assert.equal(recreated.chunks.length,1);

  const added={id:'add',kind:'add' as const,oldStart:0,oldEnd:0,start:0,end:4,
    oldText:'',newText:'new\n',line:1,fileChange:'add' as const};
  const acceptedAdd:ReviewRecord={...added,id:'accepted-add',decision:'accepted'};
  assert.equal(reconcile([acceptedAdd],[added],[],'new\n').chunks.length,0);
  const revised={...added,newText:'newer\n',end:6};
  const revisedState=reconcile(invalidateFileReview([acceptedAdd]),[revised],
    await diff('new\n','newer\n'),'newer\n');
  assert.equal(revisedState.records.length,0);assert.equal(revisedState.chunks.length,1);
  const rejectedAdd:ReviewRecord={...added,id:'rejected-add',decision:'rejected',end:0};
  assert.equal(reconcile([rejectedAdd],[],[],'').records.length,1);
  const readded=reconcile(invalidateFileReview([rejectedAdd]),[revised],
    await diff('','newer\n'),'newer\n');
  assert.equal(readded.records.length,0);assert.equal(readded.chunks.length,1);
});
test('ambiguous zero length boundary is not moved or replaced',async()=>{
  const changes=await diff('x\ny\n','x\nz\ny\n');
  assert.equal(mapRange(2,2,changes),null);
  assert.throws(()=>replaceExact('wrong',0,5,'right','new'));
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
