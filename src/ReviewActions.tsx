import type { Chunk, ReviewAction, ReviewRecord } from '../shared/types';
import type { OpenFile } from './editor';
export type ActionHandler=(file:OpenFile,id:string,action:ReviewAction,version:number)=>void;
export function reviewItems(file:OpenFile) {
  return [...file.chunks,...file.records].sort((a,b)=>a.start-b.start);
}
export function ReviewActions({file,item,onAction,onNavigate,navigationDisabled=false,detailsExpanded=false,onToggleDetails,onReveal}:{
  file:OpenFile;item:Chunk|ReviewRecord;onAction:ActionHandler;
  onNavigate?:(direction:-1|1)=>void;navigationDisabled?:boolean;
  detailsExpanded?:boolean;onToggleDetails?:()=>void;onReveal?:()=>void;
}){
  const record='decision' in item?item:null;
  const version=file.version;
  const disabled=!!(file.computing||file.syncing||file.saving||file.diffError||file.syncError||file.reason);
  const label=item.kind[0].toUpperCase()+item.kind.slice(1);
  const reviewedLabel=record?`${label} · ${record.decision==='accepted'?'Accepted':'Rejected'}`:label;
  return <div className={'review-actions '+(record?'reviewed':item.kind)}>
    {record&&onToggleDetails?<button className={'review-state review-record-toggle '+item.kind}
      aria-expanded={detailsExpanded} onClick={onToggleDetails}>
      {reviewedLabel}
    </button>:<span className={'review-state '+item.kind}>{reviewedLabel}</span>}
    <span className="review-line">L{item.line}</span>
    {onReveal&&<div className="review-jump-space" role="button" tabIndex={0} title="Go to code" aria-label="Go to code"
      onClick={onReveal} onKeyDown={event=>{
        if(event.key!=='Enter'&&event.key!==' ')return;
        event.preventDefault();onReveal();
      }}/>
    }
    {record
      ? <button className="action-undo" disabled={disabled} title={record.decision==='accepted'?'Undo Accept':'Undo Reject'}
          onClick={()=>onAction(file,item.id,'undo',version)}>Undo</button>
      : <><button className="action-accept" disabled={disabled} onClick={()=>onAction(file,item.id,'accept',version)}>Accept</button>
          <button className="action-reject" disabled={disabled} onClick={()=>onAction(file,item.id,'reject',version)}>Reject</button></>}
    {onNavigate&&<><button className="action-nav" disabled={navigationDisabled} onClick={()=>onNavigate(-1)}>Prev</button>
      <button className="action-nav" disabled={navigationDisabled} onClick={()=>onNavigate(1)}>Next</button></>}
  </div>;
}
