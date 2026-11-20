import type { Chunk, ReviewAction, ReviewRecord } from '../shared/types';
import type { OpenFile } from './editor';
import type {PinPlacement} from '../shared/pinLayout';
export type ActionHandler=(file:OpenFile,id:string,action:ReviewAction,version:number)=>void;
export type PinActionHandler=(pin:PinPlacement,action:'keep'|'hide'|'close')=>void;
export function reviewItems(file:Pick<OpenFile,'chunks'|'records'>) {
  return [...file.chunks,...file.records].sort((a,b)=>a.start-b.start);
}
export function PinActions({pin,kept,onAction,onSource,onReveal}:{
  pin:PinPlacement;kept:boolean;onAction:PinActionHandler;onSource:(pin:PinPlacement)=>void;onReveal:()=>void;
}){
  return <div className="review-actions pin">
    <span className="review-state">Pin</span>
    <span className="review-line">L{pin.startLine}{pin.endLine!==pin.startLine?`–${pin.endLine}`:''}</span>
    <button type="button" className="review-jump-space" title="Go to code" aria-label="Go to code" onClick={onReveal}/>
    {!kept&&<button type="button" onClick={()=>onAction(pin,'keep')}>Keep</button>}
    <button type="button" onClick={()=>onSource(pin)}>Source</button>
    <button type="button" onClick={()=>onAction(pin,kept?'close':'hide')}>{kept?'Close':'Hide'}</button>
  </div>;
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
