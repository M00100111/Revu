import Icon from './Icon';
import MarkdownContent from './MarkdownContent';
import { summaryReason, summaryStatus, type SummaryOperation } from '../shared/piSummary';

const tokens=(value:number)=>value>=1_000_000?`${Number((value/1_000_000).toFixed(1))}m`:value>=1000?`${Number((value/1000).toFixed(1))}k`:String(value);
const continuationText={pending:'Retrying original prompt',running:'Resuming original prompt…',completed:'Original prompt resumed',cancelled:'Original prompt cancelled',failed:'Original prompt did not complete'};
export function summaryDescription(operation:SummaryOperation){
  const parts:string[]=[];
  if(operation.status==='waiting'||operation.status==='retrying')parts.push(operation.retry?.error??'Generating summary…');
  else if(operation.status==='failed')parts.push(operation.error??'The summary could not be generated.');
  else if(operation.status==='cancelled')parts.push('No summary created.');
  else if(operation.status==='skipped')parts.push('No branch history required summarization.');
  else if(operation.status==='finalizing')parts.push('Waiting for the final summary result…');
  else if(operation.status==='running')parts.push('Generating summary…');
  else{
    if(operation.tokensBefore!==undefined)parts.push(`${tokens(operation.tokensBefore)}${operation.estimatedTokensAfter!==undefined?` → ~${tokens(operation.estimatedTokensAfter)}`:''}`);
    if(operation.cost!==undefined)parts.push(`$${operation.cost.toFixed(4)}`);
    if(!parts.length)parts.push('Summary created.');
  }
  if(operation.startedAt!==undefined&&operation.endedAt!==undefined)parts.push(`${(Math.max(0,operation.endedAt-operation.startedAt)/1000).toFixed(1)}s`);
  return parts.join(' · ');
}

export default function SummaryCard({operation,now=Date.now(),onOpenJson,onToggle,defaultOpen=false}:{
  operation:SummaryOperation;now?:number;onOpenJson:(operation:SummaryOperation)=>void;onToggle?:()=>void;defaultOpen?:boolean;
}){
  const title=operation.kind==='compaction'?'Compaction':'Branch Summary';const reason=summaryReason(operation.reason);
  const error=operation.status==='failed'?operation.error??'The summary could not be generated.':undefined;
  const retryError=operation.retry?.error;
  const hasSummary=!!operation.summary?.trim();
  const hasFields=!!(error||retryError||operation.continuation);
  return <details className={`agent-summary-card ${operation.kind} ${operation.status}`} open={defaultOpen||undefined} onToggle={onToggle}>
    <summary><span className="agent-summary-first"><strong>{title}{reason&&<span> · {reason}</span>}</strong><span className="agent-summary-status" role="status">{summaryStatus(operation,now)}</span></span>
      <span className="agent-summary-second"><span title={summaryDescription(operation)}>{summaryDescription(operation)}</span><Icon name="down" size={12}/></span></summary>
    <div className="agent-summary-details"><div className={`agent-summary-detail-heading${!hasFields&&hasSummary?' summary-only':''}`}>{(hasFields||!hasSummary)&&<strong>Details</strong>}<button type="button" className="agent-icon-button" title="Open summary JSON" aria-label="Open summary JSON" onClick={()=>onOpenJson(operation)}><Icon name="json" size={21}/></button></div>
      {hasFields&&<dl>{error&&<div><dt>Error</dt><dd className="agent-summary-error">{error}</dd></div>}
        {retryError&&retryError!==error&&<div><dt>Last retry error</dt><dd>{retryError}</dd></div>}
        {operation.continuation&&<div><dt>Continuation</dt><dd>{continuationText[operation.continuation]}</dd></div>}
      </dl>}{hasSummary&&<section className="agent-summary-text"><MarkdownContent text={operation.summary!}/></section>}
      {!hasSummary&&!hasFields&&<p className="agent-summary-empty">No additional details yet.</p>}
    </div>
  </details>;
}
