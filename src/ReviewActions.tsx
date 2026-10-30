import type { Chunk, ReviewAction, ReviewRecord } from '../shared/types';
import type { OpenFile } from './editor';
export type ActionHandler=(file:OpenFile,id:string,action:ReviewAction,version:number)=>void;
export function reviewItems(file:OpenFile) {
  return [...file.chunks,...file.records].sort((a,b)=>a.start-b.start);
}
export function ReviewActions({file,item,onAction,onNavigate,navigationDisabled=false}:{
  file:OpenFile;item:Chunk|ReviewRecord;onAction:ActionHandler;
  onNavigate?:(direction:-1|1)=>void;navigationDisabled?:boolean;
}){
  const record='decision' in item?item:null;
  const version=file.version;
  const disabled=!!(file.computing||file.syncing||file.saving||file.conflict||file.diffError||file.syncError||file.reason||record?.stale);
  const label=item.kind[0].toUpperCase()+item.kind.slice(1);
  return <div className={'review-actions '+(record?'reviewed':item.kind)}>
    <span className={'review-state '+(record?.stale?'stale':item.kind)}>
      {record?.stale?'Stale':label}
    </span>
    <span className="review-line">L{item.line}</span>
    {record
      ? <button className="action-undo" disabled={disabled} title={record.decision==='accepted'?'Undo Accept':'Undo Reject'}
          onClick={()=>onAction(file,item.id,'undo',version)}>Undo</button>
      : <><button className="action-accept" disabled={disabled} onClick={()=>onAction(file,item.id,'accept',version)}>Accept</button>
          <button className="action-reject" disabled={disabled} onClick={()=>onAction(file,item.id,'reject',version)}>Reject</button></>}
    {onNavigate&&<><button className="action-nav" disabled={navigationDisabled} onClick={()=>onNavigate(-1)}>Prev</button>
      <button className="action-nav" disabled={navigationDisabled} onClick={()=>onNavigate(1)}>Next</button></>}
  </div>;
}
