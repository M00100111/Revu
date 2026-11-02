import type { Chunk, ReviewRecord, Snapshot } from '../shared/types';
import { mapRange, replaceExact } from '../shared/review';

export type ExternalSyncKind = 'unchanged' | 'replace' | 'remove';

export function externalSyncKind(currentHash: string, external: Snapshot): ExternalSyncKind {
  if (!external.exists) return currentHash === 'missing' ? 'unchanged' : 'remove';
  return external.hash === currentHash ? 'unchanged' : 'replace';
}

export interface ExternalReviewState {
  synced: Snapshot;
  draftExists: boolean;
  dirty: boolean;
  version: number;
  reviewText: string;
  chunks: Chunk[];
  records: ReviewRecord[];
  computing: boolean;
  syncError?: string;
  notice: string;
}

export interface ExternalReviewDraft { text:string; records:ReviewRecord[] }

function sameChunk(record:ReviewRecord,chunk:Chunk) {
  return !record.fileChange&&record.kind===chunk.kind&&record.oldStart===chunk.oldStart&&
    record.oldEnd===chunk.oldEnd&&record.oldText===chunk.oldText&&record.newText===chunk.newText;
}

export function rebaseExternalReview(records:ReviewRecord[],chunks:Chunk[],text:string):ExternalReviewDraft {
  const used=new Set<number>();
  const matches=records.flatMap(record=>{
    if(record.fileChange)return [];
    const candidates=chunks.map((chunk,index)=>({chunk,index}))
      .filter(item=>!used.has(item.index)&&sameChunk(record,item.chunk));
    if(candidates.length!==1)return [];
    used.add(candidates[0].index);
    return [{record,chunk:candidates[0].chunk}];
  });
  const rejected=matches.filter(item=>item.record.decision==='rejected')
    .sort((a,b)=>a.chunk.start-b.chunk.start);
  let delta=0;
  const changes:Chunk[]=[];
  const rejectedRanges=new Map<string,{start:number;end:number}>();
  for(const {record,chunk} of rejected){
    const start=chunk.start+delta,end=start+record.oldText.length;
    rejectedRanges.set(record.id,{start,end});
    changes.push({...chunk,oldStart:chunk.start,oldEnd:chunk.end,start,end});
    delta+=record.oldText.length-record.newText.length;
  }
  let draft=text;
  for(const {record,chunk} of [...rejected].reverse()){
    draft=replaceExact(draft,chunk.start,chunk.end,record.newText,record.oldText);
  }
  const kept=new Map<string,ReviewRecord>();
  for(const {record,chunk} of matches){
    const range=record.decision==='rejected'?rejectedRanges.get(record.id):mapRange(chunk.start,chunk.end,changes);
    const expected=record.decision==='accepted'?record.newText:record.oldText;
    if(!range||draft.slice(range.start,range.end)!==expected)continue;
    kept.set(record.id,{...record,...range,line:draft.slice(0,range.start).split('\n').length});
  }
  return {text:draft,records:records.flatMap(record=>kept.has(record.id)?[kept.get(record.id)!]:[])};
}

export function resetForExternalSnapshot(state: ExternalReviewState, external: Snapshot,
  review:ExternalReviewDraft={text:external.text,records:[]}) {
  state.synced = external;
  state.draftExists = external.exists;
  state.dirty = review.text !== external.text;
  state.version++;
  state.reviewText = review.text;
  state.chunks = [];
  state.records = review.records;
  state.computing = false;
  state.syncError = '';
  state.notice = review.records.length
    ? 'External changes loaded. Unchanged review decisions were kept.'
    : 'External changes loaded. Review state was updated.';
}
