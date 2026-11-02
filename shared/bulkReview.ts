import { mapRange, replaceExact } from './review';
import type { Chunk, ReviewBulkAction, ReviewRecord } from './types';

export interface BulkReviewState { text:string; chunks:Chunk[]; records:ReviewRecord[] }
export interface BulkReviewPlan extends BulkReviewState {
  edits:{start:number;end:number;text:string}[];
}

function replacementPlan(text:string, items:Chunk[], replacement:(item:Chunk)=>string) {
  const sorted=[...items].sort((a,b)=>a.start-b.start);
  let delta=0;
  const changes:Chunk[]=[];
  for(const item of sorted){
    const value=replacement(item);
    replaceExact(text,item.start,item.end,text.slice(item.start,item.end),value);
    const start=item.start+delta;
    changes.push({...item,oldStart:item.start,oldEnd:item.end,start,end:start+value.length});
    delta+=value.length-(item.end-item.start);
  }
  let next=text;
  for(const item of [...sorted].reverse())next=replaceExact(next,item.start,item.end,
    text.slice(item.start,item.end),replacement(item));
  return {text:next,changes,edits:sorted.map(item=>({start:item.start,end:item.end,text:replacement(item)}))};
}

export function planBulkReview(state:BulkReviewState,action:ReviewBulkAction,id:()=>string):BulkReviewPlan {
  if(action==='accept'){
    const accepted=state.chunks.map(chunk=>({...chunk,id:id(),decision:'accepted' as const}));
    return {...state,chunks:[],records:[...state.records,...accepted],edits:[]};
  }
  const items=action==='reject'?state.chunks:state.records.filter(record=>record.decision==='rejected');
  for(const item of items){
    const expected=action==='reject'?item.newText:item.oldText;
    if(state.text.slice(item.start,item.end)!==expected)throw new Error('The code changed. Wait for the review to refresh.');
  }
  const replaced=replacementPlan(state.text,items,item=>action==='reject'?item.oldText:item.newText);
  if(action==='undo')return {text:replaced.text,chunks:[],records:[],edits:replaced.edits};
  const mapped=state.records.flatMap(record=>{
    const range=mapRange(record.start,record.end,replaced.changes);
    return range?[{...record,...range}]:[];
  });
  const ranges=new Map(replaced.changes.map(change=>[change.id,change]));
  const rejected=state.chunks.map(chunk=>{
    const range=ranges.get(chunk.id)!;
    return {...chunk,id:id(),start:range.start,end:range.end,
      line:replaced.text.slice(0,range.start).split('\n').length,decision:'rejected' as const};
  });
  return {text:replaced.text,chunks:[],records:[...mapped,...rejected],edits:replaced.edits};
}
