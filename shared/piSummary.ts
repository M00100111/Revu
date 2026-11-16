export type SummaryKind='compaction'|'branchSummary';
export type SummaryStatus='running'|'waiting'|'retrying'|'finalizing'|'completed'|'failed'|'cancelled'|'skipped';
export interface SummaryOperation {
  id:string;kind:SummaryKind;runKey:string;status:SummaryStatus;reason?:string;
  startedAt?:number;endedAt?:number;summary?:string;tokensBefore?:number;estimatedTokensAfter?:number;cost?:number;
  entryId?:string;error?:string;retry?:{attempt:number;maxAttempts:number;deadline:number;error:string};
  continuation?:'pending'|'running'|'completed'|'cancelled'|'failed';events:unknown[];
}
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'?value as Record<string,unknown>:{};
const number=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value:undefined;
const text=(value:unknown)=>typeof value==='string'?value:undefined;
export const summaryActive=(item:SummaryOperation)=>item.status==='running'||item.status==='waiting'||item.status==='retrying'||item.status==='finalizing';
function resultFields(value:unknown){
  const result=record(value);return {
    summary:text(result.summary),tokensBefore:number(result.tokensBefore),estimatedTokensAfter:number(result.estimatedTokensAfter),
    cost:number(record(record(result.usage).cost).total),entryId:text(result.id),
  };
}
const defined=(value:Record<string,unknown>)=>Object.fromEntries(Object.entries(value).filter(([,item])=>item!==undefined));

/** Native summary events and Revu's request boundaries share one operation per attempt sequence. */
export function updateSummaryOperations(operations:SummaryOperation[],event:unknown,runKey:string,now=Date.now()):SummaryOperation[]{
  const item=record(event);const type=item.type;
  if(type==='turn_start'||(type==='message_start'&&record(item.message).role==='assistant')){
    return operations.some(operation=>operation.continuation==='pending')?operations.map(operation=>operation.continuation==='pending'
      ?{...operation,continuation:'running',events:[...operation.events,event]}:operation):operations;
  }
  if(type==='agent_settled')return operations.map(operation=>operation.continuation==='pending'||operation.continuation==='running'
    ?{...operation,continuation:item.aborted?'cancelled':operation.continuation==='pending'?'failed':'completed',events:[...operation.events,event]}:operation);
  if(type==='message_end'&&record(item.message).role==='assistant'&&record(item.message).stopReason==='error')
    return operations.map(operation=>operation.continuation==='running'?{...operation,continuation:'failed',events:[...operation.events,event]}:operation);
  if(type==='summary_interrupted')return operations.map(operation=>summaryActive(operation)
    ?{...operation,status:'failed',error:text(item.errorMessage)??'The operation was interrupted.',endedAt:now,events:[...operation.events,event]}:operation);

  const start=type==='summary_operation_start'||type==='compaction_start';
  const end=type==='summary_operation_end'||type==='compaction_end';
  const retry=typeof type==='string'&&type.startsWith('summarization_retry_');
  if(!start&&!end&&!retry)return operations;
  const kind:SummaryKind|undefined=type==='compaction_start'||type==='compaction_end'?'compaction'
    :item.kind==='compaction'||item.source==='compaction'?'compaction'
    :item.kind==='branchSummary'||item.source==='branchSummary'?'branchSummary':undefined;
  let index=typeof item.id==='string'?operations.findIndex(operation=>operation.id===item.id):-1;
  if(index<0)for(let at=operations.length-1;at>=0;at--){if(summaryActive(operations[at])&&(!kind||operations[at].kind===kind)){index=at;break;}}
  // A retry-finished event has no success result and must never complete a card.
  if(retry&&index<0)return operations;
  let next=operations;
  if(index<0){
    if(!kind)return operations;
    next=[...operations,{id:text(item.id)??`${kind}-${now}-${operations.length}`,kind,runKey,status:'running',startedAt:start?now:undefined,events:[]}];
    index=next.length-1;
  }
  let operation={...next[index],events:[...next[index].events,event]};
  if(start){
    // Native compaction_start enriches the manual request boundary; it is not another operation.
    operation={...operation,reason:text(item.reason)??operation.reason};
  }else if(type==='summarization_retry_scheduled'){
    operation={...operation,status:'waiting',retry:{attempt:number(item.attempt)??1,maxAttempts:number(item.maxAttempts)??1,
      deadline:now+Math.max(0,number(item.delayMs)??0),error:text(item.errorMessage)??'The summary request failed.'}};
  }else if(type==='summarization_retry_attempt_start'){
    operation={...operation,status:'retrying',reason:text(item.reason)??operation.reason};
  }else if(type==='summarization_retry_finished'){
    operation={...operation,status:'finalizing'};
  }else if(end){
    const fields=defined(resultFields(item.result));
    // A wrapper acknowledges the result after the native end event. Preserve its cancellation/error outcome.
    const wrapper=type==='summary_operation_end'&&!summaryActive(operation);
    const status:SummaryStatus=wrapper?operation.status:item.aborted||item.cancelled?'cancelled':item.errorMessage?'failed':item.skipped?'skipped':item.result?'completed':'failed';
    operation={...operation,...fields,status,reason:text(item.reason)??operation.reason,endedAt:operation.endedAt??now,
      error:text(item.errorMessage)??operation.error??(status==='failed'?'No summary result was returned.':undefined),
      continuation:item.willRetry?'pending':operation.continuation};
  }
  return next.map((value,at)=>at===index?operation:value);
}

/** Historical records contain results, but do not imply a known trigger, duration or retry history. */
export function historicalSummary(message:unknown,entry?:unknown):SummaryOperation{
  const value=record(message);const source=record(entry);const kind:SummaryKind=value.role==='branchSummary'?'branchSummary':'compaction';
  const time=typeof value.timestamp==='number'?value.timestamp:Date.parse(String(value.timestamp??''));
  return {id:text(source.id)??`history-${kind}-${value.timestamp}`,kind,runKey:'',status:'completed',
    ...resultFields({...value,...source}),endedAt:Number.isFinite(time)?time:undefined,events:[entry??message]};
}

export function summaryReason(reason?:string){return reason==='manual'?'Manual':reason==='threshold'?'Automatic threshold':reason==='overflow'?'Context overflow':reason;}
export function summaryStatus(operation:SummaryOperation,now:number){
  if(operation.status==='waiting'&&operation.retry){const seconds=Math.max(0,Math.ceil((operation.retry.deadline-now)/1000));
    return seconds?`Retry ${operation.retry.attempt}/${operation.retry.maxAttempts} in ${seconds}s`:`Retry ${operation.retry.attempt}/${operation.retry.maxAttempts} pending`;}
  if(operation.status==='retrying')return operation.retry?`Retrying ${operation.retry.attempt}/${operation.retry.maxAttempts}`:'Retrying';
  return {running:'Generating summary…',waiting:'Waiting to retry',finalizing:'Finalizing…',completed:'Completed',failed:'Failed',cancelled:'Cancelled',skipped:'No summary needed'}[operation.status];
}
