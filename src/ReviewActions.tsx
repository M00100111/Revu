import type { Chunk, ReviewAction, ReviewRecord } from '../shared/types';
import type { OpenFile } from './editor';
export type ActionHandler=(file:OpenFile,id:string,action:ReviewAction,version:number)=>void;
export function reviewItems(file:OpenFile) {
  return [...file.chunks,...file.records].sort((a,b)=>a.start-b.start);
}
export function ReviewActions({file,item,onAction}:{file:OpenFile;item:Chunk|ReviewRecord;onAction:ActionHandler}){
  const record='decision' in item?item:null;
  const version=file.version;
  const disabled=!!(file.computing||file.syncing||file.saving||file.conflict||file.diffError||file.syncError||file.reason||record?.stale);
  return <div className="review-actions">
    <span className={'review-state '+(record?.stale?'stale':record?.decision??'pending')}>
      {record?.stale?'Stale':record?.decision==='accepted'?'Accepted':record?.decision==='rejected'?'Rejected':'Pending'}
    </span>
    <span className="review-line">L{item.line}</span>
    {record
      ? <button disabled={disabled} title={record.decision==='accepted'?'Undo Accept':'Undo Reject'}
          onClick={()=>onAction(file,item.id,'undo',version)}>Undo</button>
      : <><button disabled={disabled} onClick={()=>onAction(file,item.id,'accept',version)}>Accept</button>
          <button disabled={disabled} onClick={()=>onAction(file,item.id,'reject',version)}>Reject</button></>}
  </div>;
}
