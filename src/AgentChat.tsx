import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Project } from './editor';
import Icon from './Icon';
import AgentSelect,{type SelectGroup,type SelectOption} from './AgentSelect';
import {ExtensionQuestionnaire} from './ExtensionInput';
import type {PiExtensionPending,PiExtensionRequest} from '../shared/piTypes';
import MarkdownContent, {linkedCodeReferences} from './MarkdownContent';
import {CODE_PIN_TOOL,codeReferences,type CodeReference,type PinSource,type PinTarget} from '../shared/codePins';
import SessionTreeDialog from './SessionTreeDialog';
import SummaryCard from './SummaryCard';
import { CwdRecoveryDialog,ForkDialog, ProjectTrustDialog, RenameSessionDialog } from './CommandDialogs';
import { mergePiCommands, parsePiCommand, piCommandAt, piQueueWarning, UNSUPPORTED_PI_COMMANDS } from '../shared/piCommands';
import { historicalSummary, summaryActive, updateSummaryOperations, type SummaryOperation } from '../shared/piSummary';
import { showContextMenu } from './ContextMenu';
import { isReservedPiSessionName, piSessionProjectKey, threadPiSessions,type ThreadedPiSession } from '../shared/piSession';
import { inlineDiff } from '../shared/inlineDiff';
import type { ProjectPathEntry } from '../shared/types';
import type {
  PiSlashCommand,PiProjectTrust,PiTrustRequest,PiTrustChoice,
  PiCompactionConfiguration,PiCompactionResult,PiContextProjection,PiDirectBashState,PiEntriesResponse,PiModelDefaults,PiModelSummary,PiProviderStatus,PiQueueState,PiRuntimeStatus,
  PiSessionCatalog,PiSessionEntry,PiSessionGroup,PiSessionInfo,PiSessionScope,PiSessionSearchResult,PiSessionSnapshot,PiSessionSort,PiSessionSummary,PiThinkingLevel,
  PiTreeNavigationResponse,PiUsageStats,RevuPiEvent,
} from '../shared/piTypes';
import { mergePiQueues, updatePiQueueItem } from '../shared/piQueue';

export interface ToolState {
  id:string;runKey:string;name:string;status:'running'|'done'|'error';args?:unknown;result?:unknown;
  startedAt?:number;durationMs?:number;usage?:MessageUsage;
}
export interface AutoRetryState {attempt:number;maxAttempts:number;errorMessage:string;deadline:number;cancelling?:boolean}
export interface ChatState extends PiSessionSnapshot {tools:ToolState[];streamText:string;streamThinking:string;entries:PiSessionEntry[];leafId:string|null;queue:PiQueueState;bashHistory?:PiDirectBashState[];autoRetry?:AutoRetryState;settledRuns:Record<string,number>;summaryOperations:SummaryOperation[]}
export interface ToolDetailRequest {
  id:string;projectId:string;sessionId:string;toolCallId:string;fileName:string;content:string;
}
interface RunItem {type:'answer'|'thinking'|'tool'|'fallback'|'bash'|'custom'|'branchSummary'|'compactionSummary'|'summaryOperation';key:string;text?:string;tool?:ToolState;streaming?:boolean;label?:string;raw?:unknown;meta?:string;bash?:PiDirectBashState;summary?:SummaryOperation;pinSource?:PinSource;lastAnswerPart?:boolean}
interface MessageUsage {input:number;output:number;cacheRead:number;cacheWrite:number;reasoning:number;totalTokens:number;cost:number}
interface RunCall {key:string;type:'model'|'tool';name:string;durationMs?:number;usage?:MessageUsage}
interface RunStats {elapsedMs?:number;modelTimeMs:number;toolTimeMs:number;assistantUsage:MessageUsage;toolUsage:MessageUsage;calls:RunCall[]}
type AssistantStopReason='stop'|'toolUse'|'length'|'error'|'aborted'|'deferred';
interface ChatRun {key:string;user:string;userTimestamp?:number;userEntryId?:string;items:RunItem[];stats:RunStats;lastEventAt?:number;stopReason?:AssistantStopReason}
type SessionTone='idle'|'running'|'done'|'error'|'question';
export interface AgentNavigationRequest {projectId:string;sessionId:string;runKey?:string;messageId?:string;token:number}
export interface AgentNotice {level:'info'|'warning'|'success'|'error';message:string;projectId:string;sessionId:string;runKey?:string;question?:boolean}
type Notify=(level:'info'|'warning'|'error',message:string)=>void;
interface MentionMatch {start:number;end:number;query:string}

const THINKING_LEVELS:PiThinkingLevel[]=['off','minimal','low','medium','high','xhigh','max'];
const EMPTY_QUEUE:PiQueueState={steering:[],followUp:[]};
const unwrap=<T,>(result:{ok:boolean;value?:T;error?:string})=>{
  if(!result.ok)throw new Error(result.error||'Pi Agent request failed.');return result.value as T;
};
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'?value as Record<string,unknown>:{};
const messageKey=(message:unknown)=>{const item=record(message);
  if(item.role==='toolResult'&&typeof item.toolCallId==='string'&&item.toolCallId)return `toolResult:call:${item.toolCallId}`;
  return `${String(item.role)}:${String(item.timestamp??'')}`;
};
const messageText=(message:unknown)=>{
  const item=record(message);const content=item.content;
  if(typeof content==='string')return content;
  if(!Array.isArray(content))return '';
  return content.map(block=>{
    const value=record(block);
    if(value.type==='text')return typeof value.text==='string'?value.text:'';
    return '';
  }).filter(Boolean).join('\n');
};
const KNOWN_MESSAGE_ROLES=new Set(['system','user','assistant','toolResult','bashExecution','custom','branchSummary','compactionSummary']);
const messageJson=(value:unknown)=>{try{return JSON.stringify(value,null,2);}catch{return String(value);}};
const messageTimestamp=(message:unknown)=>{
  const value=record(message).timestamp;
  const time=typeof value==='number'?value:typeof value==='string'?Date.parse(value):NaN;
  return Number.isFinite(time)?time:undefined;
};
const numberValue=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value:undefined;
const assistantStopReason=(value:unknown):AssistantStopReason|undefined=>
  value==='stop'||value==='toolUse'||value==='length'||value==='error'||value==='aborted'||value==='deferred'?value:undefined;
const emptyMessageUsage=():MessageUsage=>({input:0,output:0,cacheRead:0,cacheWrite:0,reasoning:0,totalTokens:0,cost:0});
const messageUsage=(message:unknown):MessageUsage|undefined=>{
  const usage=record(record(message).usage);const cost=record(usage.cost);
  const input=numberValue(usage.input)??0;const output=numberValue(usage.output)??0;const cacheRead=numberValue(usage.cacheRead)??0;
  const cacheWrite=numberValue(usage.cacheWrite)??0;const reasoning=numberValue(usage.reasoning)??0;
  const totalTokens=numberValue(usage.totalTokens)??numberValue(usage.total)??input+output+cacheRead+cacheWrite;
  const totalCost=numberValue(cost.total)??0;
  return totalTokens||totalCost||input||output||cacheRead||cacheWrite||reasoning?{input,output,cacheRead,cacheWrite,reasoning,totalTokens,cost:totalCost}:undefined;
};
const addUsage=(target:MessageUsage,value?:MessageUsage)=>{if(!value)return;target.input+=value.input;target.output+=value.output;target.cacheRead+=value.cacheRead;
  target.cacheWrite+=value.cacheWrite;target.reasoning+=value.reasoning;target.totalTokens+=value.totalTokens;target.cost+=value.cost;};
const combinedUsage=(stats:RunStats)=>{const total=emptyMessageUsage();addUsage(total,stats.assistantUsage);addUsage(total,stats.toolUsage);return total;};
const emptyRunStats=():RunStats=>({modelTimeMs:0,toolTimeMs:0,assistantUsage:emptyMessageUsage(),toolUsage:emptyMessageUsage(),calls:[]});
const savedSessionSort=():PiSessionSort=>{const value=localStorage.getItem('revu-session-sort');return value==='recent'||value==='relevance'?value:'threaded';};
const CHAT_HISTORY_KEY='revu-chat-input-history';const CHAT_HISTORY_LIMIT=50;
export const normalizeInputHistory=(value:unknown):string[]=>Array.isArray(value)
  ?value.filter((item):item is string=>typeof item==='string'&&!!item.trim()).slice(-CHAT_HISTORY_LIMIT):[];
const savedInputHistory=():string[]=>{try{return normalizeInputHistory(JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY)??'[]'));}catch{return [];}};
export const appendInputHistory=(value:unknown,text:string):string[]=>{const items=normalizeInputHistory(value);if(!text.trim()||items.at(-1)===text)return items;return [...items,text].slice(-CHAT_HISTORY_LIMIT);};
const rememberInput=(text:string)=>{if(!text.trim())return;try{localStorage.setItem(CHAT_HISTORY_KEY,JSON.stringify(appendInputHistory(savedInputHistory(),text)));}catch{}};
export const directBashCommand=(text:string):{command:string;excludeFromContext:boolean}|null=>{
  if(!text.startsWith('!'))return null;const excludeFromContext=text.startsWith('!!');const command=text.slice(excludeFromContext?2:1).trim();
  return command?{command,excludeFromContext}:null;
};
export const toggleDirectBashInput=(text:string)=>text.startsWith('!!')?`!${text.slice(2)}`:text.startsWith('!')?`!!${text.slice(1)}`:'!';
export const updateAutoRetryState=(current:AutoRetryState|undefined,event:unknown,now=Date.now()):AutoRetryState|undefined=>{
  const payload=record(event);if(payload.type==='auto_retry_start')return {
    attempt:typeof payload.attempt==='number'?payload.attempt:1,maxAttempts:typeof payload.maxAttempts==='number'?payload.maxAttempts:1,
    errorMessage:typeof payload.errorMessage==='string'?payload.errorMessage:'The model request failed.',
    deadline:now+(typeof payload.delayMs==='number'?Math.max(0,payload.delayMs):0),
  };
  return payload.type==='auto_retry_end'||payload.type==='agent_settled'?undefined:current;
};
export const retryCancelOperation=(retry:AutoRetryState,now=Date.now())=>now>=retry.deadline?'abortAgent' as const:'abortRetry' as const;
const mentionAt=(text:string,caret:number):MentionMatch|null=>{
  const before=text.slice(0,caret);const match=/(^|[\s(（])@([^@"'\s()（）]*)$/u.exec(before);if(!match)return null;
  const start=(match.index??0)+match[1].length;return {start,end:caret,query:match[2]};
};
const slashPath=(path:string)=>path.replaceAll('\\','/');
const displayReferencePath=(path:string,root:string)=>{
  const value=slashPath(path);const base=slashPath(root).replace(/\/$/,'');const lower=value.toLocaleLowerCase();const lowerBase=base.toLocaleLowerCase();
  return lower.startsWith(`${lowerBase}/`)?value.slice(base.length+1):value;
};
const fileReference=(path:string,root:string)=>`@"${displayReferencePath(path,root)}"`;
const pathName=(entry:ProjectPathEntry)=>entry.path.replace(/\/$/,'').split('/').at(-1)??entry.path;
const fuzzyPathScore=(entry:ProjectPathEntry,rawQuery:string)=>{
  const query=rawQuery.toLocaleLowerCase();if(!query)return entry.path.replace(/\/$/,'').includes('/')?Number.POSITIVE_INFINITY:0;
  const path=entry.path.toLocaleLowerCase();const name=pathName(entry).toLocaleLowerCase();
  if(name===query)return 0;if(name.startsWith(query))return 1;if(name.includes(query))return 2;if(path.startsWith(query))return 3;if(path.includes(query))return 4;
  let at=0;for(const character of query){at=path.indexOf(character,at);if(at<0)return Number.POSITIVE_INFINITY;at++;}return 5;
};
const runKey=(index:number)=>`run-${Math.max(0,index)}`;
const lastRunKey=(messages:unknown[])=>runKey(messages.reduce<number>((count,message)=>count+(record(message).role==='user'?1:0),0)-1);
const toolsFromMessages=(messages:unknown[]):ToolState[]=>{
  const tools=new Map<string,ToolState>();let runIndex=-1;
  for(const message of messages){const item=record(message);const role=item.role;
    if(role==='user'){runIndex++;continue;}
    if(role==='assistant'&&Array.isArray(item.content))for(const raw of item.content){const block=record(raw);if(block.type!=='toolCall')continue;
      const id=String(block.id??'');if(!id)continue;tools.set(id,{id,runKey:runKey(runIndex),name:String(block.name??'Tool'),status:'running',args:block.arguments});}
    if(role==='toolResult'){const id=String(item.toolCallId??'');if(!id)continue;const existing=tools.get(id);
      const usage=messageUsage(message);tools.set(id,{id,runKey:existing?.runKey??runKey(runIndex),name:String(item.toolName??existing?.name??'Tool'),status:item.isError?'error':'done',
        args:existing?.args,result:message,durationMs:numberValue(item.durationMs),...(usage?{usage}:{})});}
  }
  return [...tools.values()];
};
const bashRecorded=(snapshot:PiSessionSnapshot,item:PiDirectBashState)=>snapshot.messages.some(message=>{const value=record(message);const timestamp=messageTimestamp(message);
  return value.role==='bashExecution'&&value.command===item.command&&timestamp!==undefined&&timestamp>=item.startedAt;});
const snapshotBash=(snapshot:PiSessionSnapshot,previous?:ChatState)=>{const bash=previous?.bash;if(snapshot.bash)return snapshot.bash;if(!bash)return undefined;
  return bashRecorded(snapshot,bash)?undefined:bash;};
export const withSnapshot=(snapshot:PiSessionSnapshot,previous?:ChatState):ChatState=>({
  ...snapshot,tools:(()=>{const previousTools=previous?.tools??[];const history=toolsFromMessages(snapshot.messages).map(tool=>{
      const existing=previousTools.find(item=>item.id===tool.id);
      return existing?{...tool,startedAt:tool.startedAt??existing.startedAt,durationMs:tool.durationMs??existing.durationMs,usage:tool.usage??existing.usage}:tool;});
    const known=new Set(history.map(tool=>tool.id));
    return [...history,...previousTools.filter(tool=>tool.status==='running'&&!known.has(tool.id))];})(),streamText:'',streamThinking:'',
  entries:previous?.entries??[],leafId:previous?.leafId??null,queue:snapshot.queue??previous?.queue??EMPTY_QUEUE,
  retainedQueue:snapshot.retainedQueue??previous?.retainedQueue??EMPTY_QUEUE,
  bash:snapshotBash(snapshot,previous),
  bashHistory:(previous?.bashHistory??[]).filter(item=>!bashRecorded(snapshot,item)),
  autoRetry:snapshot.status==='running'?previous?.autoRetry:undefined,settledRuns:previous?.settledRuns??{},
  summaryOperations:snapshot.isCompacting&&!previous?.summaryOperations.some(operation=>operation.kind==='compaction'&&summaryActive(operation))
    ?[...(previous?.summaryOperations??[]),{id:`restored-compaction-${snapshot.sessionId}-${previous?.summaryOperations.length??0}`,kind:'compaction',runKey:lastRunKey(snapshot.messages),status:'running',events:[]}]
    :previous?.summaryOperations??[],
});
const withEntries=(state:ChatState,response:PiEntriesResponse):ChatState=>({...state,entries:response.entries,leafId:response.leafId});
const activeEntries=(state:ChatState)=>{
  const byId=new Map(state.entries.map(entry=>[entry.id,entry]));const branch:PiSessionEntry[]=[];let id=state.leafId;
  while(id){const entry=byId.get(id);if(!entry)break;branch.push(entry);id=entry.parentId;}
  return branch.reverse();
};
export const buildRuns=(state:ChatState):ChatRun[]=>{
  const branch=activeEntries(state);const userEntries=branch.filter(entry=>entry.type==='message'&&record(entry.message).role==='user');
  const placedSummaries=new Set<string>();
  const summaryFor=(message:unknown)=>{
    const value=record(message);const kind=value.role==='branchSummary'?'branchSummary':'compaction';
    const entry=branch.find(entry=>entry.type===(kind==='compaction'?'compaction':'branch_summary')&&entry.summary===value.summary&&messageTimestamp(message)===Date.parse(entry.timestamp));
    const historical=historicalSummary(message,entry);const timestamp=messageTimestamp(message);
    const operation=state.summaryOperations.find(operation=>operation.kind===kind&&operation.status==='completed'&&!placedSummaries.has(operation.id)
      &&operation.summary===value.summary&&(operation.entryId?operation.entryId===entry?.id:timestamp===undefined||operation.startedAt===undefined
        ||timestamp>=operation.startedAt&&(operation.endedAt===undefined||timestamp<=operation.endedAt+1000)));
    if(operation)placedSummaries.add(operation.id);
    return operation?{...historical,...operation,cost:operation.cost??historical.cost,entryId:operation.entryId??historical.entryId}:historical;
  };
  const runs:ChatRun[]=[];const tools=new Map(state.tools.map(tool=>[tool.id,tool]));const placed=new Set<string>();let current:ChatRun|undefined;let userIndex=0;
  const availablePins=new Map<string,CodeReference>();
  const pendingPinCalls=new Set<string>();
  const ensureRun=()=>current??(current={key:runKey(runs.length),user:'',items:[],stats:emptyRunStats()},runs.push(current),current);
  for(const message of state.messages){const item=record(message);const role=item.role;
    if(role==='user'){availablePins.clear();pendingPinCalls.clear();const text=messageText(message);const found=userEntries.findIndex((entry,index)=>index>=userIndex&&messageText(entry.message)===text);const entry=found>=0?userEntries[found]:undefined;if(found>=0)userIndex=found+1;
      current={key:runKey(runs.length),user:text,userTimestamp:messageTimestamp(message),userEntryId:entry?.id,items:[],stats:emptyRunStats()};runs.push(current);continue;}
    if(role==='assistant'&&Array.isArray(item.content)){const run=ensureRun();const usage=messageUsage(message);const durationMs=numberValue(item.durationMs);addUsage(run.stats.assistantUsage,usage);
      const answers:RunItem[]=[];
      run.stopReason=assistantStopReason(item.stopReason)??run.stopReason;
      if(durationMs!==undefined)run.stats.modelTimeMs+=durationMs;run.stats.calls.push({key:`model-${run.stats.calls.length}`,type:'model',name:String(item.stopReason??'response'),durationMs,usage});
      const timestamp=messageTimestamp(message);if(timestamp!==undefined)run.lastEventAt=Math.max(run.lastEventAt??0,timestamp+(durationMs??0));for(const raw of item.content){const block=record(raw);
      if(block.type==='text'&&typeof block.text==='string'&&block.text.trim()){
        const answer:RunItem={type:'answer',key:`answer-${run.items.length}`,text:block.text};run.items.push(answer);answers.push(answer);
      }
      if(block.type==='thinking'&&typeof block.thinking==='string'&&block.thinking.trim())run.items.push({type:'thinking',key:`thinking-${run.items.length}`,text:block.thinking});
      if(block.type==='toolCall'){const id=String(block.id??'');if(!id||placed.has(id))continue;const tool=tools.get(id)??{id,runKey:run.key,name:String(block.name??'Tool'),status:'running',args:block.arguments};
        if(block.name===CODE_PIN_TOOL)pendingPinCalls.add(id);
        run.items.push({type:'tool',key:id,tool});placed.add(id);}
    }
      const references=[...new Map(answers.flatMap(answer=>linkedCodeReferences(answer.text!,availablePins)).map(ref=>[ref.href,ref])).values()];
      const pinSource:PinSource={projectId:state.projectId,sessionId:state.sessionId,messageId:messageKey(message),references};
      for(const answer of answers)answer.pinSource=pinSource;
      const last=answers.at(-1);if(last)last.lastAnswerPart=true;
    }
    if(role==='toolResult'){const run=ensureRun();const id=String(item.toolCallId??'');const usage=messageUsage(message);const durationMs=numberValue(item.durationMs);addUsage(run.stats.toolUsage,usage);
      if(pendingPinCalls.delete(id)&&!item.isError&&item.toolName===CODE_PIN_TOOL)for(const reference of codeReferences(item.details))availablePins.set(reference.href,reference);
      if(durationMs!==undefined)run.stats.toolTimeMs+=durationMs;run.stats.calls.push({key:`tool-${id||run.stats.calls.length}`,type:'tool',name:String(item.toolName??'Tool'),durationMs,usage});
      const timestamp=messageTimestamp(message);if(timestamp!==undefined)run.lastEventAt=Math.max(run.lastEventAt??0,timestamp);if(!id||placed.has(id))continue;const tool=tools.get(id);if(tool){run.items.push({type:'tool',key:id,tool});placed.add(id);}}
    if(role==='bashExecution'){const run=ensureRun();run.items.push({type:'bash',key:`bash-${run.items.length}-${String(item.timestamp??'')}`,bash:{
      command:String(item.command??''),output:String(item.output??''),status:item.cancelled||item.exitCode===0?'done':'error',excludeFromContext:!!item.excludeFromContext,
      startedAt:messageTimestamp(message)??0,exitCode:typeof item.exitCode==='number'?item.exitCode:null,cancelled:!!item.cancelled,truncated:!!item.truncated,
      fullOutputPath:typeof item.fullOutputPath==='string'?item.fullOutputPath:undefined,
    }});}
    if(role==='custom'&&item.display!==false){const run=ensureRun();run.items.push({type:'custom',key:`custom-${run.items.length}-${String(item.timestamp??'')}`,
      label:String(item.customType??'Custom'),text:messageText(message),raw:message});}
    if(role==='branchSummary'){const run=ensureRun();run.items.push({type:'branchSummary',key:`branch-${run.items.length}-${String(item.timestamp??'')}`,
      label:'Branch Summary',text:String(item.summary??''),raw:message,summary:summaryFor(message)});}
    if(role==='compactionSummary'){const run=ensureRun();const tokens=numberValue(item.tokensBefore);run.items.push({type:'compactionSummary',key:`compaction-${run.items.length}-${String(item.timestamp??'')}`,
      label:'Compaction Summary',text:String(item.summary??''),meta:tokens===undefined?undefined:`${formatAgentTokens(tokens)} tokens before`,raw:message,summary:summaryFor(message)});}
    if(!KNOWN_MESSAGE_ROLES.has(String(role??''))){const run=ensureRun();run.items.push({type:'fallback',key:`fallback-${run.items.length}`,
      label:String(role??'unknown'),text:messageText(message),raw:message});}
  }
  for(const tool of state.tools){if(placed.has(tool.id))continue;const run=runs.find(candidate=>candidate.key===tool.runKey)??ensureRun();run.items.push({type:'tool',key:tool.id,tool});placed.add(tool.id);}
  const live=ensureRun();if(state.streamThinking)live.items.push({type:'thinking',key:'stream-thinking',text:state.streamThinking,streaming:true});
  for(const operation of state.summaryOperations){if(placedSummaries.has(operation.id))continue;
    const run=runs.find(run=>run.key===operation.runKey)??live;run.items.push({type:'summaryOperation',key:operation.id,summary:operation});}
  if(state.streamText)live.items.push({type:'answer',key:'stream-answer',text:state.streamText,streaming:true});
  if(state.bashHistory?.length)for(const item of state.bashHistory)live.items.push({type:'bash',key:`direct-bash-${item.startedAt}-${item.command}`,bash:item});
  if(state.bash)live.items.push({type:'bash',key:'direct-bash-active',bash:state.bash});
  for(const run of runs){const settledAt=state.settledRuns[run.key]??run.lastEventAt;if(run.userTimestamp!==undefined&&settledAt!==undefined&&settledAt>=run.userTimestamp)run.stats.elapsedMs=settledAt-run.userTimestamp;}
  return runs.filter(run=>run.user||run.items.length);
};
const titleFor=(session?:PiSessionSummary,snapshot?:ChatState)=>snapshot?.name&&snapshot.name!=='New Chat'
  ?snapshot.name:session?.name??'New Chat';
export const formatAgentTokens=(value:number)=>{
  const compact=(amount:number,suffix:string)=>`${Number(amount.toFixed(1))}${suffix}`;
  return value>=1_000_000?compact(value/1_000_000,'m'):value>=1000?compact(value/1000,'k'):String(value);
};
export const formatContextPercent=(value?:number|null)=>`${(value??0).toFixed(2)}%`;
const sourceRoles=(messages:unknown[])=>messages.map(message=>String(record(message).role??'')).filter(Boolean);
const blockSummary=(content:unknown)=>{
  const blocks=Array.isArray(content)?content.map(record):[];
  const calls=blocks.filter(block=>block.type==='toolCall').map(block=>String(block.name??'tool'));
  if(calls.length)return `toolCall ${calls.slice(0,3).join(', ')}${calls.length>3?` +${calls.length-3}`:''}`;
  const thinking=blocks.find(block=>block.type==='thinking');
  if(thinking&&typeof thinking.thinking==='string')return `thinking: ${thinking.thinking}`;
  const images=blocks.filter(block=>block.type==='image').length;
  return images?(images===1?'image':`${images} images`):'';
};
const sourcePreview=(entry:PiSessionEntry)=>{
  const value=record(entry);const clip=(text:string)=>text.replace(/\s+/g,' ').trim().slice(0,120);
  switch(entry.type){
    case 'message':{
      const item=record(value.message);const role=String(item.role??'');
      if(role==='bashExecution')return clip(`$ ${String(item.command??'')}`);
      if(role==='toolResult'){const tool=String(item.toolName??'tool');const body=clip(messageText(item))||clip(blockSummary(item.content));return body?`${tool}: ${body}`:tool;}
      if(role==='system'){const sections=record(item.sections);const preamble=typeof sections.preamble==='string'?clip(sections.preamble):'';
        return preamble||clip(messageText(item))||(Object.keys(sections).length?'system prompt':'');}
      return clip(messageText(item))||clip(blockSummary(item.content))||clip(String(item.errorMessage??''))||'(no content)';
    }
    case 'custom_message':return clip(messageText(value.content))||'custom message';
    case 'branch_summary':return clip(String(value.summary??''))||'branch summary';
    case 'compaction':return `${formatAgentTokens(Number(value.tokensBefore??0))} tokens · ${clip(String(value.summary??''))}`;
    case 'model_change':return `${String(value.provider??'')}/${String(value.modelId??'')}`;
    case 'thinking_level_change':return String(value.thinkingLevel??'');
    case 'label':return clip(String(value.label??'(cleared)'));
    case 'session_info':return clip(String(value.name??'(empty)'));
    case 'custom':return clip(String(value.customType??''));
    case 'context_edit':return value.replacement==null?`omit ${String(value.targetId??'')}`:`replace ${String(value.targetId??'')}`;
    case 'usage':return [String(value.kind??'usage'),`${String(value.provider??'')}/${String(value.model??'')}`].join(' · ');
    default:return '';
  }
};
export const formatToolDuration=(value:number)=>{
  const seconds=Math.max(0,value)/1000;
  if(seconds<60)return `${seconds.toFixed(1)}s`;
  const total=Math.floor(seconds);const minutes=Math.floor(total/60);const remainder=total%60;
  return minutes<60?`${minutes}m ${remainder}s`:`${Math.floor(minutes/60)}h ${minutes%60}m ${remainder}s`;
};
const toolDuration=(tool:ToolState,now:number)=>tool.durationMs??(tool.startedAt===undefined?undefined:Math.max(0,now-tool.startedAt));
const toolFileName=(tool:ToolState)=>{
  const name=tool.name.trim().replace(/[^A-Za-z0-9._-]+/g,'-').replace(/^-+|-+$/g,'')||'tool';
  const id=tool.id.replace(/[^A-Za-z0-9_-]+/g,'-').slice(0,16)||'call';
  return `${name}-${id}.tool.json`;
};
const toolDetail=(chat:ChatState,tool:ToolState,now=Date.now()):ToolDetailRequest=>({
  id:`tool:${chat.sessionId}:${tool.id}`,projectId:chat.projectId,sessionId:chat.sessionId,toolCallId:tool.id,
  fileName:toolFileName(tool),content:JSON.stringify({
    tool:tool.name,toolCallId:tool.id,status:tool.status,
    ...(tool.startedAt!==undefined?{startedAt:new Date(tool.startedAt).toISOString()}:{}),
    ...(toolDuration(tool,now)!==undefined?{durationMs:Math.round(toolDuration(tool,now)!)}:{}),
    input:tool.args??null,output:tool.result??null,usage:tool.usage??null,
  },null,2),
});
const toolOutputText=(tool:ToolState)=>messageText(tool.result);
const toolReadDetail=(path:string,args:Record<string,unknown>)=>{
  const offset=numberValue(args.offset)??1;const limit=numberValue(args.limit);
  if(limit!==undefined&&limit>0)return `${path}  ${offset}-${offset+limit-1}`;
  return offset>1?`${path}  from ${offset}`:path;
};
export const toolPresentation=(tool:ToolState):{label:string;detail:string;body?:string}=>{
  const name=tool.name.toLowerCase();const args=record(tool.args);
  if(name==='bash')return {label:'bash',detail:typeof args.command==='string'?args.command:'',body:toolOutputText(tool)};
  if(name==='read'){
    const path=typeof args.path==='string'?args.path:'';
    return {label:'read',detail:path?toolReadDetail(path,args):'',body:toolOutputText(tool)};
  }
  if(name==='write'){
    const path=typeof args.path==='string'?args.path:'';
    const content=typeof args.content==='string'?args.content:'';
    return {label:'write',detail:path,body:tool.status==='error'?toolOutputText(tool):content||toolOutputText(tool)};
  }
  if(name==='edit'){
    const path=typeof args.path==='string'?args.path:'';
    const diff=record(record(tool.result).details).diff;
    return {label:'edit',detail:path,body:typeof diff==='string'&&diff?diff:toolOutputText(tool)};
  }
  if(name===CODE_PIN_TOOL){
    const ranges=Array.isArray(args.references)?args.references.map(value=>{
      const ref=record(value);
      return typeof ref.path==='string'?`${ref.path}:${String(ref.startLine)}–${String(ref.endLine)}`:'';
    }).filter(Boolean):[];
    const details=record(tool.result).details;
    const references=codeReferences(details);
    const body=Array.isArray(record(details).results)?toolOutputText(tool)
      :references.map(ref=>[`${ref.path}:${ref.startLine}–${ref.endLine}`,ref.note].filter(Boolean).join('\n')).join('\n\n');
    return {label:name,detail:ranges.join(', '),body:body||toolOutputText(tool)||undefined};
  }
  return {label:tool.name,detail:''};
};
export interface EditDiffRow {marker:' '|'+'|'-';prefix:string;segments:{text:string;changed:boolean}[]}
export const editDiffRows=(diff:string):EditDiffRow[]=>{
  const rows:EditDiffRow[]=[];
  for(const line of diff.split('\n')){
    const marker=line[0];const rest=line.slice(1);const numbered=marker===' '||marker==='+'||marker==='-'?/^(\s*)(\d+) (.*)$/.exec(rest):null;
    if(numbered){rows.push({marker:marker as EditDiffRow['marker'],prefix:marker+numbered[1]+numbered[2]+' ',segments:[{text:numbered[3],changed:false}]});continue;}
    if(/^\s*\.\.\.$/.test(rest)){rows.push({marker:' ',prefix:line.slice(0,Math.max(0,line.length-3)),segments:[{text:'...',changed:false}]});continue;}
    rows.push({marker:' ',prefix:'',segments:[{text:line,changed:false}]});
  }
  for(let index=0;index<rows.length;){
    if(rows[index].marker!=='-'){index++;continue;}
    const removedStart=index;while(index<rows.length&&rows[index].marker==='-')index++;
    const addedStart=index;while(index<rows.length&&rows[index].marker==='+')index++;
    const count=Math.min(index-removedStart,index-addedStart);
    for(let pair=0;pair<count;pair++){
      const before=rows[removedStart+pair],after=rows[addedStart+pair];
      const result=inlineDiff(before.segments.map(segment=>segment.text).join(''),after.segments.map(segment=>segment.text).join(''));
      before.segments=result.before;after.segments=result.after;
    }
  }
  return rows;
};
const emptyUsage:PiUsageStats={input:0,output:0,cacheRead:0,cacheWrite:0,total:0,cost:0,runs:0,toolCalls:0,cacheHitPercent:0,contextTokens:0,contextWindow:0,contextPercent:0};
const finalAnswer=(run:ChatRun)=>[...run.items].reverse().find(item=>item.type==='answer'&&!item.streaming)?.text??'';
const usageMeta=(usage:MessageUsage)=>`${formatAgentTokens(usage.totalTokens)} tokens · $${usage.cost.toFixed(4)}`;
const runStatsSummary=(run:ChatRun)=>{const usage=combinedUsage(run.stats);return [run.stats.elapsedMs===undefined?undefined:formatToolDuration(run.stats.elapsedMs),
  `${formatAgentTokens(usage.totalTokens)} tokens`,`$${usage.cost.toFixed(4)}`].filter(Boolean).join(' · ');};
const stopReasonLabel=(reason:AssistantStopReason)=>reason==='toolUse'?'Tool Use':reason[0].toUpperCase()+reason.slice(1);
function TimelineSummaryCard({item,onToggle}:{item:RunItem;onToggle:()=>void}){
  return <details className={`agent-special-message ${item.type}`} onToggle={onToggle}>
    <summary><strong>{item.label}</strong>{item.meta&&<span>{item.meta}</span>}<small>{item.text||'No text content.'}</small></summary>
    <div className="agent-special-content"><MarkdownContent text={item.text??''}/>{item.type==='custom'&&record(item.raw).details!==undefined&&<pre>{messageJson(record(item.raw).details)}</pre>}</div>
  </details>;
}
function BashCard({bash,onAbort,onToggle}:{bash:PiDirectBashState;onAbort?:()=>void;onToggle:()=>void}){
  const status=bash.status==='running'?'running':bash.cancelled?'cancelled':bash.exitCode!==undefined&&bash.exitCode!==null?`exit ${bash.exitCode}`:bash.status==='error'?'error':'done';
  const output=bash.output||(bash.status==='running'?'Waiting for output…':'(no output)');
  return <details className={`agent-bash-message ${bash.excludeFromContext?'excluded':'direct'} ${bash.status}`} open onToggle={onToggle}><summary><span className="agent-bash-head"><strong>{bash.excludeFromContext?'!!bash':'!bash'}</strong>
    <code title={bash.command}>{bash.command}</code></span><span>{status}</span>
    {bash.status==='running'&&onAbort&&<button type="button" className="agent-bash-stop" title="Stop Bash" aria-label="Stop Bash" onClick={event=>{event.preventDefault();event.stopPropagation();onAbort();}}>Stop</button>}</summary>
    <pre>{output}{bash.error?`\n${bash.error}`:''}{bash.truncated&&bash.fullOutputPath?`\n\nOutput truncated. Full output: ${bash.fullOutputPath}`:''}</pre></details>;
}
function ToolCard({tool,now,onOpenDetail,onToggle}:{tool:ToolState;now:number;onOpenDetail:()=>void;onToggle:()=>void}){
  const view=toolPresentation(tool);const body=view.body??messageJson({input:tool.args,output:tool.result});
  const duration=toolDuration(tool,now);const isDiff=tool.name.toLowerCase()==='edit'&&!!view.body?.trim();
  const rows=isDiff?editDiffRows(body.endsWith('\n')?body.slice(0,-1):body):[];
  return <details className={`agent-tool ${tool.status}`} onToggle={onToggle}><summary><span className="agent-tool-head"><span>{view.label}</span>
    {view.detail&&<span className="agent-tool-command" title={view.detail}>{view.detail}</span>}</span>
    <span className="agent-tool-meta">{tool.usage&&<span className="agent-tool-usage">{usageMeta(tool.usage)}</span>}{duration!==undefined&&<time>{formatToolDuration(duration)}</time>}<small>{tool.status}</small></span></summary>
    <div className="agent-tool-detail"><button type="button" className="agent-tool-expand" title="Open in Editor" aria-label={`Open ${tool.name} details in editor`} onClick={onOpenDetail}><Icon name="expand" size={13}/></button>
      {isDiff?<div className="agent-tool-diff"><div className="agent-tool-diff-lines">{rows.map((row,index)=><span className={`agent-tool-diff-line${row.marker==='+'?' add':row.marker==='-'?' del':''}`} key={index}><span className="agent-tool-diff-prefix">{row.prefix}</span>{row.segments.map((segment,part)=>segment.changed?<mark key={part}>{segment.text}</mark>:<span key={part}>{segment.text}</span>)}</span>)}</div></div>
        :<pre className={view.body!==undefined?'agent-tool-output':undefined}>{body||(tool.status==='running'?'Waiting for output…':'(no output)')}</pre>}</div></details>;
}
function QueueMessage({message,retained,onAppend,onReplace,onDelete,onSend,replaceDisabled=false}:{message:string;retained?:boolean;onAppend?:()=>void;onReplace?:()=>void;onDelete?:()=>void;onSend?:()=>void;replaceDisabled?:boolean}){
  return <span className={retained?'retained':undefined} title={message}><span className="agent-queue-item-text">{message}</span>{retained&&<span className="agent-queue-item-actions">
    <button type="button" title="Append to Input" aria-label="Append queued message to input" onClick={onAppend}><Icon name="appendToInput" size={16.5}/></button>
    <button type="button" title="Replace from Input" aria-label="Replace queued message from input" disabled={replaceDisabled} onClick={onReplace}><Icon name="replaceFromInput" size={16.5}/></button>
    <button type="button" title="Delete" aria-label="Delete queued message" onClick={onDelete}><Icon name="delete" size={15}/></button>
    <button type="button" title="Send as Prompt" aria-label="Send queued message as prompt" onClick={onSend}><Icon name="send" size={15}/></button>
  </span>}</span>;
}
function RunStatsDetails({run}:{run:ChatRun}){
  const usage=combinedUsage(run.stats);const toolCalls=run.stats.calls.filter(call=>call.type==='tool').length;const modelCalls=run.stats.calls.length-toolCalls;
  const row=(label:string,value:string,wide=false)=><div className={wide?'wide':undefined}><dt>{label}</dt><dd>{value}</dd></div>;
  return <div className="agent-run-stats-content"><header><strong>Run Details</strong></header><dl className="agent-run-stats-grid">
    {run.stats.elapsedMs!==undefined&&row('Elapsed',formatToolDuration(run.stats.elapsedMs),true)}{row('Model time',formatToolDuration(run.stats.modelTimeMs))}{row('Tool time (sum)',formatToolDuration(run.stats.toolTimeMs))}
    {row('Input',usage.input.toLocaleString())}{row('Output',usage.output.toLocaleString())}{row('Cache read',usage.cacheRead.toLocaleString())}{row('Cache write',usage.cacheWrite.toLocaleString())}
    {usage.reasoning>0&&row('Reasoning (included in Output)',usage.reasoning.toLocaleString(),true)}{run.stats.toolUsage.totalTokens>0&&row('Tool model tokens',run.stats.toolUsage.totalTokens.toLocaleString(),true)}
    {row('Model calls',String(modelCalls))}{row('Tool calls',String(toolCalls))}{row('Total tokens',usage.totalTokens.toLocaleString())}{row('Cost',`$${usage.cost.toFixed(4)}`)}
  </dl>{run.stats.calls.length>0&&<details className="agent-run-calls"><summary><Icon name="down" size={11}/><span>Calls</span></summary><div>{run.stats.calls.map(call=><div key={call.key}>
    <span>{call.type==='model'?`Model · ${call.name}`:call.name}</span><small>{[call.usage?`${formatAgentTokens(call.usage.totalTokens)} · $${call.usage.cost.toFixed(4)}`:undefined,
      call.durationMs===undefined?undefined:formatToolDuration(call.durationMs)].filter(Boolean).join(' · ')||'No usage data'}</small></div>)}</div></details>}</div>;
}
const assistantText=(run:ChatRun)=>run.items.filter(item=>item.type==='answer'&&item.text).map(item=>item.text).join('\n\n');
export const shouldShowAssistantActions=(isLatest:boolean,status:PiRuntimeStatus)=>!isLatest||(status!=='starting'&&status!=='running');
const formatTime=(value:number)=>new Intl.DateTimeFormat(undefined,{hour:'2-digit',minute:'2-digit'}).format(value);
const formatFullTime=(value:number)=>new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(value);
function formatSessionTime(date:Date){
  const twoDigits=(value:number)=>String(value).padStart(2,'0');
  const year=String(date.getFullYear()).padStart(4,'0');
  const month=twoDigits(date.getMonth()+1);
  const day=twoDigits(date.getDate());
  return year+'-'+month+'-'+day+' '+twoDigits(date.getHours())+':'+twoDigits(date.getMinutes());
}
const sessionTone=(status:PiRuntimeStatus,done:boolean,question=false):SessionTone=>question?'question':done?'done':status==='error'?'error':
  status==='running'||status==='starting'||status==='stopping'?'running':'idle';
const sessionStatusLabel=(tone:SessionTone)=>tone==='question'?'Question':tone==='running'?'Running':tone==='done'?'Done':tone==='error'?'Error':'Idle';
const PROVIDER_NAMES:Record<string,string>={anthropic:'Anthropic',openai:'OpenAI',google:'Google Gemini',openrouter:'OpenRouter',deepseek:'DeepSeek',xai:'xAI',groq:'Groq',mistral:'Mistral',cerebras:'Cerebras',nvidia:'NVIDIA NIM',zai:'ZAI',moonshotai:'Moonshot AI','moonshotai-cn':'Moonshot AI CN'};
const providerName=(id:string)=>PROVIDER_NAMES[id]??id;
const modelValue=(provider:string,id:string)=>`${provider}\u0000${id}`;
const modelGroups=(models:PiModelSummary[]):SelectGroup[]=>{
  const groups=new Map<string,SelectOption[]>();
  for(const model of models){const options=groups.get(model.provider)??[];options.push({value:modelValue(model.provider,model.id),label:model.id});groups.set(model.provider,options);}
  return [...groups].map(([provider,options])=>({label:providerName(provider),options}));
};


export function updateEvent(current:ChatState,event:unknown):ChatState{
  const item=record(event);const type=item.type;
  const summaries=updateSummaryOperations(current.summaryOperations,event,lastRunKey(current.messages));
  if(summaries!==current.summaryOperations)current={...current,summaryOperations:summaries};
  if(type==='message_start'){
    const message=item.message;const role=record(message).role;
    if(role==='assistant')return {...current,streamText:'',streamThinking:''};
    if(role==='user'&&!current.messages.some(existing=>messageKey(existing)===messageKey(message)))
      return {...current,messages:[...current.messages,message]};
  }
  if(type==='message_update'){
    const delta=record(item.assistantMessageEvent);
    if(delta.type==='text_delta'&&typeof delta.delta==='string')return {...current,streamText:current.streamText+delta.delta};
    if(delta.type==='thinking_delta'&&typeof delta.delta==='string')return {...current,streamThinking:current.streamThinking+delta.delta};
  }
  if(type==='message_end'){
    const message=item.message;const value=record(message);const key=messageKey(message);const index=current.messages.findIndex(existing=>messageKey(existing)===key);
    const messages=index<0?[...current.messages,message]:current.messages.map((existing,i)=>i===index?message:existing);
    if(value.role==='toolResult'){const id=String(value.toolCallId??'');const usage=messageUsage(message);return {...current,messages,streamText:'',streamThinking:'',tools:current.tools.map(tool=>tool.id===id
      ?{...tool,status:value.isError?'error':'done',result:message,durationMs:numberValue(value.durationMs)??tool.durationMs,...(usage?{usage}:tool.usage?{usage:tool.usage}:{})}:tool)};}
    return {...current,messages,streamText:'',streamThinking:''};
  }
  if(type==='tool_execution_start'){
    const id=String(item.toolCallId);const tool:ToolState={id,runKey:lastRunKey(current.messages),name:String(item.toolName),status:'running',args:item.args,startedAt:Date.now()};
    return {...current,tools:[...current.tools.filter(existing=>existing.id!==id),tool]};
  }
  if(type==='tool_execution_update'){
    const id=String(item.toolCallId);
    return {...current,tools:current.tools.map(tool=>tool.id===id?{...tool,result:item.partialResult}:tool)};
  }
  if(type==='tool_execution_end'){
    const id=String(item.toolCallId);const result=record(item.result);
    return {...current,tools:current.tools.map(tool=>{if(tool.id!==id)return tool;const usage=messageUsage(item.result)??tool.usage;return {...tool,status:item.isError||result.isError?'error':'done',result:item.result,
      durationMs:numberValue(item.durationMs)??(tool.startedAt===undefined?undefined:Math.max(0,Date.now()-tool.startedAt)),...(usage?{usage}:{})};})};
  }
  return current;
}

function SessionDialog({projects,projectId,selectedSessionId,sessions,doneSessionIds,onProject,onOpen,onNew,onRename,onDelete,onClone,onExport,onFolderChanged,onClose,notify}:{
  projects:Project[];projectId:string;sessions:PiSessionSummary[];onProject:(id:string)=>void;
  selectedSessionId:string|null;doneSessionIds:ReadonlySet<string>;
  onOpen:(session:PiSessionSummary)=>void;onNew:()=>void;onRename:(session:PiSessionSummary,name:string)=>void;
  onDelete:(session:PiSessionSummary)=>void;onClone:(session:PiSessionSummary)=>void;onExport:(session:PiSessionSummary)=>void;
  onFolderChanged:()=>void;onClose:()=>void;notify:Notify;
}){
  const [renaming,setRenaming]=useState<string|null>(null);const [name,setName]=useState('');const [query,setQuery]=useState('');
  const [sort,setSort]=useState<PiSessionSort>(savedSessionSort);const [results,setResults]=useState<PiSessionSearchResult[]>([]);const [searching,setSearching]=useState(false);
  const [scope,setScope]=useState<PiSessionScope>('current');const [namedOnly,setNamedOnly]=useState(false);
  const [catalog,setCatalog]=useState<PiSessionCatalog>({groups:[],sessions:[]});const [catalogLoading,setCatalogLoading]=useState(false);
  const [folderMenuOpen,setFolderMenuOpen]=useState(false);const folderMenuRef=useRef<HTMLDivElement>(null);
  const selectedProject=projects.find(project=>project.id===projectId)??projects[0];const [selectedCwd,setSelectedCwd]=useState(()=>piSessionProjectKey(selectedProject?.root??''));
  const trimmedQuery=query.trim();
  useEffect(()=>localStorage.setItem('revu-session-sort',sort),[sort]);
  useEffect(()=>{if(!folderMenuOpen)return;const close=(event:MouseEvent)=>{if(!folderMenuRef.current?.contains(event.target as Node))setFolderMenuOpen(false);};
    document.addEventListener('mousedown',close);return()=>document.removeEventListener('mousedown',close);},[folderMenuOpen]);
  useEffect(()=>{if(scope==='current'&&selectedProject)setSelectedCwd(piSessionProjectKey(selectedProject.root));},[scope,selectedProject?.root]);
  useEffect(()=>{
    if(scope!=='all'){setCatalog({groups:[],sessions:[]});setCatalogLoading(false);return;}
    let cancelled=false;setCatalogLoading(true);
    void window.revu.agent.listSessions(projectId,'all').then(unwrap).then(value=>{if(!cancelled){setCatalog(value);
      setSelectedCwd(current=>value.groups.some(group=>group.key===current)?current:piSessionProjectKey(selectedProject?.root??value.groups[0]?.cwd??''));}})
      .catch(error=>{if(!cancelled){setCatalog({groups:[],sessions:[]});notify('error',errorMessage(error));}})
      .finally(()=>{if(!cancelled)setCatalogLoading(false);});
    return()=>{cancelled=true;};
  },[scope,projectId,sessions]);
  useEffect(()=>{
    if(!trimmedQuery){setResults([]);setSearching(false);return;}
    let cancelled=false;setSearching(true);
    const timer=setTimeout(()=>void window.revu.agent.searchSessions(projectId,trimmedQuery,sort,scope).then(unwrap).then(items=>{
      if(!cancelled)setResults(items);
    }).catch(()=>{if(!cancelled)setResults([]);}).finally(()=>{if(!cancelled)setSearching(false);}),150);
    return()=>{cancelled=true;clearTimeout(timer);};
  },[projectId,trimmedQuery,sort,scope,sessions]);
  const openGroups:PiSessionGroup[]=projects.map(project=>({key:piSessionProjectKey(project.root),name:project.name,cwd:project.root,available:true}));
  const openGroupKeys=new Set(openGroups.map(group=>group.key));
  const projectGroups=scope==='current'?openGroups:[...openGroups,...catalog.groups.filter(group=>!openGroupKeys.has(group.key))];
  const sourceSessions=scope==='current'?sessions:catalog.sessions;
  const visibleSessions=sourceSessions.filter(session=>piSessionProjectKey(session.cwd)===selectedCwd&&(!namedOnly||(session.hasName&&!isReservedPiSessionName(session.name))));
  const visibleResults=results.filter(session=>piSessionProjectKey(session.cwd)===selectedCwd&&(!namedOnly||(session.hasName&&!isReservedPiSessionName(session.name))));
  const chooseSessionFolder=async()=>{setFolderMenuOpen(false);try{const result=await window.revu.agent.chooseSessionFolder(projectId).then(unwrap);if(!result)return;
    onFolderChanged();notify('info',result.copied?`Session folder changed. Copied ${result.copied} ${result.copied===1?'session':'sessions'}.`:'Session folder changed.');
  }catch(error){notify('error',errorMessage(error));}};
  const now=new Date();const today=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime();
  const groups=[
    ['Today',(item:PiSessionSummary)=>item.modifiedAt>=today],
    ['Yesterday',(item:PiSessionSummary)=>item.modifiedAt>=today-86400000&&item.modifiedAt<today],
    ['Previous 7 Days',(item:PiSessionSummary)=>item.modifiedAt>=today-6*86400000&&item.modifiedAt<today-86400000],
    ['Older',(item:PiSessionSummary)=>item.modifiedAt<today-6*86400000],
  ] as const;
  const renderSession=(session:PiSessionSummary|PiSessionSearchResult,thread?:ThreadedPiSession<PiSessionSummary>)=>{const tone=sessionTone(session.status,doneSessionIds.has(session.id),session.question);const enabled=(session.status==='idle'||session.status==='error')&&session.hasSessionFile!==false&&!session.isCompacting&&!session.question;
    const modifiedAt=new Date(session.modifiedAt);
    const openProject=projects.find(project=>piSessionProjectKey(project.root)===piSessionProjectKey(session.cwd));const canRuntimeAction=enabled&&!!openProject;
    const actionSession=openProject?{...session,projectId:openProject.id,scope:'current' as const}:session;
    const contextMenu=async(event:React.MouseEvent)=>{const action=await showContextMenu(event,[{id:'clone',label:'Clone',disabled:!canRuntimeAction},{id:'export',label:'Export',disabled:!canRuntimeAction}] as const);
      if(action==='clone')onClone(actionSession);if(action==='export')onExport(actionSession);};
    return <div className={`session-row status-${tone} ${session.id===selectedSessionId?'active':''}`} key={session.id} onContextMenu={event=>void contextMenu(event)}>
      {renaming===session.id?<form onSubmit={event=>{event.preventDefault();const normalized=name.trim();if(!normalized){notify('error','Session name is required.');return;}
        if(isReservedPiSessionName(normalized)){notify('error','Names ending in (Fork), (Clone), or a numbered variant are reserved.');return;}onRename(session,normalized);setRenaming(null);}}>
        <input autoFocus value={name} onChange={event=>setName(event.target.value)}/><button type="submit">Save</button><button type="button" onClick={()=>setRenaming(null)}>Cancel</button>
      </form>:<>
        <button className="session-select" onClick={()=>onOpen(session)}><span className="session-title">{thread&&thread.depth>0&&<i className="session-thread-prefix">{thread.ancestorContinues.map(value=>value?'│  ':'   ').join('')}{thread.isLast?'└─ ':'├─ '}</i>}<b>{session.name}</b></span>{'matchSnippet' in session&&session.matchSnippet&&<em>{session.matchSnippet}</em>}<small><time dateTime={modifiedAt.toISOString()}>{formatSessionTime(modifiedAt)}</time> · {session.runCount} {session.runCount===1?'run':'runs'}</small></button>
        <span className={`session-status ${tone}`}><i/>{sessionStatusLabel(tone)}</span>
        <div className="session-actions"><button className="session-action" onClick={()=>{setRenaming(session.id);setName(session.name);}}>Rename</button>
          <button className="session-action" onClick={()=>onDelete(session)}>Delete</button></div>
      </>}
    </div>;
  };
  return <div className="agent-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}>
    <section className="agent-modal session-dialog" role="dialog" aria-modal="true" aria-label="Sessions">
      <header><strong>Sessions</strong><div><div className="session-folder-settings" ref={folderMenuRef}>
        <button className="agent-icon-button" title="Session settings" aria-label="Session settings" aria-expanded={folderMenuOpen} onClick={()=>setFolderMenuOpen(value=>!value)}><Icon name="sessionSettings" size={15}/></button>
        {folderMenuOpen&&<div className="session-folder-menu" role="menu"><button role="menuitem" onClick={()=>void chooseSessionFolder()}>Session Folder</button></div>}
      </div><button className="agent-icon-button" onClick={onClose} aria-label="Close"><Icon name="close" size={15}/></button></div></header>
      <div className="session-project-bar"><nav className="session-project-tabs" aria-label="Projects">{projectGroups.map(group=><button key={group.key} title={group.cwd}
        className={group.key===selectedCwd?'active':''} onClick={()=>{setSelectedCwd(group.key);if(scope==='current'){const project=projects.find(item=>piSessionProjectKey(item.root)===group.key);if(project)onProject(project.id);}}}>{group.name}</button>)}</nav>
        <div className="session-scope-switch" role="group" aria-label="Session scope"><button className={scope==='current'?'active':''} onClick={()=>setScope('current')}>Current</button><button className={scope==='all'?'active':''} onClick={()=>setScope('all')}>All</button></div></div>
      <div className="session-search"><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search conversations..." aria-label="Search conversations"/>
        <AgentSelect compact align="end" showCheck={false} value={sort} placeholder="Sort" groups={[{options:[{value:'threaded',label:'Threaded'},{value:'relevance',label:'Relevant'},{value:'recent',label:'Recent'}]}]}
          onChange={value=>setSort(value as PiSessionSort)}/><label className="session-named-filter"><input type="checkbox" checked={namedOnly} onChange={event=>setNamedOnly(event.target.checked)}/><span>Named</span></label><button className="session-new-chat" onClick={onNew}>New Chat</button></div>
      <div className="session-groups">{trimmedQuery
        ?searching?<p className="agent-empty">Searching…</p>:visibleResults.length?<section className="session-group search-results">{visibleResults.map(session=>renderSession(session))}</section>:<p className="agent-empty">No matching conversations.</p>
        :catalogLoading&&scope==='all'?<p className="agent-empty">Loading conversations…</p>:visibleSessions.length===0?<p className="agent-empty">No conversations yet.</p>:sort==='threaded'?<section className="session-group threaded">{threadPiSessions(visibleSessions).map(item=>renderSession(item.session,item))}</section>:groups.map(([label,match])=>{
        const items=visibleSessions.filter(match);if(!items.length)return null;
        return <section className="session-group" key={label}><h3>{label}</h3>{items.map(session=>renderSession(session))}</section>;
      })}</div>
    </section>
  </div>;
}

function ModelDialog({projectId,sessionId,onClose,onChanged,notify}:{projectId:string;sessionId?:string;onClose:()=>void;onChanged:()=>void;notify:Notify}){
  const [providers,setProviders]=useState<PiProviderStatus[]>([]);const [selectedProvider,setSelectedProvider]=useState('');
  const [key,setKey]=useState('');const [models,setModels]=useState<PiModelSummary[]>([]);
  const [defaults,setDefaults]=useState<PiModelDefaults>({thinkingLevel:'medium'});const [savedDefaults,setSavedDefaults]=useState<PiModelDefaults>({thinkingLevel:'medium'});
  const [compaction,setCompaction]=useState<PiCompactionConfiguration>({enabled:true,reserveTokens:0,keepRecentTokens:0,modelOverrides:{}});
  const [savedCompaction,setSavedCompaction]=useState<PiCompactionConfiguration>({enabled:true,reserveTokens:0,keepRecentTokens:0,modelOverrides:{}});
  const [overrideOpen,setOverrideOpen]=useState(false);const [overrideModel,setOverrideModel]=useState('');const [overrideReserve,setOverrideReserve]=useState('');const [overrideKeep,setOverrideKeep]=useState('');
  const [busy,setBusy]=useState(false);
  const load=async()=>{
    const providerItems=await window.revu.agent.listProviders().then(unwrap);
    setProviders(providerItems);
    let defaultValues:PiModelDefaults={thinkingLevel:'medium'};
    try{defaultValues=await window.revu.agent.getModelDefaults(projectId).then(unwrap);setDefaults(defaultValues);setSavedDefaults(defaultValues);}
    catch(error){notify('error',errorMessage(error));}
    try{const value=await window.revu.agent.getCompactionConfiguration(projectId).then(unwrap);setCompaction(value);setSavedCompaction(value);}
    catch(error){notify('error',errorMessage(error));}
    const initialProvider=providerItems.some(item=>item.id===defaultValues.provider)?defaultValues.provider:providerItems[0]?.id;
    setSelectedProvider(current=>current||initialProvider||'');
    if(providerItems.some(item=>item.configured)){
      try{setModels(await window.revu.agent.listModels(projectId,sessionId).then(unwrap));}catch(error){notify('error',errorMessage(error));}
    }else setModels([]);
  };
  useEffect(()=>{void load().catch(error=>notify('error',errorMessage(error)));},[projectId,sessionId]);
  const saveKey=async()=>{setBusy(true);try{await window.revu.agent.saveApiKey(selectedProvider,key).then(unwrap);setKey('');await load();onChanged();}catch(error){notify('error',error instanceof Error?error.message:String(error));}finally{setBusy(false);}};
  const removeKey=async()=>{setBusy(true);try{await window.revu.agent.removeApiKey(selectedProvider).then(unwrap);await load();onChanged();}catch(error){notify('error',error instanceof Error?error.message:String(error));}finally{setBusy(false);}};
  const saveDefaults=async()=>{
    if(!defaults.provider||!defaults.modelId)return;setBusy(true);
    try{await window.revu.agent.saveModelDefaults(defaults.provider,defaults.modelId,defaults.thinkingLevel).then(unwrap);onChanged();notify('info','Model defaults saved.');onClose();}
    catch(error){notify('error',error instanceof Error?error.message:String(error));}finally{setBusy(false);}
  };
  const saveCompaction=async()=>{setBusy(true);try{await window.revu.agent.saveCompactionConfiguration(compaction).then(unwrap);setSavedCompaction(compaction);onChanged();notify('info','Compaction settings saved.');}
    catch(error){notify('error',errorMessage(error));}finally{setBusy(false);}};
  const editOverride=(key:string)=>{const value=compaction.modelOverrides[key]??{};const separator=key.indexOf('/');const provider=separator<0?key:key.slice(0,separator);const id=separator<0?'':key.slice(separator+1);setOverrideModel(modelValue(provider,id));
    setOverrideReserve(value.reserveTokens===undefined?'':String(value.reserveTokens));setOverrideKeep(value.keepRecentTokens===undefined?'':String(value.keepRecentTokens));};
  const saveOverride=()=>{if(!overrideModel)return;const [provider,id]=overrideModel.split('\u0000');const key=`${provider}/${id}`;const next:{reserveTokens?:number;keepRecentTokens?:number}={};
    if(overrideReserve!=='')next.reserveTokens=Number(overrideReserve);if(overrideKeep!=='')next.keepRecentTokens=Number(overrideKeep);
    setCompaction(value=>({...value,modelOverrides:{...value.modelOverrides,[key]:next}}));setOverrideModel('');setOverrideReserve('');setOverrideKeep('');};
  const clearOverride=()=>{setOverrideModel('');setOverrideReserve('');setOverrideKeep('');};
  const overrideCount=Object.keys(compaction.modelOverrides).length;
  const overrideSummary=overrideCount===0?'None':overrideCount===1?'1 model':`${overrideCount} models`;
  const overrideKey=overrideModel?overrideModel.split('\u0000').join('/'):'';
  const overrideEditing=!!overrideKey&&!!compaction.modelOverrides[overrideKey];
  const selected=providers.find(item=>item.id===selectedProvider);
  const providerGroups:SelectGroup[]=[{options:providers.map(provider=>({value:provider.id,label:provider.name}))}];
  const defaultModelValue=defaults.provider&&defaults.modelId?modelValue(defaults.provider,defaults.modelId):undefined;
  const thinkingGroups:SelectGroup[]=[{options:THINKING_LEVELS.map(level=>({value:level,label:level}))}];
  const defaultsDirty=defaults.provider!==savedDefaults.provider||defaults.modelId!==savedDefaults.modelId||defaults.thinkingLevel!==savedDefaults.thinkingLevel;
  const compactionDirty=JSON.stringify(compaction)!==JSON.stringify(savedCompaction);const validInteger=(value:number)=>Number.isSafeInteger(value)&&value>=0;
  const compactionValid=validInteger(compaction.reserveTokens)&&validInteger(compaction.keepRecentTokens)&&Object.values(compaction.modelOverrides).every(value=>
    (value.reserveTokens===undefined||validInteger(value.reserveTokens))&&(value.keepRecentTokens===undefined||validInteger(value.keepRecentTokens)));
  return <div className="agent-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}>
    <section className="agent-modal model-dialog" role="dialog" aria-modal="true" aria-label="Model configuration">
      <header><strong>Model Configuration</strong><button className="agent-icon-button" onClick={onClose} aria-label="Close"><Icon name="close" size={15}/></button></header>
      <div className="model-dialog-body"><section className="model-section">
          <div className="model-section-heading"><div><h3>Connection</h3><p>Credentials are encrypted and stored by Revu.</p></div><div className="model-section-actions">
            {selected?.configured&&<button className="secondary" disabled={busy} onClick={()=>void removeKey()}>Remove</button>}{key.trim()&&<button className="save" disabled={busy} onClick={()=>void saveKey()}>Save</button>}</div></div>
          <div className="model-connection-grid"><label><span>Provider</span><AgentSelect value={selectedProvider} groups={providerGroups} placeholder="Select provider"
            onChange={provider=>{setSelectedProvider(provider);setKey('');}}/></label>
            <label><span>API Key</span><input type="password" value={key} placeholder={selected?.maskedKey||'Enter API key'} onChange={event=>setKey(event.target.value)}/></label></div>
        </section>
        <section className="model-section"><div className="model-section-heading"><div><h3>Default Model</h3><p>Applied when a new Pi session is created.</p></div><div className="model-section-actions">
            {defaultsDirty&&defaults.provider&&defaults.modelId&&<button className="save" disabled={busy} onClick={()=>void saveDefaults()}>Save</button>}</div></div>
          <div className="model-default-grid"><label><span>Model</span><AgentSelect value={defaultModelValue} groups={modelGroups(models)} placement="up"
              placeholder={models.length?'Select model':'Configure a provider first'} onChange={value=>{const [provider,id]=value.split('\u0000');setDefaults(current=>({...current,provider,modelId:id}));}}/></label>
            <label><span>Thinking</span><AgentSelect value={defaults.thinkingLevel} groups={thinkingGroups} placement="up" align="end" placeholder="Select level"
              onChange={value=>setDefaults(current=>({...current,thinkingLevel:value as PiThinkingLevel}))}/></label></div>
        </section>
        <section className="model-section"><div className="model-section-heading"><div><h3>Context Compaction</h3><p>Global settings applied across Pi sessions.</p></div><div className="model-section-actions">
            {compactionDirty&&<button className="save" disabled={busy||!compactionValid} onClick={()=>void saveCompaction()}>Save</button>}</div></div>
          <div className="model-compaction-grid"><label><span>Auto Compact</span><div className="model-setting-switch" role="group" aria-label="Auto Compact"><button className={compaction.enabled?'active':''} onClick={()=>setCompaction(value=>({...value,enabled:true}))}>On</button><button className={!compaction.enabled?'active':''} onClick={()=>setCompaction(value=>({...value,enabled:false}))}>Off</button></div></label>
            <div className="model-compaction-action"><span>Model Overrides</span><button type="button" className="model-overrides-trigger" onClick={()=>setOverrideOpen(true)}><span>{overrideSummary}</span><Icon name="right" size={11}/></button></div>
            <label><span>Reserve Tokens</span><input type="number" min="0" step="1" value={compaction.reserveTokens} onChange={event=>setCompaction(value=>({...value,reserveTokens:Number(event.target.value)}))}/></label>
            <label><span>Keep Recent Tokens</span><input type="number" min="0" step="1" value={compaction.keepRecentTokens} onChange={event=>setCompaction(value=>({...value,keepRecentTokens:Number(event.target.value)}))}/></label></div>
        </section>
      </div>
    </section>
    {overrideOpen&&<div className="agent-nested-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setOverrideOpen(false);}}><section className="agent-chat-modal model-overrides-dialog" role="dialog" aria-modal="true" aria-label="Compaction Model Overrides">
      <header><strong>Model Overrides</strong><button className="agent-icon-button" onClick={()=>setOverrideOpen(false)} aria-label="Close"><Icon name="close" size={14}/></button></header>
      <div className="model-overrides-content"><div className="model-override-editor"><span>Model</span><AgentSelect value={overrideModel} groups={modelGroups(models)} placeholder="Select model" onChange={setOverrideModel}/>
        <span>Reserve Tokens</span><input type="number" min="0" step="1" value={overrideReserve} onChange={event=>setOverrideReserve(event.target.value)}/>
        <span>Keep Recent Tokens</span><input type="number" min="0" step="1" value={overrideKeep} onChange={event=>setOverrideKeep(event.target.value)}/>
        <div className="model-override-actions">{overrideModel&&<button type="button" className="model-override-cancel" onClick={clearOverride}>Cancel</button>}<button type="button" className="agent-primary" disabled={!overrideModel||(!overrideReserve&&!overrideKeep)||(!overrideReserve?false:!validInteger(Number(overrideReserve)))||(!overrideKeep?false:!validInteger(Number(overrideKeep)))} onClick={saveOverride}>{overrideEditing?'Update':'Add'}</button></div></div>
        <div className="model-override-list">{Object.entries(compaction.modelOverrides).length?Object.entries(compaction.modelOverrides).map(([key,value])=><div className="model-override-row" key={key}><span className="model-override-model">{key}</span>
          <span className="model-override-value">Reserve Tokens: {value.reserveTokens??'Inherit'}</span><span className="model-override-value">Keep Recent Tokens: {value.keepRecentTokens??'Inherit'}</span>
          <button type="button" className="model-override-update" onClick={()=>editOverride(key)}>Update</button>
          <button type="button" className="model-override-delete" title="Delete override" aria-label={`Delete ${key} override`} onClick={()=>setCompaction(current=>{const modelOverrides={...current.modelOverrides};delete modelOverrides[key];return {...current,modelOverrides};})}>Delete</button></div>):<p className="agent-empty">No model overrides.</p>}</div></div>
    </section></div>}
  </div>;
}

export default function AgentChat({onOpenSettings,open,projects,activeProjectId,dirtyProjectIds,width,onResize,onResizeEnd,notify,navigationRequest,onNotice,onProjectAdded,onOpenToolDetail,onUpdateToolDetail,onPinSession,onShowPins,onOpenCode,visiblePinSource}:{
  onOpenSettings:()=>void;open:boolean;projects:Project[];activeProjectId:string|null;dirtyProjectIds:ReadonlySet<string>;width:number;
  onResize:(width:number)=>void;onResizeEnd:(width:number)=>void;notify:Notify;
  navigationRequest:AgentNavigationRequest|null;onNotice:(notice:AgentNotice)=>void;
  onProjectAdded:(project:Project)=>Project;
  onOpenToolDetail:(detail:ToolDetailRequest)=>void;onUpdateToolDetail:(detail:ToolDetailRequest)=>void;
  onPinSession:(sessionId:string|null,latest?:PinSource)=>void;onShowPins:(source:PinSource,hide:boolean)=>void;
  onOpenCode:(target:PinTarget)=>void;visiblePinSource?:string;
}){
  const [selectedProjectId,setSelectedProjectId]=useState<string>('');const [selectedSessionId,setSelectedSessionId]=useState<string|null>(null);
  const previousSessionId=useRef<string|null>(null);
  useEffect(()=>{
    if(!selectedSessionId&&previousSessionId.current)void window.revu.agent.leaveSession(previousSessionId.current).then(unwrap).catch(error=>notify('warning',errorMessage(error)));
    previousSessionId.current=selectedSessionId;
  },[selectedSessionId,notify]);
  const [sessions,setSessions]=useState<Record<string,PiSessionSummary[]>>({});const [chats,setChats]=useState<Record<string,ChatState>>({});
  const [draft,setDraft]=useState('');const [sessionDialog,setSessionDialog]=useState(false);const [modelDialog,setModelDialog]=useState(false);
  const [treeDialog,setTreeDialog]=useState(false);
  const [commandMatch,setCommandMatch]=useState<ReturnType<typeof piCommandAt>>(null);
  const [commands,setCommands]=useState<PiSlashCommand[]>([]);const [commandIndex,setCommandIndex]=useState(0);
  const [commandsLoading,setCommandsLoading]=useState(false);const [commandsError,setCommandsError]=useState('');const [commandRevision,setCommandRevision]=useState(0);
  const [cwdDialogs,setCwdDialogs]=useState<import('../shared/piTypes').PiCwdRequest[]>([]);
  const [runtimeRevision,setRuntimeRevision]=useState(0);
  const [runtimeCwd,setRuntimeCwd]=useState('');
  const [questions,setQuestions]=useState<Record<string,PiExtensionRequest[]>>({});
  const questionsRef=useRef(questions);questionsRef.current=questions;
  const questionOwners=useRef(new Map<string,string>());
  const questionDrafts=useRef(new Map<string,{text:string;caret:number}>());
  const [inputWarning,setInputWarning]=useState('');
  const [forkTarget,setForkTarget]=useState<{projectId:string;sessionId:string}|null>(null);
  const [renameTarget,setRenameTarget]=useState<{projectId:string;sessionId:string;name:string}|null>(null);
  const [trustDialogs,setTrustDialogs]=useState<{id?:string;projectId:string;sessionId?:string;trust:PiProjectTrust}[]>([]);
  const queueSubmitting=useRef(false);
  const [modelMenu,setModelMenu]=useState(false);const [models,setModels]=useState<PiModelSummary[]>([]);const [loading,setLoading]=useState(false);
  const [composerExpanded,setComposerExpanded]=useState(false);
  const [queuePanelOpen,setQueuePanelOpen]=useState(false);
  const [usageOpen,setUsageOpen]=useState(false);const [contextOpen,setContextOpen]=useState(false);const [contextOperation,setContextOperation]=useState<'compact'|null>(null);
  const [customCompactOpen,setCustomCompactOpen]=useState(false);const [customCompactInstructions,setCustomCompactInstructions]=useState('');const [customCompactError,setCustomCompactError]=useState('');
  const [contextDetailOpen,setContextDetailOpen]=useState(false);const [contextProjection,setContextProjection]=useState<PiContextProjection>();const [contextProjectionError,setContextProjectionError]=useState('');
  const [sessionInfoOpen,setSessionInfoOpen]=useState(false);const [sessionInfo,setSessionInfo]=useState<PiSessionInfo|undefined>();const [sessionInfoError,setSessionInfoError]=useState('');
  const [compactionResult,setCompactionResult]=useState<PiCompactionResult|undefined>();const [activeRunKey,setActiveRunKey]=useState('');
  const [toolClock,setToolClock]=useState(Date.now());const [retryClock,setRetryClock]=useState(Date.now());
  const [bashHint,setBashHint]=useState(false);
  const [previewRunKey,setPreviewRunKey]=useState('');const [previewTop,setPreviewTop]=useState(8);
  const [openSessionIds,setOpenSessionIds]=useState<Record<string,string[]>>({});
  const [sessionTabCapacity,setSessionTabCapacity]=useState(1);const [sessionMenuOpen,setSessionMenuOpen]=useState(false);const [sessionMenuStyle,setSessionMenuStyle]=useState<React.CSSProperties>({});
  const [statsRunKey,setStatsRunKey]=useState('');const [statsMenuStyle,setStatsMenuStyle]=useState<React.CSSProperties>({});
  const [doneSessionIds,setDoneSessionIds]=useState<Set<string>>(()=>new Set());
  const [sourceMessageKeys,setSourceMessageKeys]=useState<Set<string>>(()=>new Set());const [copiedMessageKey,setCopiedMessageKey]=useState('');
  const [archivedSource,setArchivedSource]=useState<{sessionId:string;text:string}|null>(null);
  const [newChatModel,setNewChatModel]=useState<PiModelSummary|undefined>();const [newChatThinking,setNewChatThinking]=useState<PiThinkingLevel>('medium');
  const [modelMenuStyle,setModelMenuStyle]=useState<React.CSSProperties>({});
  const [mention,setMention]=useState<MentionMatch|null>(null);const [mentionEntries,setMentionEntries]=useState<ProjectPathEntry[]>([]);
  const [mentionIndex,setMentionIndex]=useState(0);const [mentionLoading,setMentionLoading]=useState(false);const [mentionError,setMentionError]=useState('');
  const [fileDragActive,setFileDragActive]=useState(false);const [abortArmed,setAbortArmed]=useState(false);
  const bodyRef=useRef<HTMLDivElement|null>(null);const chatContentRef=useRef<HTMLDivElement|null>(null);const activeSessionTabRef=useRef<HTMLDivElement|null>(null);const sessionTabsRef=useRef<HTMLDivElement|null>(null);
  const sessionMoreRef=useRef<HTMLButtonElement|null>(null);const sessionMoreMenuRef=useRef<HTMLDivElement|null>(null);const statsButtonRef=useRef<HTMLButtonElement|null>(null);const statsMenuRef=useRef<HTMLDivElement|null>(null);
  const modelControlRef=useRef<HTMLDivElement|null>(null);const modelMenuRef=useRef<HTMLDivElement|null>(null);
  const usageRef=useRef<HTMLDivElement|null>(null);const contextRef=useRef<HTMLDivElement|null>(null);const draftConfigRequest=useRef(0);
  const composerRef=useRef<HTMLDivElement|null>(null);const textareaRef=useRef<HTMLTextAreaElement|null>(null);const draftRef=useRef(draft);const mentionRequest=useRef(0);const historyIndex=useRef<number|null>(null);draftRef.current=draft;
  const composerExpansionSource=useRef<'auto'|'manual'|null>(null);const composerManuallyCollapsed=useRef(false);
  const runRefs=useRef(new Map<string,HTMLElement>());const pendingRunKey=useRef<string|undefined>(undefined);const skipAutoScroll=useRef(false);
  const pinMessageRefs=useRef(new Map<string,HTMLElement>());const pendingMessageId=useRef<string|undefined>(undefined);
  const archivedSourceRef=useRef<HTMLElement|null>(null);
  const chatsRef=useRef(chats);const viewRef=useRef({open,selectedSessionId,projects,sessions,openSessionIds});const erroredRuns=useRef(new Set<string>());const notifiedRuns=useRef(new Set<string>());
  const doneTimers=useRef(new Map<string,ReturnType<typeof setTimeout>>());const copiedTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);const abortTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);const bashHintTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const wasOpen=useRef(false);const handledNavigationToken=useRef<number|undefined>(undefined);
  const chatNavigation=useRef(0);
  const [draftProject,setDraftProject]=useState('');
  const sending=useRef(false);
  function prepareDraft(projectId:string){
    const navigation=chatNavigation.current;
    void window.revu.agent.prepareNew(projectId).then(unwrap).catch(error=>{if(navigation===chatNavigation.current)notify('warning',errorMessage(error));});
    setDraftProject(projectId);
  }
  useEffect(()=>{
    if(!draftProject)return;
    if(!open||selectedProjectId!==draftProject||selectedSessionId)setDraftProject('');
    return ()=>{void window.revu.agent.abandonNew(draftProject);};
  },[draftProject,open,selectedProjectId,selectedSessionId]);
  const hasPendingNavigation=!!navigationRequest&&handledNavigationToken.current!==navigationRequest.token;
  chatsRef.current=chats;viewRef.current={open,selectedSessionId,projects,sessions,openSessionIds};
  const clearDone=useCallback((sessionId:string)=>{
    const timer=doneTimers.current.get(sessionId);if(timer)clearTimeout(timer);doneTimers.current.delete(sessionId);
    setDoneSessionIds(current=>{if(!current.has(sessionId))return current;const next=new Set(current);next.delete(sessionId);return next;});
  },[]);
  const markDone=useCallback((sessionId:string)=>{
    const timer=doneTimers.current.get(sessionId);if(timer)clearTimeout(timer);
    setDoneSessionIds(current=>{const next=new Set(current);next.add(sessionId);return next;});
    const view=viewRef.current;
    if(view.open&&view.selectedSessionId===sessionId){
      doneTimers.current.set(sessionId,setTimeout(()=>clearDone(sessionId),3000));
    }
  },[clearDone]);
  const receiveQuestions=useCallback(({projectId,sessionId,requests}:PiExtensionPending)=>{
    questionOwners.current.set(sessionId,projectId);
    const previous=questionsRef.current[sessionId]??[];
    const next={...questionsRef.current,[sessionId]:requests};questionsRef.current=next;setQuestions(next);
    setSessions(state=>({...state,[projectId]:(state[projectId]??[]).map(session=>session.id===sessionId?{...session,question:requests.length>0}:session)}));
    if(requests.length){
      clearDone(sessionId);const view=viewRef.current;
      if(!previous.length&&(!view.open||view.selectedSessionId!==sessionId)){
        const project=view.projects.find(item=>item.id===projectId);const session=(view.sessions[projectId]??[]).find(item=>item.id===sessionId);
        onNotice({level:'info',question:true,projectId,sessionId,message:`Question · ${project?.name??'Project'} / ${titleFor(session,chatsRef.current[sessionId])}\n${requests[0].title}`});
      }
    }else if(previous.length)onNotice({level:'info',question:false,projectId,sessionId,message:''});
  },[onNotice,clearDone]);
  const selectedProject=projects.find(project=>project.id===selectedProjectId);
  const current=selectedSessionId?chats[selectedSessionId]:undefined;
  const currentQuestions=selectedSessionId?(questions[selectedSessionId]??current?.extensionRequests??[]):[];
  const activeQuestion=currentQuestions[0];
  useEffect(()=>{let cancelled=false;setRuntimeCwd('');if(selectedProjectId)void window.revu.agent.getRuntimeCwd(selectedProjectId).then(unwrap).then(cwd=>{if(!cancelled)setRuntimeCwd(cwd);}).catch(error=>{if(!cancelled)notify('warning',errorMessage(error));});return()=>{cancelled=true;};},[selectedProjectId,runtimeRevision]);
  useEffect(()=>{if(current&&questionsRef.current[current.sessionId]===undefined)receiveQuestions({projectId:current.projectId,sessionId:current.sessionId,requests:current.extensionRequests??[]});},[current?.sessionId,current?.extensionRequests,receiveQuestions]);
  useEffect(()=>{let cancelled=false;void window.revu.agent.getExtensionRequests().then(unwrap).then(items=>{if(!cancelled)for(const item of items)if(questionsRef.current[item.sessionId]===undefined)receiveQuestions(item);}).catch(error=>notify('warning',errorMessage(error)));return()=>{cancelled=true;};},[receiveQuestions]);
  useLayoutEffect(()=>{
    if(!selectedSessionId)return;
    if(activeQuestion){
      if(!questionDrafts.current.has(selectedSessionId))questionDrafts.current.set(selectedSessionId,{text:draftRef.current,caret:textareaRef.current?.selectionStart??draftRef.current.length});
      const saved=questionDrafts.current.get(selectedSessionId)!;if(draftRef.current!==saved.text){draftRef.current=saved.text;setDraft(saved.text);}
      setCommandMatch(null);setMention(null);setModelMenu(false);
    }else{
      const saved=questionDrafts.current.get(selectedSessionId);if(!saved)return;questionDrafts.current.delete(selectedSessionId);draftRef.current=saved.text;setDraft(saved.text);
      if(open)requestAnimationFrame(()=>{const input=textareaRef.current;input?.focus();input?.setSelectionRange(saved.caret,saved.caret);});
    }
  },[selectedSessionId,activeQuestion?.id,open]);
  const hasRunningTool=!!current?.tools.some(tool=>tool.status==='running');
  const sessionTabs=openSessionIds[selectedProjectId]??[];
  const projectsWithChats=projects.filter(project=>openSessionIds[project.id]?.length);
  const visibleSessionCount=Math.max(0,sessionTabCapacity-(!selectedSessionId&&selectedProjectId?1:0));
  const visibleSessionTabs=visibleSessionCount?sessionTabs.slice(-visibleSessionCount).reverse():[];
  const runs=useMemo(()=>current?buildRuns(current):[],[current]);const usage=current?.usage??emptyUsage;
  const latestPinSource=useMemo(()=>{
    const latest=current?.messages.slice().reverse().find(message=>record(message).role==='assistant');
    if(!current||!latest)return undefined;
    const messageId=messageKey(latest);
    return runs.flatMap(run=>run.items).find(item=>item.pinSource?.messageId===messageId)?.pinSource
      ??{projectId:current.projectId,sessionId:current.sessionId,messageId,references:[]};
  },[current,runs]);
  useLayoutEffect(()=>{onPinSession(current?.sessionId??null,latestPinSource);},[current?.sessionId,latestPinSource,onPinSession]);
  const queue=current?.queue??EMPTY_QUEUE;const retainedQueue=current?.retainedQueue??EMPTY_QUEUE;
  const liveQueueCount=queue.steering.length+queue.followUp.length;const retainedQueueCount=retainedQueue.steering.length+retainedQueue.followUp.length;
  const queueCount=liveQueueCount+retainedQueueCount;
  const draftBash=directBashCommand(draft);
  const commandOptions=mergePiCommands(commands).filter(item=>!commandMatch?.query||`${item.name} ${item.description??''}`.toLocaleLowerCase().includes(commandMatch.query.toLocaleLowerCase()));
  const queueWarning=piQueueWarning(draft,commands);
  const draftBuiltin=mergePiCommands([]).some(item=>item.name===parsePiCommand(draft.trimEnd())?.name);
  const draftExtension=commands.some(item=>item.source==='extension'&&item.name===parsePiCommand(draft.trimEnd())?.name);
  const bashWarningVisible=!!bashHint&&current?.bash?.status==='running';
  const agentRunning=current?.status==='running';const agentActive=agentRunning||current?.status==='stopping';
  const showQueuePanel=queuePanelOpen||(!!agentActive&&!!draft.trim())||queueCount>0;
  const showQueueToggle=!!selectedProjectId&&!!draft.trim()&&!showQueuePanel;
  const previewRun=runs.find(run=>run.key===previewRunKey);
  const statsRun=runs.find(run=>run.key===statsRunKey);
  const mentionOptions=mention?mentionEntries.map(entry=>({entry,score:fuzzyPathScore(entry,mention.query)}))
    .filter(item=>Number.isFinite(item.score)).sort((a,b)=>a.score-b.score||(a.entry.kind===b.entry.kind?0:a.entry.kind==='directory'?-1:1)||a.entry.path.localeCompare(b.entry.path))
    .slice(0,8).map(item=>item.entry):[];
  useEffect(()=>{
    if(!hasRunningTool)return;
    setToolClock(Date.now());const timer=setInterval(()=>setToolClock(Date.now()),1000);
    return()=>clearInterval(timer);
  },[hasRunningTool,selectedSessionId]);
  useEffect(()=>{if(current?.bash?.status==='running')return;setBashHint(false);if(bashHintTimer.current){clearTimeout(bashHintTimer.current);bashHintTimer.current=undefined;}},[current?.bash?.status,selectedSessionId]);
  const summaryWaiting=current?.summaryOperations.some(operation=>operation.status==='waiting')??false;
  useEffect(()=>{if(!current?.autoRetry&&!summaryWaiting)return;setRetryClock(Date.now());const timer=setInterval(()=>setRetryClock(Date.now()),1000);return()=>clearInterval(timer);},[current?.autoRetry?.deadline,summaryWaiting,current?.sessionId]);
  useEffect(()=>()=>{if(bashHintTimer.current)clearTimeout(bashHintTimer.current);},[]);
  useLayoutEffect(()=>{
    const input=textareaRef.current;if(!input||activeQuestion)return;
    input.style.height='auto';input.style.overflowY='hidden';
    const style=getComputedStyle(input);const lineHeight=Number.parseFloat(style.lineHeight)||20;
    const padding=(Number.parseFloat(style.paddingTop)||0)+(Number.parseFloat(style.paddingBottom)||0);
    const collapsedMin=80;const collapsedMax=Math.ceil(lineHeight*6+padding);const contentHeight=input.scrollHeight;
    const needsExpanded=contentHeight>collapsedMax+1;
    if(!draft){composerExpansionSource.current=null;composerManuallyCollapsed.current=false;if(composerExpanded){setComposerExpanded(false);return;}}
    if(!composerExpanded&&needsExpanded&&!composerManuallyCollapsed.current){composerExpansionSource.current='auto';setComposerExpanded(true);return;}
    if(composerExpanded&&composerExpansionSource.current==='auto'&&!needsExpanded){composerExpansionSource.current=null;setComposerExpanded(false);return;}
    if(composerExpanded){input.style.removeProperty('height');input.style.overflowY='auto';}
    else{input.style.height=`${Math.max(collapsedMin,Math.min(contentHeight,collapsedMax))}px`;input.style.overflowY=needsExpanded?'auto':'hidden';}
  },[draft,width,composerExpanded,activeQuestion?.id]);
  useEffect(()=>{
    if(!current)return;
    for(const tool of current.tools)if(tool.status==='running')onUpdateToolDetail(toolDetail(current,tool,toolClock));
  },[current,toolClock,onUpdateToolDetail]);
  useEffect(()=>{if(!inputWarning)return;const timer=setTimeout(()=>setInputWarning(''),5000);return()=>clearTimeout(timer);},[inputWarning]);
  useEffect(()=>{
    setCommands([]);setCommandsError('');setCommandMatch(null);setCommandIndex(0);
    if(!selectedProjectId||!open||!selectedSessionId&&draftProject!==selectedProjectId)return;
    let cancelled=false;setCommandsLoading(true);
    void window.revu.agent.getCommands(selectedProjectId,selectedSessionId??undefined).then(unwrap).then(items=>{if(!cancelled)setCommands(items);})
      .catch(error=>{if(!cancelled)setCommandsError(errorMessage(error));}).finally(()=>{if(!cancelled)setCommandsLoading(false);});
    return()=>{cancelled=true;};
  },[open,selectedProjectId,selectedSessionId,commandRevision,draftProject]);
  useEffect(()=>{setCommandIndex(0);},[commandMatch?.query,commands]);
  useEffect(()=>{setForkTarget(null);setRenameTarget(null);setInputWarning('');},[selectedProjectId,selectedSessionId]);
  useEffect(()=>{if(commandMatch)composerRef.current?.querySelector('[aria-label="Commands"] [aria-selected="true"]')?.scrollIntoView({block:'nearest'});},[commandMatch,commandIndex]);
  const dirty=selectedProjectId?dirtyProjectIds.has(selectedProjectId):false;
  const reloadSessions=async(projectId:string)=>{
    try{const catalog=await window.revu.agent.listSessions(projectId).then(unwrap);const items=catalog.sessions;setSessions(current=>({...current,[projectId]:items}));return items;}
    catch(error){notify('error',error instanceof Error?error.message:String(error));return [];}
  };
  const openSessionById=async(projectId:string,sessionId:string,targetRunKey?:string,targetMessageId?:string)=>{const request=++chatNavigation.current;setLoading(true);try{
    const snapshot=await window.revu.agent.openSession(projectId,sessionId).then(unwrap);
    const entries=await window.revu.agent.getEntries(projectId,snapshot.sessionId).then(unwrap);
    if(request!==chatNavigation.current)return;
    pendingRunKey.current=targetRunKey;pendingMessageId.current=targetMessageId;
    setChats(current=>{const next={...current,[snapshot.sessionId]:withEntries(withSnapshot(snapshot,current[snapshot.sessionId]),entries)};chatsRef.current=next;return next;});
    setOpenSessionIds(current=>{const ids=current[projectId]??[];const next=[...ids.filter(id=>id!==snapshot.sessionId),snapshot.sessionId];return {...current,[projectId]:next};});
    setSelectedProjectId(projectId);setSelectedSessionId(snapshot.sessionId);setDraft('');setSessionDialog(false);
  }catch(error){if(request===chatNavigation.current){notify('error',errorMessage(error));setModelDialog(true);}}finally{if(request===chatNavigation.current)setLoading(false);}};
  const openSession=async(session:PiSessionSummary,targetRunKey?:string)=>openSessionById(session.projectId,session.id,targetRunKey);
  const openCatalogSession=async(session:PiSessionSummary)=>{
    const project=projects.find(item=>piSessionProjectKey(item.root)===piSessionProjectKey(session.cwd));
    if(session.scope==='current'&&project){await openSessionById(project.id,session.id);return;}
    const request=++chatNavigation.current;setLoading(true);try{
      const response=await window.revu.agent.openDiscoveredSession(session.projectId,session.id).then(unwrap);onProjectAdded(response.project);
      const snapshot=response.snapshot;const entries=await window.revu.agent.getEntries(response.project.id,snapshot.sessionId).then(unwrap);
      if(request!==chatNavigation.current)return;
      setChats(current=>{const next={...current,[snapshot.sessionId]:withEntries(withSnapshot(snapshot,current[snapshot.sessionId]),entries)};chatsRef.current=next;return next;});
      setOpenSessionIds(current=>({...current,[response.project.id]:[...(current[response.project.id]??[]).filter(id=>id!==snapshot.sessionId),snapshot.sessionId]}));
      setSelectedProjectId(response.project.id);setSelectedSessionId(snapshot.sessionId);setDraft('');setSessionDialog(false);
    }catch(error){if(request===chatNavigation.current)notify('error',errorMessage(error));}finally{if(request===chatNavigation.current)setLoading(false);}
  };
  const openSessionInfo=async()=>{
    if(!current)return;setUsageOpen(false);setSessionInfo(undefined);setSessionInfoError('');setSessionInfoOpen(true);
    try{setSessionInfo(await window.revu.agent.getSessionInfo(current.projectId,current.sessionId).then(unwrap));}
    catch(error){setSessionInfoError(errorMessage(error));}
  };
  const loadNewChatDefaults=async(projectId:string)=>{
    const request=++draftConfigRequest.current;
    setModels([]);
    try{
      const defaults=await window.revu.agent.getModelDefaults(projectId).then(unwrap);if(request!==draftConfigRequest.current)return;setNewChatThinking(defaults.thinkingLevel);
      if(!defaults.provider||!defaults.modelId){setNewChatModel(undefined);return;}
      setNewChatModel({provider:defaults.provider,id:defaults.modelId,contextWindow:0,reasoning:false});
      try{const available=await window.revu.agent.listModels(projectId).then(unwrap);if(request!==draftConfigRequest.current)return;setModels(available);
        setNewChatModel(available.find(model=>model.provider===defaults.provider&&model.id===defaults.modelId)
          ??{provider:defaults.provider,id:defaults.modelId,contextWindow:0,reasoning:false});}
      catch{if(request===draftConfigRequest.current)setNewChatModel({provider:defaults.provider,id:defaults.modelId,contextWindow:0,reasoning:false});}
    }catch{if(request===draftConfigRequest.current){setNewChatModel(undefined);setNewChatThinking('medium');}}
  };
  useEffect(()=>{
    if(!selectedProjectId&&activeProjectId)setSelectedProjectId(activeProjectId);
    if(selectedProjectId&&!projects.some(project=>project.id===selectedProjectId)){
      setSelectedProjectId(activeProjectId??projects[0]?.id??'');setSelectedSessionId(null);
    }
  },[activeProjectId,projects,selectedProjectId]);
  const hasSelectedSession=!!selectedSessionId;
  useEffect(()=>{if(open&&selectedProjectId&&hasSelectedSession)void reloadSessions(selectedProjectId);},[open,selectedProjectId,hasSelectedSession]);
  useEffect(()=>{if(open&&sessionDialog&&selectedProjectId)void reloadSessions(selectedProjectId);},[open,sessionDialog,selectedProjectId]);
  useLayoutEffect(()=>{activeSessionTabRef.current?.scrollIntoView({block:'nearest',inline:'nearest'});},[selectedProjectId,selectedSessionId,sessionTabs.length]);
  useLayoutEffect(()=>{const container=sessionTabsRef.current;if(!container)return;const update=()=>setSessionTabCapacity(Math.max(1,Math.floor((container.clientWidth+3)/95)));
    update();const observer=new ResizeObserver(update);observer.observe(container);return()=>observer.disconnect();},[]);
  useEffect(()=>{if(open&&draftProject===selectedProjectId&&selectedProjectId&&!selectedSessionId)void loadNewChatDefaults(selectedProjectId);},[open,draftProject,selectedProjectId,selectedSessionId]);
  useEffect(()=>{
    if(!mention||!selectedProjectId){mentionRequest.current++;setMentionEntries([]);setMentionLoading(false);setMentionError('');return;}
    const request=++mentionRequest.current;setMentionLoading(true);setMentionError('');
    void window.revu.invoke<ProjectPathEntry[]>({action:'chatPaths',projectId:selectedProjectId}).then(result=>{
      if(request!==mentionRequest.current)return;if(!result.ok)throw new Error(result.error||'Could not load project paths.');setMentionEntries(result.value??[]);
    }).catch(error=>{if(request===mentionRequest.current)setMentionError(errorMessage(error));})
      .finally(()=>{if(request===mentionRequest.current)setMentionLoading(false);});
  },[!!mention,selectedProjectId]);
  useEffect(()=>{if(open&&selectedSessionId)clearDone(selectedSessionId);},[open,selectedSessionId,clearDone]);
  useEffect(()=>()=>{for(const timer of doneTimers.current.values())clearTimeout(timer);if(copiedTimer.current)clearTimeout(copiedTimer.current);if(abortTimer.current)clearTimeout(abortTimer.current);},[]);
  useEffect(()=>{if(selectedSessionId)draftConfigRequest.current++;historyIndex.current=null;setMention(null);setAbortArmed(false);if(abortTimer.current)clearTimeout(abortTimer.current);
    composerExpansionSource.current=null;composerManuallyCollapsed.current=false;setComposerExpanded(false);setModelMenu(false);setSessionMenuOpen(false);setStatsRunKey('');setContextOpen(false);setUsageOpen(false);setCompactionResult(undefined);},[selectedSessionId,selectedProjectId]);
  useEffect(()=>{setSessionInfoOpen(false);setSessionInfo(undefined);setSessionInfoError('');},[selectedSessionId]);
  useEffect(()=>{if(!sessionInfoOpen)return;const keydown=(event:KeyboardEvent)=>{if(event.key==='Escape')setSessionInfoOpen(false);};window.addEventListener('keydown',keydown);return()=>window.removeEventListener('keydown',keydown);},[sessionInfoOpen]);
  useEffect(()=>{
    const available=open&&projects.length>0;
    const opening=available&&!wasOpen.current;wasOpen.current=available;
    if(!opening||hasPendingNavigation)return;
    const projectId=activeProjectId??projects[0]?.id??'';if(!projectId)return;
    const request=++chatNavigation.current;
    setSelectedProjectId(projectId);setSelectedSessionId(null);setNewChatModel(undefined);setDraft('');setSessionDialog(false);
    void window.revu.agent.latestSession(projectId).then(unwrap).then(latest=>{
      if(request!==chatNavigation.current)return;
      if(latest)void openSessionById(projectId,latest);else prepareDraft(projectId);
    }).catch(error=>{if(request===chatNavigation.current){notify('warning',errorMessage(error));prepareDraft(projectId);}});
    return()=>{chatNavigation.current++;};
  },[open,projects.length>0]);
  useEffect(()=>{if(!navigationRequest)return;handledNavigationToken.current=navigationRequest.token;
    setArchivedSource(null);
    const target=navigationRequest.messageId&&selectedSessionId===navigationRequest.sessionId?pinMessageRefs.current.get(navigationRequest.messageId):undefined;
    if(target){target.scrollIntoView({block:'start'});target.focus({preventScroll:true});return;}
    void openSessionById(navigationRequest.projectId,navigationRequest.sessionId,navigationRequest.messageId?undefined:navigationRequest.runKey??'__latest__',navigationRequest.messageId);},[navigationRequest?.token]);
  useLayoutEffect(()=>{if(!modelMenu||!modelControlRef.current)return;const trigger=modelControlRef.current.getBoundingClientRect();
    const panel=modelControlRef.current.closest('.agent-chat')?.getBoundingClientRect();const limitLeft=panel?panel.left+8:8;const limitRight=panel?panel.right-8:window.innerWidth-8;
    const width=Math.max(190,Math.min(236,limitRight-limitLeft));const left=Math.max(limitLeft,Math.min(limitRight-width,trigger.right-width));
    setModelMenuStyle({position:'fixed',left,width,bottom:window.innerHeight-trigger.top+7,maxHeight:Math.max(160,Math.min(340,trigger.top-14))});
  },[modelMenu]);
  useEffect(()=>{if(!modelMenu)return;
    const outside=(event:PointerEvent|FocusEvent)=>{const target=event.target as Node;if(!modelControlRef.current?.contains(target)&&!modelMenuRef.current?.contains(target))setModelMenu(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setModelMenu(false);};
    document.addEventListener('pointerdown',outside);document.addEventListener('focusin',outside);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside);document.removeEventListener('keydown',escape);};
  },[modelMenu]);
  useLayoutEffect(()=>{if(!sessionMenuOpen||!sessionMoreRef.current)return;const rect=sessionMoreRef.current.getBoundingClientRect();const panel=sessionMoreRef.current.closest('.agent-chat')?.getBoundingClientRect();
    const left=panel?panel.left+16:16;const width=Math.max(220,(panel?.width??252)-32);const bottom=panel?.bottom??window.innerHeight;
    setSessionMenuStyle({position:'fixed',width,left,top:rect.bottom+5,maxHeight:Math.max(120,bottom-rect.bottom-13)});
  },[sessionMenuOpen,selectedProjectId,sessionTabs.length]);
  useEffect(()=>{if(!sessionMenuOpen)return;const outside=(event:PointerEvent|FocusEvent)=>{const target=event.target as Node;if(!sessionMoreRef.current?.contains(target)&&!sessionMoreMenuRef.current?.contains(target))setSessionMenuOpen(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setSessionMenuOpen(false);};document.addEventListener('pointerdown',outside);document.addEventListener('focusin',outside);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside);document.removeEventListener('keydown',escape);};},[sessionMenuOpen]);
  useLayoutEffect(()=>{if(!statsRunKey||!statsButtonRef.current)return;const rect=statsButtonRef.current.getBoundingClientRect();const bounds=chatContentRef.current?.getBoundingClientRect();
    const width=Math.min(360,Math.max(260,(bounds?.width??376)-16));const limitLeft=(bounds?.left??8)+8;const limitRight=(bounds?.right??window.innerWidth)-8;
    const left=Math.max(limitLeft,Math.min(limitRight-width,rect.right-width));const above=Math.max(0,rect.top-(bounds?.top??8)-7);const below=Math.max(0,(bounds?.bottom??window.innerHeight)-rect.bottom-7);
    setStatsMenuStyle(above>=below?{position:'fixed',width,left,bottom:window.innerHeight-rect.top+5,maxHeight:Math.max(120,above)}:{position:'fixed',width,left,top:rect.bottom+5,maxHeight:Math.max(120,below)});
  },[statsRunKey]);
  useEffect(()=>{if(!statsRunKey)return;const outside=(event:PointerEvent|FocusEvent)=>{const target=event.target as Node;if(!statsButtonRef.current?.contains(target)&&!statsMenuRef.current?.contains(target))setStatsRunKey('');};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setStatsRunKey('');};document.addEventListener('pointerdown',outside);document.addEventListener('focusin',outside);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside);document.removeEventListener('keydown',escape);};},[statsRunKey]);
  useEffect(()=>{if(!usageOpen)return;const outside=(event:PointerEvent|FocusEvent)=>{const target=event.target as Node;if(!usageRef.current?.contains(target))setUsageOpen(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setUsageOpen(false);};document.addEventListener('pointerdown',outside);document.addEventListener('focusin',outside);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside);document.removeEventListener('keydown',escape);};
  },[usageOpen]);
  useEffect(()=>{if(!contextOpen)return;const outside=(event:PointerEvent|FocusEvent)=>{const target=event.target as Node;if(!contextRef.current?.contains(target))setContextOpen(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setContextOpen(false);};document.addEventListener('pointerdown',outside);document.addEventListener('focusin',outside);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside);document.removeEventListener('keydown',escape);};
  },[contextOpen]);
  const updateRunRail=useCallback(()=>{
    const body=bodyRef.current;if(!body)return;const entries=[...runRefs.current.entries()].filter((entry):entry is [string,HTMLElement]=>!!entry[1]);
    if(!entries.length){setActiveRunKey('');return;}
    let active=entries[0][0];const threshold=body.scrollTop+body.clientHeight*.28;
    for(const [key,element] of entries)if(element.offsetTop<=threshold)active=key;
    setActiveRunKey(current=>current===active?current:active);
  },[]);
  useEffect(()=>window.revu.agent.onEvent((event:RevuPiEvent)=>{
    if(event.type==='extension-ui'){receiveQuestions({projectId:event.projectId,sessionId:event.sessionId,requests:event.payload as PiExtensionRequest[]});return;}
    if(event.type==='extension-notify'){
      const payload=event.payload as {level:'info'|'warning'|'error';message:string};const view=viewRef.current;
      if(view.open&&view.selectedSessionId===event.sessionId)notify(payload.level,payload.message);
      else onNotice({...payload,projectId:event.projectId,sessionId:event.sessionId});return;
    }
    if(event.type==='cwd-request'){setCwdDialogs(items=>[...items,event.payload as import('../shared/piTypes').PiCwdRequest]);return;}
    if(event.type==='runtime-changed'){const change=event.payload as import('../shared/piTypes').PiRuntimeChange;setRuntimeRevision(value=>value+1);setCommandRevision(value=>value+1);
      for(const item of change.restarted){const snapshot=item.snapshot;void window.revu.agent.getEntries(snapshot.projectId,snapshot.sessionId).then(unwrap).then(entries=>{setChats(state=>{const next={...state};const previous=next[item.previousId];delete next[item.previousId];next[snapshot.sessionId]=withEntries(withSnapshot(snapshot,previous),entries);chatsRef.current=next;return next;});}).catch(error=>notify('warning',errorMessage(error)));}
      for(const project of viewRef.current.projects)void reloadSessions(project.id);return;
    }
    if(event.type==='trust-request'){
      const request=event.payload as PiTrustRequest;setTrustDialogs(items=>items.some(item=>item.id===request.id)?items:[...items,{...request,projectId:event.projectId}]);return;
    }
    if(event.type==='warning'){notify('warning',String(event.payload));return;}
    if(event.type==='resources-changed'){setCommandRevision(value=>value+1);return;}
    const sendErrorNotice=(message:string)=>{
      erroredRuns.current.add(event.sessionId);const chat=chatsRef.current[event.sessionId];const latest=chat?buildRuns(chat).at(-1):undefined;
      const noticeKey=`${event.sessionId}:${latest?.key??'latest'}:error`;if(notifiedRuns.current.has(noticeKey))return;notifiedRuns.current.add(noticeKey);
      const view=viewRef.current;const project=view.projects.find(item=>item.id===event.projectId);const session=(view.sessions[event.projectId]??[]).find(item=>item.id===event.sessionId);
      onNotice({level:'error',projectId:event.projectId,sessionId:event.sessionId,runKey:latest?.key,
        message:`Pi failed · ${project?.name??'Project'} / ${titleFor(session,chat)}\n${message}`});
    };
    if(event.type==='event'){
      const payload=record(event.payload);
      const chat=chatsRef.current[event.sessionId];if(chat){let updated=updateEvent(chat,event.payload);
        if(payload.type==='queue_update')updated={...updated,queue:{
          steering:Array.isArray(payload.steering)?payload.steering.filter((item):item is string=>typeof item==='string'):[],
          followUp:Array.isArray(payload.followUp)?payload.followUp.filter((item):item is string=>typeof item==='string'):[],
        }};
        const autoRetry=updateAutoRetryState(updated.autoRetry,payload);if(autoRetry!==updated.autoRetry)updated={...updated,autoRetry};
        const next={...chatsRef.current,[event.sessionId]:updated};chatsRef.current=next;setChats(next);
        if(payload.type==='tool_execution_start'||payload.type==='tool_execution_update'||payload.type==='tool_execution_end'){
          const tool=updated.tools.find(item=>item.id===String(payload.toolCallId));if(tool)onUpdateToolDetail(toolDetail(updated,tool));
        }
      }
      if(payload.type==='compaction_start'||payload.type==='compaction_end'){
        const compacting=chatsRef.current[event.sessionId];if(compacting){const next={...chatsRef.current,
          [event.sessionId]:{...compacting,isCompacting:payload.type==='compaction_start'}};chatsRef.current=next;setChats(next);}
        setSessions(current=>({...current,[event.projectId]:(current[event.projectId]??[]).map(session=>session.id===event.sessionId
          ?{...session,isCompacting:payload.type==='compaction_start'}:session)}));
      }
      if(payload.type==='agent_start'){erroredRuns.current.delete(event.sessionId);clearDone(event.sessionId);}
      if(payload.type==='retained_queue_error')notify('error',typeof payload.message==='string'?payload.message:'Could not restore queued messages.');
      if(payload.type==='agent_settled'){
        const settling=chatsRef.current[event.sessionId];if(settling){const key=lastRunKey(settling.messages);const next={...chatsRef.current,
          [event.sessionId]:{...settling,settledRuns:{...settling.settledRuns,[key]:Date.now()}}};chatsRef.current=next;setChats(next);}
        if(viewRef.current.openSessionIds[event.projectId]?.includes(event.sessionId))void Promise.all([window.revu.agent.getSessionSnapshot(event.projectId,event.sessionId).then(unwrap),window.revu.agent.getEntries(event.projectId,event.sessionId).then(unwrap)])
          .then(([snapshot,entries])=>setChats(state=>{const chat=state[event.sessionId];if(!chat)return state;
            const next={...state,[event.sessionId]:withEntries(withSnapshot(snapshot,chat),entries)};chatsRef.current=next;return next;})).catch(()=>{});
      }
      const ended=record(payload.message);
      if(payload.type==='message_end'&&ended.role==='assistant'&&ended.stopReason==='error'){
        const message=typeof ended.errorMessage==='string'?ended.errorMessage:'The model response failed.';sendErrorNotice(message);
        const failed=chatsRef.current[event.sessionId];if(failed){const next={...chatsRef.current,[event.sessionId]:{...failed,error:message}};chatsRef.current=next;setChats(next);}
      }
      if(payload.type==='agent_settled'&&!payload.aborted&&!erroredRuns.current.has(event.sessionId)){
        markDone(event.sessionId);
        const chat=chatsRef.current[event.sessionId];const latest=chat?buildRuns(chat).at(-1):undefined;
        const noticeKey=`${event.sessionId}:${latest?.key??'latest'}:success`;const view=viewRef.current;
        if((!view.open||view.selectedSessionId!==event.sessionId)&&!notifiedRuns.current.has(noticeKey)){
          notifiedRuns.current.add(noticeKey);const project=view.projects.find(item=>item.id===event.projectId);
          const session=(view.sessions[event.projectId]??[]).find(item=>item.id===event.sessionId);const answer=latest?finalAnswer(latest).replace(/\s+/g,' ').trim():'';
          onNotice({level:'success',projectId:event.projectId,sessionId:event.sessionId,runKey:latest?.key,
            message:`Pi finished · ${project?.name??'Project'} / ${titleFor(session,chat)}${answer?`\n${answer.slice(0,180)}`:''}`});
        }
      }
    }
    if(event.type==='status'){
      const status=event.payload as PiRuntimeStatus;
      if(status==='starting'||status==='running'||status==='stopping'||status==='error')clearDone(event.sessionId);
      const chat=chatsRef.current[event.sessionId];if(chat){const next={...chatsRef.current,[event.sessionId]:{...chat,status,error:status==='running'?undefined:chat.error}};chatsRef.current=next;setChats(next);}
      setSessions(current=>({...current,[event.projectId]:(current[event.projectId]??[]).map(session=>session.id===event.sessionId?{...session,status}:session)}));
    }
    if(event.type==='usage'){
      const chat=chatsRef.current[event.sessionId];if(chat){const next={...chatsRef.current,[event.sessionId]:{...chat,usage:event.payload as PiUsageStats}};chatsRef.current=next;setChats(next);}
    }
    if(event.type==='bash'){
      const bash=event.payload as PiDirectBashState;const chat=chatsRef.current[event.sessionId];
      if(chat){
        const finished=bash.status==='running'?undefined:bash;
        const history=finished?((chat.bashHistory??[]).some(item=>item.command===finished.command&&item.startedAt===finished.startedAt)?chat.bashHistory??[]:[...(chat.bashHistory??[]),finished]):chat.bashHistory;
        const next={...chatsRef.current,[event.sessionId]:finished?{...chat,bash:undefined,bashHistory:history}:{...chat,bash}};
        chatsRef.current=next;setChats(next);
      }
    }
    if(event.type==='retained-queue'){
      const retainedQueue=event.payload as PiQueueState;const chat=chatsRef.current[event.sessionId];if(chat){const next={...chatsRef.current,[event.sessionId]:{...chat,retainedQueue}};chatsRef.current=next;setChats(next);}
    }
    if(event.type==='error'){
      clearDone(event.sessionId);
      const message=typeof event.payload==='string'?event.payload:'Pi Agent failed.';sendErrorNotice(message);
      const currentChat=chatsRef.current[event.sessionId];if(currentChat){const next={...chatsRef.current,[event.sessionId]:{
        ...currentChat,status:'error' as const,error:message,summaryOperations:updateSummaryOperations(currentChat.summaryOperations,{type:'summary_interrupted',errorMessage:message},lastRunKey(currentChat.messages))}};chatsRef.current=next;setChats(next);}
      setSessions(current=>({...current,[event.projectId]:(current[event.projectId]??[]).map(session=>session.id===event.sessionId?{...session,status:'error'}:session)}));
    }
    if(event.type==='sessions-changed')void reloadSessions(event.projectId);
  }),[onNotice,markDone,clearDone,onUpdateToolDetail,receiveQuestions]);
  useLayoutEffect(()=>{
    const body=bodyRef.current;if(!body)return;const frame=requestAnimationFrame(updateRunRail);const observer=new ResizeObserver(updateRunRail);observer.observe(body);
    for(const element of runRefs.current.values())observer.observe(element);body.addEventListener('scroll',updateRunRail,{passive:true});
    return()=>{cancelAnimationFrame(frame);observer.disconnect();body.removeEventListener('scroll',updateRunRail);};
  },[selectedSessionId,width,current?.messages,current?.streamText,current?.streamThinking,current?.tools,current?.summaryOperations,updateRunRail]);
  useLayoutEffect(()=>{const requested=pendingRunKey.current;if(!requested)return;const key=requested==='__latest__'?runs.at(-1)?.key:requested;
    const element=key?runRefs.current.get(key):undefined;if(key&&element&&bodyRef.current){skipAutoScroll.current=true;bodyRef.current.scrollTo({top:Math.max(0,element.offsetTop-12)});setActiveRunKey(key);}
    pendingRunKey.current=undefined;
  },[selectedSessionId,runs.length]);
  useLayoutEffect(()=>{
    const requested=pendingMessageId.current;if(!requested)return;
    pendingMessageId.current=undefined;
    const element=pinMessageRefs.current.get(requested);
    if(!element){
      const sourceEntry=current?.entries.find(entry=>entry.type==='message'&&messageKey(entry.message)===requested);
      if(sourceEntry&&current){skipAutoScroll.current=true;setArchivedSource({sessionId:current.sessionId,text:messageText(sourceEntry.message)});}
      else notify('warning','The source message is no longer available.');
      return;
    }
    skipAutoScroll.current=true;
    element.scrollIntoView({block:'start'});element.focus({preventScroll:true});
  },[selectedSessionId,current?.entries,notify]);
  useLayoutEffect(()=>{
    if(archivedSource?.sessionId!==selectedSessionId)return;
    archivedSourceRef.current?.scrollIntoView({block:'start'});archivedSourceRef.current?.focus({preventScroll:true});
  },[archivedSource,selectedSessionId]);
  useEffect(()=>{if(skipAutoScroll.current){skipAutoScroll.current=false;return;}bodyRef.current?.scrollTo({top:bodyRef.current.scrollHeight});},[current?.messages,current?.streamText,current?.streamThinking,current?.tools,current?.summaryOperations]);
  const startNewChat=()=>{if(!selectedProjectId)return;chatNavigation.current++;setLoading(false);prepareDraft(selectedProjectId);
    setSelectedSessionId(null);setDraft('');setSessionDialog(false);
    composerExpansionSource.current=null;composerManuallyCollapsed.current=false;setComposerExpanded(false);};
  const closeSessionTab=(sessionId:string)=>{
    const tabs=openSessionIds[selectedProjectId]??[];const index=tabs.indexOf(sessionId);const remaining=tabs.filter(id=>id!==sessionId);
    setOpenSessionIds(current=>({...current,[selectedProjectId]:remaining}));
    void window.revu.agent.releaseSession(selectedProjectId,sessionId).then(unwrap).catch(error=>notify('error',errorMessage(error)));
    if(selectedSessionId!==sessionId)return;const next=remaining[Math.min(index,remaining.length-1)]??remaining.at(-1);
    if(next)void openSessionById(selectedProjectId,next);else startNewChat();
  };
  const closeOtherSessionTabs=(sessionId:string)=>{const tabs=openSessionIds[selectedProjectId]??[];const closing=tabs.filter(id=>id!==sessionId);
    setOpenSessionIds(current=>({...current,[selectedProjectId]:[sessionId]}));for(const id of closing)void window.revu.agent.releaseSession(selectedProjectId,id).then(unwrap).catch(error=>notify('error',errorMessage(error)));
    if(selectedSessionId!==sessionId)void openSessionById(selectedProjectId,sessionId);
  };
  const closeAllSessionTabs=()=>{const tabs=openSessionIds[selectedProjectId]??[];setOpenSessionIds(current=>({...current,[selectedProjectId]:[]}));
    for(const id of tabs)void window.revu.agent.releaseSession(selectedProjectId,id).then(unwrap).catch(error=>notify('error',errorMessage(error)));startNewChat();
  };
  const sessionTabContext=async(event:React.MouseEvent,sessionId:string)=>{const action=await showContextMenu(event,[{id:'close',label:'Close'},{id:'closeOthers',label:'Close Others'},{id:'closeAll',label:'Close All'}] as const);
    if(action==='close')closeSessionTab(sessionId);if(action==='closeOthers')closeOtherSessionTabs(sessionId);if(action==='closeAll')closeAllSessionTabs();};
  const closeNewChatTab=()=>{const next=(openSessionIds[selectedProjectId]??[]).at(-1);if(next)void openSessionById(selectedProjectId,next);};
  const focusComposer=(caret:number)=>requestAnimationFrame(()=>{const input=textareaRef.current;if(!input||selectedSessionId&&questionsRef.current[selectedSessionId]?.length)return;input.focus();input.setSelectionRange(caret,caret);});
  const updateDraftAt=(text:string,caret:number)=>{historyIndex.current=null;draftRef.current=text;setDraft(text);setMention(mentionAt(text,caret));setMentionIndex(0);setCommandMatch(piCommandAt(text,caret));setCommandIndex(0);focusComposer(caret);};
  const insertReferences=(paths:string[],start?:number,end?:number)=>{
    if(!selectedProject||!paths.length)return;const value=draftRef.current;const input=textareaRef.current;const from=start??input?.selectionStart??value.length;const to=end??input?.selectionEnd??from;
    const before=value.slice(0,from);const after=value.slice(to);const references=paths.map(path=>fileReference(path,selectedProject.root)).join(' ');
    const leading=before&&!/[\s(（]$/.test(before)?' ':'';const trailing=/^\s/.test(after)?'':' ';
    updateDraftAt(`${before}${leading}${references}${trailing}${after}`,before.length+leading.length+references.length+trailing.length);
  };
  const chooseFiles=async()=>{if(!selectedProjectId)return;try{const paths=await window.revu.chooseChatFiles(selectedProjectId);insertReferences(paths,draftRef.current.length,draftRef.current.length);}catch(error){notify('error',errorMessage(error));}};
  const insertCommandTrigger=()=>{
    setMention(null);setCommandIndex(0);
    if(!draft){updateDraftAt('/',1);return;}
    const match=/^\/[^\s]*/.exec(draft);if(match){focusComposer(match[0].length);setCommandMatch(piCommandAt(draft,match[0].length));}
    else{setCommandMatch({query:'',end:0});textareaRef.current?.focus();}
  };
  const acceptCommand=(command:PiSlashCommand,execute=false)=>{
    if(!commandMatch)return;const after=draft.slice(commandMatch.end);const next=`/${command.name}${after.startsWith(' ')?'':' '}${after}`;
    if(execute){historyIndex.current=null;draftRef.current=next;setDraft(next);setMention(null);setCommandMatch(null);if(command.source==='builtin'){void executeBuiltin(next.trimEnd());return;}void sendCommand(next);return;}
    updateDraftAt(next,command.name.length+2);setCommandMatch(null);
  };
  const insertMentionTrigger=()=>{
    const input=textareaRef.current;const start=input?.selectionStart??draft.length;const end=input?.selectionEnd??start;const before=draft.slice(0,start);const prefix=before&&!/[\s(（]$/.test(before)?' @':'@';
    const next=`${before}${prefix}${draft.slice(end)}`;updateDraftAt(next,before.length+prefix.length);
  };
  const acceptMention=(entry:ProjectPathEntry)=>{
    if(!mention||!selectedProject)return;const reference=fileReference(entry.path,selectedProject.root);const after=draft.slice(mention.end);const trailing=/^\s/.test(after)?'':' ';
    updateDraftAt(`${draft.slice(0,mention.start)}${reference}${trailing}${after}`,mention.start+reference.length+trailing.length);setMention(null);
  };
  const pathsForFiles=async(files:File[])=>{
    const paths:string[]=[];
    for(const file of files){let path='';try{path=window.revu.filePath(file);}catch{}
      if(path){paths.push(path);continue;}if(!file.type.startsWith('image/'))continue;
      paths.push(await window.revu.saveChatImage(file.type,new Uint8Array(await file.arrayBuffer())));
    }
    return paths;
  };
  const pasteFiles=(event:React.ClipboardEvent<HTMLTextAreaElement>)=>{
    const files=[...event.clipboardData.files];if(!files.length)return;event.preventDefault();const start=event.currentTarget.selectionStart;const end=event.currentTarget.selectionEnd;
    void pathsForFiles(files).then(paths=>insertReferences(paths,start,end)).catch(error=>notify('error',errorMessage(error)));
  };
  const dropFiles=(event:React.DragEvent<HTMLElement>)=>{
    if(!event.dataTransfer.files.length)return;event.preventDefault();setFileDragActive(false);const files=[...event.dataTransfer.files];
    void pathsForFiles(files).then(paths=>insertReferences(paths,draftRef.current.length,draftRef.current.length)).catch(error=>notify('error',errorMessage(error)));
  };
  const browseHistory=(direction:-1|1)=>{
    if(mention||commandMatch)return false;const items=savedInputHistory();if(!items.length)return false;let index=historyIndex.current;
    if(index===null){if(direction>0||draft)return false;index=items.length-1;}else index+=direction;
    if(index>=items.length){historyIndex.current=null;setDraft('');setMention(null);focusComposer(0);return true;}
    index=Math.max(0,index);historyIndex.current=index;setDraft(items[index]);setMention(null);focusComposer(items[index].length);return true;
  };
  const queueDraft=async(kind:'steering'|'followUp')=>{
    if(!selectedProjectId||!current||!draft.trim()||directBashCommand(draft))return;
    if(queueWarning){setInputWarning(queueWarning);return;}if(queueSubmitting.current)return;const text=draft;queueSubmitting.current=true;
    try{
      if(current.status==='running'){
        if(kind==='steering')await window.revu.agent.steer(selectedProjectId,current.sessionId,text).then(unwrap);
        else await window.revu.agent.followUp(selectedProjectId,current.sessionId,text).then(unwrap);
      }else{
        const pending=chatsRef.current[current.sessionId]?.retainedQueue??retainedQueue;
        const staged=kind==='steering'?{steering:[text],followUp:[]}:{steering:[],followUp:[text]};
        const saved=await window.revu.agent.setRetainedQueue(selectedProjectId,current.sessionId,mergePiQueues(pending,staged)).then(unwrap);
        setChats(state=>{const chat=state[current.sessionId];if(!chat)return state;
          const updated={...state,[current.sessionId]:{...chat,retainedQueue:saved}};chatsRef.current=updated;return updated;});
      }
      rememberInput(text);
      if(draftRef.current===text){historyIndex.current=null;setMention(null);setCommandMatch(null);draftRef.current='';setDraft('');focusComposer(0);}
    }catch(error){notify('warning',errorMessage(error));}finally{queueSubmitting.current=false;}
  };
  const clearPendingQueue=async()=>{
    if(!selectedProjectId||!current||!queueCount)return;
    try{await window.revu.agent.clearQueue(selectedProjectId,current.sessionId).then(unwrap);setQueuePanelOpen(false);}
    catch(error){notify('error',errorMessage(error));}
  };
  const ensureChatSession=async()=>{
    if(current)return current;if(!selectedProjectId)throw new Error('Open a project before starting Pi.');
    const navigation=chatNavigation.current;let snapshot=await window.revu.agent.newSession(selectedProjectId).then(unwrap);
    if(newChatModel&&(!snapshot.model||snapshot.model.provider!==newChatModel.provider||snapshot.model.id!==newChatModel.id))
      snapshot=await window.revu.agent.setModel(selectedProjectId,snapshot.sessionId,newChatModel.provider,newChatModel.id).then(unwrap);
    if(snapshot.thinkingLevel!==newChatThinking)snapshot=await window.revu.agent.setThinkingLevel(selectedProjectId,snapshot.sessionId,newChatThinking).then(unwrap);
    const session=withSnapshot(snapshot);setChats(state=>({...state,[snapshot.sessionId]:session}));
    setOpenSessionIds(value=>({...value,[selectedProjectId]:[...(value[selectedProjectId]??[]).filter(id=>id!==snapshot.sessionId),snapshot.sessionId]}));
    if(navigation===chatNavigation.current)setSelectedSessionId(snapshot.sessionId);return session;
  };
  const executeDirectBash=async(spec:{command:string;excludeFromContext:boolean})=>{
    if(!selectedProjectId)return;
    if(current?.bash?.status==='running'){
      setBashHint(true);
      if(bashHintTimer.current)clearTimeout(bashHintTimer.current);
      bashHintTimer.current=setTimeout(()=>setBashHint(false),5000);
      return;
    }
    if(bashHintTimer.current){clearTimeout(bashHintTimer.current);bashHintTimer.current=undefined;}
    setBashHint(false);const text=draft;historyIndex.current=null;setMention(null);draftRef.current='';setDraft('');focusComposer(0);
    try{
      const session=await ensureChatSession();rememberInput(text);await window.revu.agent.bash(selectedProjectId,session.sessionId,spec.command,spec.excludeFromContext).then(unwrap);
      const [snapshot,entries]=await Promise.all([window.revu.agent.getSessionSnapshot(selectedProjectId,session.sessionId).then(unwrap),window.revu.agent.getEntries(selectedProjectId,session.sessionId).then(unwrap)]);
      setChats(state=>{const next={...state,[session.sessionId]:withEntries(withSnapshot(snapshot,state[session.sessionId]),entries)};chatsRef.current=next;return next;});
    }catch(error){if(!draftRef.current)updateDraftAt(text,text.length);notify('error',errorMessage(error));}
  };
  const submitInput=()=>{if(parsePiCommand(draft.trimEnd())&&draftBuiltin){void executeBuiltin(draft.trimEnd());return;}const bash=directBashCommand(draft);if(bash){void executeDirectBash(bash);return;}if(agentRunning)void queueDraft('steering');else void send();};
  const sendCommand=async(text:string)=>{if(!selectedProjectId)return;const warning=agentRunning?piQueueWarning(text,commands):undefined;if(warning){setInputWarning(warning);return;}
    if(dirty&&!agentRunning){notify('warning','Save unsaved files before running Pi.');return;}
    let sessionId:string|undefined;let cleared=false;
    try{const session=await ensureChatSession();sessionId=session.sessionId;
      if(draftRef.current===text){cleared=true;draftRef.current='';setDraft('');setCommandMatch(null);}
      if(agentRunning)await window.revu.agent.steer(selectedProjectId,session.sessionId,text).then(unwrap);else await window.revu.agent.prompt(selectedProjectId,session.sessionId,text).then(unwrap);rememberInput(text);
    }catch(error){if(cleared&&!draftRef.current&&viewRef.current.selectedSessionId===sessionId){draftRef.current=text;setDraft(text);}notify('warning',errorMessage(error));}};
  const send=async()=>{if(sending.current||!selectedProjectId||!draft.trim()||dirty||(!current&&!newChatModel&&!draftExtension))return;sending.current=true;const text=draft;historyIndex.current=null;setMention(null);setDraft('');
    try{
      const session=await ensureChatSession();await window.revu.agent.prompt(selectedProjectId,session.sessionId,text).then(unwrap);rememberInput(text);
    }
    catch(error){setDraft(text);notify('error',error instanceof Error?error.message:String(error));}finally{sending.current=false;}
  };
  const setRetained=async(kind:'steering'|'followUp',index:number,value?:string)=>{
    if(!selectedProjectId||!current)return false;const warning=value===undefined?undefined:piQueueWarning(value,commands);if(warning){setInputWarning(warning);return false;}const next=updatePiQueueItem(retainedQueue,kind,index,value);
    try{const saved=await window.revu.agent.setRetainedQueue(selectedProjectId,current.sessionId,next).then(unwrap);setChats(state=>{
      const chat=state[current.sessionId];if(!chat)return state;const updated={...state,[current.sessionId]:{...chat,retainedQueue:saved}};chatsRef.current=updated;return updated;});return true;}
    catch(error){notify('warning',errorMessage(error));return false;}
  };
  const sendRetained=async(kind:'steering'|'followUp',index:number,message:string)=>{
    if(!selectedProjectId||!current)return;if(agentActive||current.isCompacting){setInputWarning('Wait for the session to finish before sending this prompt.');return;}const next=updatePiQueueItem(retainedQueue,kind,index);
    try{const saved=await window.revu.agent.setRetainedQueue(selectedProjectId,current.sessionId,next).then(unwrap);setChats(state=>{
      const chat=state[current.sessionId];if(!chat)return state;const updated={...state,[current.sessionId]:{...chat,retainedQueue:saved}};chatsRef.current=updated;return updated;});
      await window.revu.agent.prompt(selectedProjectId,current.sessionId,message).then(unwrap);rememberInput(message);
    }catch(error){notify('error',errorMessage(error));}
  };
  const appendRetained=(message:string)=>updateDraftAt(draft?`${draft}\n${message}`:message,(draft?`${draft}\n${message}`:message).length);
  const replaceRetained=async(kind:'steering'|'followUp',index:number)=>{if(!draft.trim()||queueWarning||queueSubmitting.current)return;const value=draft;queueSubmitting.current=true;
    try{if(await setRetained(kind,index,value)&&draftRef.current===value){draftRef.current='';setDraft('');setCommandMatch(null);focusComposer(0);}}finally{queueSubmitting.current=false;}};
  const toggleDirectBash=()=>{if(!draft.startsWith('!'))rememberInput(draft);const next=toggleDirectBashInput(draft);updateDraftAt(next,next.startsWith('!!')?Math.max(2,(textareaRef.current?.selectionStart??1)+1):1);};
  const stop=async()=>{if(!current||!selectedProjectId)return;setAbortArmed(false);if(abortTimer.current)clearTimeout(abortTimer.current);
    try{await window.revu.agent.stop(selectedProjectId,current.sessionId).then(unwrap);}catch(error){notify('error',error instanceof Error?error.message:String(error));}};
  const abortBash=async()=>{if(!current||!selectedProjectId)return;try{await window.revu.agent.abortBash(selectedProjectId,current.sessionId).then(unwrap);}
    catch(error){notify('error',errorMessage(error));}};
  const cancelRetry=async()=>{if(!current||!selectedProjectId||!current.autoRetry)return;
    if(retryCancelOperation(current.autoRetry)==='abortAgent'){void stop();return;}setChats(state=>{const chat=state[current.sessionId];if(!chat?.autoRetry)return state;
      const next={...state,[current.sessionId]:{...chat,autoRetry:{...chat.autoRetry,cancelling:true}}};chatsRef.current=next;return next;});
    try{await window.revu.agent.abortRetry(selectedProjectId,current.sessionId).then(unwrap);}catch(error){notify('error',errorMessage(error));}};
  const confirmAbort=()=>{if(abortArmed){void stop();return;}setAbortArmed(true);if(abortTimer.current)clearTimeout(abortTimer.current);
    abortTimer.current=setTimeout(()=>setAbortArmed(false),2000);};
  const applyContextSnapshot=(snapshot:PiSessionSnapshot)=>setChats(state=>{const chat=state[snapshot.sessionId];if(!chat)return state;
    const next={...state,[snapshot.sessionId]:withSnapshot(snapshot,chat)};chatsRef.current=next;return next;});
  const compactContext=async(customInstructions?:string)=>{if(!current||!selectedProjectId||contextOperation)return;setContextOperation('compact');setCompactionResult(undefined);setCustomCompactError('');try{
    const response=await window.revu.agent.compact(selectedProjectId,current.sessionId,customInstructions).then(unwrap);applyContextSnapshot(response.snapshot);setCompactionResult(response.result);
    if(customInstructions!==undefined){setCustomCompactOpen(false);setCustomCompactInstructions('');}
  }catch(error){const message=errorMessage(error);if(customInstructions!==undefined)setCustomCompactError(message);else notify('error',message);}finally{setContextOperation(null);}};
  const openContextDetail=async()=>{if(!current||!selectedProjectId)return;setContextOpen(false);setContextDetailOpen(true);setContextProjection(undefined);setContextProjectionError('');
    try{setContextProjection(await window.revu.agent.getContextProjection(selectedProjectId,current.sessionId).then(unwrap));}
    catch(error){setContextProjectionError(errorMessage(error));}};
  const openContextJson=()=>{if(!current||!contextProjection)return;
    onOpenToolDetail({id:`context:${current.sessionId}`,projectId:current.projectId,sessionId:current.sessionId,toolCallId:'context-projection',
      fileName:`normalized-context-${current.sessionId.slice(0,8)}.json`,
      content:messageJson({model:contextProjection.model,thinkingLevel:contextProjection.thinkingLevel,messages:contextProjection.messages})});};
  const openSummaryJson=(operation:SummaryOperation)=>{if(!current)return;
    onOpenToolDetail({id:`summary:${current.sessionId}:${operation.id}`,projectId:current.projectId,sessionId:current.sessionId,toolCallId:operation.id,
      fileName:`${operation.kind}-${operation.id}.summary.json`,content:messageJson(operation)});};
  const openSourceJson=(source:PiSessionEntry,messages:unknown[])=>{if(!current)return;
    onOpenToolDetail({id:`entry:${current.sessionId}:${source.id}`,projectId:current.projectId,sessionId:current.sessionId,toolCallId:source.id,
      fileName:`${source.type}-${source.id.slice(0,8)}.json`,content:messageJson({sourceEntry:source,messages})});};
  const loadModels=async()=>{if(!selectedProjectId)return;try{setModels(await window.revu.agent.listModels(selectedProjectId,current?.sessionId).then(unwrap));setModelMenu(true);}
    catch(error){setModels([]);notify('error',error instanceof Error?error.message:String(error));setModelMenu(true);}};
  const setModel=async(model:PiModelSummary)=>{if(!selectedProjectId)return;if(!current){setNewChatModel(model);return;}try{
    const snapshot=await window.revu.agent.setModel(selectedProjectId,current.sessionId,model.provider,model.id).then(unwrap);
    setChats(state=>({...state,[snapshot.sessionId]:withSnapshot(snapshot,state[snapshot.sessionId])}));
  }catch(error){notify('error',error instanceof Error?error.message:String(error));}};
  const setThinking=async(level:PiThinkingLevel)=>{if(!selectedProjectId)return;if(!current){setNewChatThinking(level);return;}try{
    const snapshot=await window.revu.agent.setThinkingLevel(selectedProjectId,current.sessionId,level).then(unwrap);
    setChats(state=>({...state,[snapshot.sessionId]:withSnapshot(snapshot,state[snapshot.sessionId])}));
  }catch(error){notify('error',error instanceof Error?error.message:String(error));}};
  const beginResize=(event:React.PointerEvent)=>{event.currentTarget.setPointerCapture(event.pointerId);const start=event.clientX;const initial=width;let latest=initial;
    const move=(moveEvent:PointerEvent)=>{latest=Math.max(320,Math.min(720,initial+start-moveEvent.clientX));onResize(latest);};
    const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up);onResizeEnd(latest);};
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',up);
  };
  const selectedModel=current?.model??newChatModel;const selectedThinking=current?.thinkingLevel??newChatThinking;
  const thinkingOptions=(current?.availableThinkingLevels??THINKING_LEVELS).map(level=>({value:level,label:level}));
  const groupedModels=modelGroups(models);const contextWindow=usage.contextWindow??selectedModel?.contextWindow??0;const contextTokens=usage.contextTokens??0;
  const remainingContext=Math.max(0,contextWindow-contextTokens);
  const showRunPreview=(event:React.MouseEvent<HTMLButtonElement>|React.FocusEvent<HTMLButtonElement>,key:string)=>{
    const content=chatContentRef.current;if(content){const marker=event.currentTarget.getBoundingClientRect();const bounds=content.getBoundingClientRect();
      setPreviewTop(Math.max(8,Math.min(marker.top-bounds.top-8,bounds.height-128)));}setPreviewRunKey(key);
  };
  const copyMessage=async(key:string,text:string)=>{
    try{
      if(!await window.revu.copyText(text)){notify('error','Could not copy the message.');return;}
      setCopiedMessageKey(key);if(copiedTimer.current)clearTimeout(copiedTimer.current);
      copiedTimer.current=setTimeout(()=>setCopiedMessageKey(current=>current===key?'':current),1500);
    }catch{notify('error','Could not copy the message.');}
  };
  const toggleMessageSource=(key:string)=>setSourceMessageKeys(current=>{
    const next=new Set(current);if(next.has(key))next.delete(key);else next.add(key);return next;
  });
  const adoptCreatedSession=async(projectId:string,snapshot:PiSessionSnapshot,draftText:string)=>{
    const entries=await window.revu.agent.getEntries(projectId,snapshot.sessionId).then(unwrap);
    setChats(current=>{const next={...current,[snapshot.sessionId]:withEntries(withSnapshot(snapshot),entries)};chatsRef.current=next;return next;});
    setOpenSessionIds(current=>{const ids=current[projectId]??[];return ids.includes(snapshot.sessionId)?current:{...current,[projectId]:[...ids,snapshot.sessionId]};});
    setSelectedProjectId(projectId);setSelectedSessionId(snapshot.sessionId);setDraft(draftText);setSessionDialog(false);await reloadSessions(projectId);
  };
  const adoptTreeNavigation=async(response:PiTreeNavigationResponse)=>{
    const entries=await window.revu.agent.getEntries(response.snapshot.projectId,response.snapshot.sessionId).then(unwrap);
    setChats(current=>{const next={...current,[response.snapshot.sessionId]:withEntries(withSnapshot(response.snapshot,current[response.snapshot.sessionId]),entries)};chatsRef.current=next;return next;});
    setDraft(response.editorText??'');setTreeDialog(false);await reloadSessions(response.snapshot.projectId);
  };
  const forkRun=async(run:ChatRun)=>{
    if(!current||!run.userEntryId)return;
    try{const response=await window.revu.agent.forkSession(current.projectId,current.sessionId,run.userEntryId).then(unwrap);await adoptCreatedSession(current.projectId,response.snapshot,response.selectedText);}
    catch(error){notify('error',errorMessage(error));}
  };
  const cloneSession=async(session:PiSessionSummary)=>{
    try{const snapshot=await window.revu.agent.cloneSession(session.projectId,session.id).then(unwrap);await adoptCreatedSession(session.projectId,snapshot,'');}
    catch(error){notify('error',errorMessage(error));}
  };
  const exportSession=async(session:PiSessionSummary)=>{
    try{const path=await window.revu.agent.exportHtml(session.projectId,session.id).then(unwrap);if(path)notify('info','Conversation exported.');}
    catch(error){notify('error',errorMessage(error));}
  };
  const executeBuiltin=async(text:string)=>{
    const command=parsePiCommand(text);if(!command||!selectedProjectId)return;
    if(UNSUPPORTED_PI_COMMANDS.has(command.name)){notify('warning',`/${command.name} is not supported in Revu yet.`);return;}
    const needsSession=['name','session','tree','fork','clone','copy','reload'].includes(command.name);
    if(needsSession&&!current){notify('warning','Open a session before using this command.');return;}
    if(['model','thinking','scoped-models','tree','fork','clone','reload'].includes(command.name)&&(agentActive||current?.isCompacting||current?.bash?.status==='running')){
      notify('warning','Wait for the session to finish before using this command.');return;
    }
    try{
      switch(command.name){
        case 'model':case 'thinking':case 'scoped-models':await loadModels();break;
        case 'settings':onOpenSettings();break;
        case 'new':startNewChat();break;
        case 'resume':setSessionDialog(true);break;
        case 'name':setRenameTarget({projectId:selectedProjectId,sessionId:current!.sessionId,name:command.args.trim()||titleFor((sessions[selectedProjectId]??[]).find(session=>session.id===current!.sessionId),current!)});break;
        case 'session':await openSessionInfo();break;
        case 'tree':setTreeDialog(true);break;
        case 'fork':setForkTarget({projectId:selectedProjectId,sessionId:current!.sessionId});break;
        case 'clone':{
          const snapshot=await window.revu.agent.cloneSession(selectedProjectId,current!.sessionId).then(unwrap);await adoptCreatedSession(selectedProjectId,snapshot,'');break;
        }
        case 'compact':setContextOpen(true);break;
        case 'copy':{
          const last=[...current!.messages].reverse().find(message=>{const item=record(message);return item.role==='assistant'&&!(item.stopReason==='aborted'&&Array.isArray(item.content)&&!item.content.length);});
          const value=messageText(last).trim();if(!value){notify('warning','No assistant message to copy.');return;}
          if(!await window.revu.copyText(value))throw new Error('Could not copy the message.');notify('info','Copied last assistant message.');break;
        }
        case 'trust':{
          const trust=await window.revu.agent.getProjectTrust(selectedProjectId,current?.sessionId).then(unwrap);
          setTrustDialogs(items=>[...items,{projectId:selectedProjectId,sessionId:current?.sessionId,trust}]);break;
        }
        case 'reload':{
          const snapshot=await window.revu.agent.reloadResources(selectedProjectId,current!.sessionId).then(unwrap);applyContextSnapshot(snapshot);setCommandRevision(value=>value+1);notify('info','Pi resources reloaded.');break;
        }
      }
      historyIndex.current=null;rememberInput(text);setCommandMatch(null);setMention(null);
      if(draftRef.current.trimEnd()===text){draftRef.current='';setDraft('');}
      if(['new','clone','copy','reload'].includes(command.name))focusComposer(0);
    }catch(error){notify('warning',errorMessage(error));}
  };
  const closeTrust=async()=>{
    const dialog=trustDialogs[0];if(!dialog)return;
    try{if(dialog.id)await window.revu.agent.respondProjectTrust(dialog.id,null).then(unwrap);setTrustDialogs(items=>items.slice(1));}
    catch(error){notify('warning',errorMessage(error));}
  };
  const saveTrust=async(choice:PiTrustChoice)=>{
    const dialog=trustDialogs[0];if(!dialog)return;
    if(dialog.id)await window.revu.agent.respondProjectTrust(dialog.id,choice).then(unwrap);
    else{
      const response=await window.revu.agent.saveProjectTrust(dialog.projectId,choice,dialog.sessionId).then(unwrap);
      for(const item of response.restarted){const snapshot=item.snapshot;
        const entries=await window.revu.agent.getEntries(snapshot.projectId,snapshot.sessionId).then(unwrap);
        setChats(state=>{const next={...state};const previous=next[item.previousId];delete next[item.previousId];next[snapshot.sessionId]=withEntries(withSnapshot(snapshot,previous),entries);chatsRef.current=next;return next;});
        setOpenSessionIds(state=>({...state,[snapshot.projectId]:(state[snapshot.projectId]??[]).map(id=>id===item.previousId?snapshot.sessionId:id)}));
        setSelectedSessionId(id=>id===item.previousId?snapshot.sessionId:id);
      }
      await reloadSessions(dialog.projectId);setCommandRevision(value=>value+1);
    }
    setTrustDialogs(items=>items.slice(1));
  };
  return <>
    <aside className={`agent-chat ${open?'open':''} ${fileDragActive?'file-drag-active':''}`} style={{width:open?width:0}} aria-hidden={!open}
      onDragEnter={event=>{if(event.dataTransfer.types.includes('Files'))setFileDragActive(true);}}
      onDragOver={event=>{if(!event.dataTransfer.types.includes('Files'))return;event.preventDefault();event.dataTransfer.dropEffect='copy';setFileDragActive(true);}}
      onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setFileDragActive(false);}}
      onDrop={dropFiles}>
      <div className="agent-resize-handle" onPointerDown={beginResize}/>
      <header className="agent-chat-header"><button className="agent-project-trigger" disabled={!projects.length} onClick={()=>setSessionDialog(true)}>
        <span>{selectedProject?.name??'No Project'}</span><Icon name="down" size={11}/></button>
        <div className="agent-session-tabs" ref={sessionTabsRef} role="tablist" aria-label="Open chats">{visibleSessionTabs.map(sessionId=>{
          const summary=(sessions[selectedProjectId]??[]).find(item=>item.id===sessionId);const chat=chats[sessionId];const active=selectedSessionId===sessionId;
          const tone=sessionTone(chat?.status??summary?.status??'idle',doneSessionIds.has(sessionId),questions[sessionId]!==undefined?questions[sessionId].length>0:summary?.question);return <div ref={active?activeSessionTabRef:undefined} className={`agent-session-tab status-${tone} ${active?'active':''}`} key={sessionId}
            onContextMenu={event=>void sessionTabContext(event,sessionId)}>
            <button role="tab" aria-selected={selectedSessionId===sessionId} title={titleFor(summary,chat)} onClick={()=>void openSessionById(selectedProjectId,sessionId)}>{titleFor(summary,chat)}</button>
            <button className="agent-session-tab-close" title="Close Chat" aria-label={`Close ${titleFor(summary,chat)}`} onClick={()=>closeSessionTab(sessionId)}><Icon name="close" size={10}/></button>
          </div>;})}
          {!selectedSessionId&&selectedProjectId&&<div ref={activeSessionTabRef} className="agent-session-tab active new"><button role="tab" aria-selected="true">New Chat</button>
            {!!sessionTabs.length&&<button className="agent-session-tab-close" title="Close Chat" aria-label="Close New Chat" onClick={closeNewChatTab}><Icon name="close" size={10}/></button>}</div>}
        </div>
        <button ref={sessionMoreRef} className="agent-icon-button agent-session-more" title="Open Chats" aria-label="Open chats" aria-haspopup="listbox" aria-expanded={sessionMenuOpen}
          disabled={!projectsWithChats.length} onClick={()=>setSessionMenuOpen(value=>!value)}><Icon name="more" size={15}/></button>
        <button className="agent-icon-button agent-new-chat" title="New Chat" disabled={!selectedProjectId||loading} onClick={startNewChat}><Icon name="add" size={15}/></button></header>
      <div className="agent-chat-content" ref={chatContentRef}>
        <nav className="agent-run-rail" aria-label="Runs"><div><div className="agent-run-markers">{runs.map((run,index)=><button key={run.key}
          className={run.key===activeRunKey?'active':''} aria-label={`Go to run ${index+1}`}
          onMouseEnter={event=>showRunPreview(event,run.key)} onMouseLeave={()=>setPreviewRunKey('')}
          onFocus={event=>showRunPreview(event,run.key)} onBlur={()=>setPreviewRunKey('')} onClick={()=>{const element=runRefs.current.get(run.key);if(element&&bodyRef.current)bodyRef.current.scrollTo({top:Math.max(0,element.offsetTop-12),behavior:'smooth'});}}/>)}
          <button className="agent-run-tree" disabled={!current} title="Session Tree" aria-label="Open session tree" onClick={()=>setTreeDialog(true)}><Icon name="tree" size={13}/></button></div></div></nav>
        {previewRun&&<aside className="agent-run-preview" style={{top:previewTop}}><strong>{previewRun.user||'Run'}</strong><p>{finalAnswer(previewRun)||'Pi is still working…'}</p></aside>}
        <div className="agent-chat-body" ref={bodyRef}>{!projects.length?<div className="agent-welcome"><strong>Open a folder to start</strong></div>
        :!current?null
        :<>{archivedSource?.sessionId===current.sessionId&&<section className="agent-archived-source" tabIndex={-1} ref={archivedSourceRef}>
          <header><strong>Source from another branch</strong><button className="agent-icon-button" title="Close Source" aria-label="Close Source" onClick={()=>setArchivedSource(null)}><Icon name="close" size={12}/></button></header>
          <MarkdownContent text={archivedSource.text}/>
        </section>}{runs.map(run=>{const messageKey=`${current.sessionId}:${run.key}`;const answerText=assistantText(run);const showSource=sourceMessageKeys.has(messageKey);
          const latest=run.key===runs.at(-1)?.key;const showActions=shouldShowAssistantActions(latest,current.status);
          const autoRetry=latest?current.autoRetry:undefined;
          const retrying=!!autoRetry&&retryClock>=autoRetry.deadline;
          const answerIndex=run.items.reduce((last,item,index)=>item.type==='answer'?index:last,-1);
          const contentItems=answerIndex<0?run.items:run.items.slice(0,answerIndex+1);
          const trailingItems=answerIndex<0?[]:run.items.slice(answerIndex+1);
          const footerSource=run.items[answerIndex]?.pinSource;
          const pinButton=(source?:PinSource)=>{
            if(!source?.references.length)return null;
            const hide=visiblePinSource===source.messageId;
            const title=hide?'Hide code annotations':'Show code annotations';
            return <button type="button" title={title} aria-label={title} onClick={()=>onShowPins(source,hide)}><Icon name={hide?'hide':'pin'} size={14}/></button>;
          };
          const renderItem=(part:RunItem)=>{
            if(part.summary)return <SummaryCard key={part.summary.id} operation={part.summary} now={summaryWaiting?retryClock:Date.now()} onOpenJson={openSummaryJson} onToggle={()=>requestAnimationFrame(updateRunRail)}/>;
            if(part.type==='answer'){
              const partKey=`${current.sessionId}:${part.pinSource?.messageId??part.key}`;
              const partSource=sourceMessageKeys.has(partKey);
              return <div key={part.key} className="agent-answer-part" tabIndex={part.lastAnswerPart?-1:undefined}
                ref={part.lastAnswerPart&&part.pinSource?element=>{const id=part.pinSource!.messageId;if(element)pinMessageRefs.current.set(id,element);else pinMessageRefs.current.delete(id);}:undefined}>
                {part.streaming||showSource||partSource?<div className={'agent-answer source '+(part.streaming?'streaming':'')}>{part.text}</div>
                  :<MarkdownContent text={part.text??''} references={part.pinSource?.references} onCodeReference={reference=>{
                    if(part.pinSource)onOpenCode({source:part.pinSource,reference});
                  }}/>}
                {part.lastAnswerPart&&footerSource!==part.pinSource&&!!part.pinSource?.references.length
                  &&<div className="agent-message-actions" aria-label="Assistant message actions">
                    <button type="button" title={partSource?'Show Preview':'Show Source'} aria-label={partSource?'Show Markdown preview':'Show Markdown source'}
                      aria-pressed={partSource} onClick={()=>toggleMessageSource(partKey)}><Icon name="format" size={14}/></button>
                    {pinButton(part.pinSource)}
                  </div>}
              </div>;
            }
            if(part.type==='thinking')return <details className="agent-thinking" key={part.key} open={part.streaming||undefined} onToggle={()=>requestAnimationFrame(updateRunRail)}><summary title="Toggle thought process"><Icon name="thought" size={16}/><span>Thought process</span></summary><div>{part.text}</div></details>;
            if(part.type==='fallback')return <details className="agent-unknown-message" key={part.key} onToggle={()=>requestAnimationFrame(updateRunRail)}><summary><span>Unsupported message</span><code>{part.label}</code>
              <small>{part.text||'Raw message data is available.'}</small></summary><pre>{messageJson(part.raw)}</pre></details>;
            if(part.type==='bash'&&part.bash)return <BashCard bash={part.bash} key={part.key} onAbort={part.bash.status==='running'?()=>void abortBash():undefined} onToggle={()=>requestAnimationFrame(updateRunRail)}/>;
            if(part.type==='custom'||part.type==='branchSummary'||part.type==='compactionSummary')return <TimelineSummaryCard item={part} key={part.key} onToggle={()=>requestAnimationFrame(updateRunRail)}/>;
            if(part.tool)return <ToolCard key={part.key} tool={part.tool} now={toolClock} onOpenDetail={()=>onOpenToolDetail(toolDetail(current,part.tool!,toolClock))} onToggle={()=>requestAnimationFrame(updateRunRail)}/>;
            return null;
          };
          return <section className="agent-run" key={run.key} ref={element=>{if(element)runRefs.current.set(run.key,element);else runRefs.current.delete(run.key);}}>
          {run.user&&<article className="agent-message user"><div className="agent-user-bubble">{run.user}</div>
            <footer className="agent-user-meta">{run.userTimestamp!==undefined&&<time dateTime={new Date(run.userTimestamp).toISOString()} title={formatFullTime(run.userTimestamp)}>{formatTime(run.userTimestamp)}</time>}
              <button type="button" title={copiedMessageKey===messageKey+'-user'?'Copied':'Copy'} aria-label="Copy user message" onClick={()=>void copyMessage(messageKey+'-user',run.user)}>
                <Icon name={copiedMessageKey===messageKey+'-user'?'check':'copy'} size={12}/></button>
              <button type="button" disabled={!run.userEntryId||!['idle','error'].includes(current.status)||current.isCompacting} title={run.userEntryId?'Fork from this message':'Fork unavailable'} aria-label="Fork from this message" onClick={()=>void forkRun(run)}>
                <Icon name="fork" size={12}/></button>
            </footer></article>}
          {(!!run.items.length||showActions||!!autoRetry)&&<div className="agent-response">{run.items.some(item=>item.type!=='bash')&&<span className="agent-role" role="img" aria-label="Pi"><Icon name="pi" size={16}/></span>}{contentItems.map(renderItem)}
            {autoRetry&&<div className="agent-auto-retry" role="status"><div><strong>Auto Retry</strong><span>{retrying?`Retrying ${autoRetry.attempt}/${autoRetry.maxAttempts}…`:`Retry ${autoRetry.attempt}/${autoRetry.maxAttempts} in ${Math.max(0,Math.ceil((autoRetry.deadline-retryClock)/1000))}s`}</span></div>
              <div><span title={autoRetry.errorMessage}>{autoRetry.errorMessage}</span><button type="button" disabled={!!autoRetry.cancelling} onClick={()=>void cancelRetry()}>{autoRetry.cancelling?'Cancelling…':retrying?'Stop':'Cancel'}</button></div></div>}
            {((showActions&&answerIndex>=0)||!!run.stopReason)&&<div className="agent-response-footer">{showActions&&<div className="agent-message-actions" aria-label="Assistant message actions">
                <button type="button" disabled={!answerText} title={copiedMessageKey===messageKey+'-assistant'?'Copied':'Copy'} aria-label="Copy assistant message"
                  onClick={()=>void copyMessage(messageKey+'-assistant',answerText)}><Icon name={copiedMessageKey===messageKey+'-assistant'?'check':'copy'} size={14}/></button>
                <button type="button" disabled={!answerText} title={showSource?'Show Preview':'Show Source'} aria-label={showSource?'Show Markdown preview':'Show Markdown source'}
                  aria-pressed={showSource} onClick={()=>toggleMessageSource(messageKey)}><Icon name="format" size={14}/></button>
                {pinButton(footerSource)}
                <button type="button" disabled title="Retry · Coming soon" aria-label="Retry · Coming soon"><Icon name="retry" size={14}/></button>
                <button type="button" disabled title="More · Coming soon" aria-label="More · Coming soon"><Icon name="more" size={14}/></button>
              </div>}<div className="agent-response-meta">{run.stopReason&&<span className={`agent-stop-reason ${run.stopReason}`}>{stopReasonLabel(run.stopReason)}</span>}
                {showActions&&answerText&&<button ref={statsRunKey===run.key?statsButtonRef:undefined} type="button" className="agent-run-stats-button" title="View run details" aria-haspopup="dialog" aria-expanded={statsRunKey===run.key}
                  onClick={()=>setStatsRunKey(current=>current===run.key?'':run.key)}>{runStatsSummary(run)}</button>}</div></div>}{trailingItems.map(renderItem)}</div>}
        </section>;})}
          {current.error&&<div className="agent-inline-error">{current.error}</div>}</>}
        </div>
      </div>
      {Object.entries(questions).flatMap(([sessionId,requests])=>requests[0]?[<ExtensionQuestionnaire key={sessionId+':'+(requests[0].group?.id??requests[0].id)} requests={requests} active={open&&selectedSessionId===sessionId}
        onReply={(id,reply)=>window.revu.agent.respondExtensionUI(questionOwners.current.get(sessionId)!,sessionId,id,reply).then(unwrap)}/>]:[])}
      <div ref={composerRef} style={activeQuestion?{display:'none'}:undefined} className={`agent-composer ${composerExpanded?'expanded':''} ${showQueuePanel?'queues-visible':''} ${draft.startsWith('!')?'bash-mode':''}`}>{bashWarningVisible&&<div className="agent-bash-warning" role="status"><span>Warning: A bash command is already running. Stop it before running another.</span></div>}
        {inputWarning&&<div className="agent-bash-warning" role="status">{inputWarning}</div>}
        {dirty&&!draft.startsWith('!')&&!draftBuiltin&&<div className="agent-dirty-warning">Save unsaved files before running Pi.</div>}
        {showQueuePanel&&<div className="agent-input-queues" aria-label="Queued messages">
          <div className="agent-input-queue-row"><Icon name="steering" size={17}/><div className="agent-input-queue-messages">
            {queue.steering.map((message,index)=><QueueMessage message={message} key={`live-${index}:${message}`}/>)}
            {retainedQueue.steering.map((message,index)=><QueueMessage retained message={message} key={`retained-${index}:${message}`} replaceDisabled={!draft.trim()||!!queueWarning||commandsLoading}
              onAppend={()=>appendRetained(message)} onReplace={()=>replaceRetained('steering',index)} onDelete={()=>void setRetained('steering',index)} onSend={()=>void sendRetained('steering',index,message)}/>)}</div>
            <button type="button" className="agent-input-queue-submit" disabled={!current||!draft.trim()||!!draftBash} title={agentRunning?'Steer the current run (Enter)':'Add to steering queue (Ctrl+Enter)'} onClick={()=>void queueDraft('steering')}>
              <Icon name="steeringButton" size={16}/><span>Steering</span></button></div>
          <div className="agent-input-queue-row"><Icon name="followUp" size={15}/><div className="agent-input-queue-messages">
            {queue.followUp.map((message,index)=><QueueMessage message={message} key={`live-${index}:${message}`}/>)}
            {retainedQueue.followUp.map((message,index)=><QueueMessage retained message={message} key={`retained-${index}:${message}`} replaceDisabled={!draft.trim()||!!queueWarning||commandsLoading}
              onAppend={()=>appendRetained(message)} onReplace={()=>replaceRetained('followUp',index)} onDelete={()=>void setRetained('followUp',index)} onSend={()=>void sendRetained('followUp',index,message)}/>)}</div>
            <button type="button" className="agent-input-queue-submit" disabled={!current||!draft.trim()||!!draftBash} title={agentRunning?'Queue follow-up (Alt+Enter)':'Add to follow-up queue (Alt+Enter)'} onClick={()=>void queueDraft('followUp')}>
              <Icon name="followUpButton" size={16}/><span>FollowUp</span></button></div>
        </div>}
        {commandMatch&&<div className="agent-path-menu agent-command-menu" role="listbox" aria-label="Commands">
          {commandOptions.map((command,index)=><button key={command.name} title={command.description} type="button" role="option" aria-selected={index===commandIndex}
            className={[index===commandIndex?'selected':'',command.source==='builtin'&&UNSUPPORTED_PI_COMMANDS.has(command.name)?'unsupported':''].filter(Boolean).join(' ')} onMouseDown={event=>event.preventDefault()} onMouseEnter={()=>setCommandIndex(index)} onClick={()=>acceptCommand(command)}>
            <Icon name={command.source==='skill'?'skillItem':command.source==='extension'?'extensionItem':command.source==='prompt'?'promptItem':'commandItem'} size={16}/>
            <span><strong>/{command.name}</strong><small>{command.description}</small></span></button>)}
          {commandsLoading&&<div className="agent-path-empty">Loading commands…</div>}
          {commandsError&&<div className="agent-path-empty error">{commandsError}</div>}
          {!commandOptions.length&&!commandsLoading&&!commandsError&&<div className="agent-path-empty">No commands found</div>}
        </div>}
        {mention&&<div className="agent-path-menu" role="listbox" aria-label="Project files and folders">
          {mentionLoading?<div className="agent-path-empty">Searching…</div>:mentionError?<div className="agent-path-empty error">{mentionError}</div>
            :mentionOptions.length?mentionOptions.map((entry,index)=><button type="button" role="option" aria-selected={index===mentionIndex}
              className={index===mentionIndex?'selected':''} title={entry.path} key={`${entry.kind}:${entry.path}`}
              onMouseDown={event=>{event.preventDefault();acceptMention(entry);}}>
              <Icon name={entry.kind==='directory'?'chatFolder':'chatFile'} size={15}/><span>{entry.path}</span></button>)
            :<div className="agent-path-empty">No matching files or folders</div>}
        </div>}
        {selectedProjectId&&draft.length>0&&!bashWarningVisible&&<button className="agent-composer-expand" title={composerExpanded?'Collapse Input':'Expand Input'} aria-label={composerExpanded?'Collapse Input':'Expand Input'}
          onClick={()=>{if(composerExpanded){composerExpansionSource.current=null;composerManuallyCollapsed.current=true;setComposerExpanded(false);}
            else{composerExpansionSource.current='manual';composerManuallyCollapsed.current=false;setComposerExpanded(true);}}}><Icon name={composerExpanded?'collapse':'expand'} size={15}/></button>}
        <textarea ref={textareaRef} value={draft} disabled={!selectedProjectId} placeholder="" onPaste={event=>void pasteFiles(event)}
          onBlur={event=>{if(!composerRef.current?.contains(event.relatedTarget as Node|null)){setMention(null);setCommandMatch(null);}}}
          onSelect={event=>{setMention(mentionAt(draft,event.currentTarget.selectionStart));setCommandMatch(piCommandAt(draft,event.currentTarget.selectionStart));}}
          onChange={event=>{historyIndex.current=null;draftRef.current=event.target.value;setDraft(event.target.value);setMention(mentionAt(event.target.value,event.target.selectionStart));setMentionIndex(0);setCommandMatch(piCommandAt(event.target.value,event.target.selectionStart));setCommandIndex(0);}}
          onKeyDown={event=>{
            if(commandMatch){
              if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setCommandIndex(index=>commandOptions.length?(index+(event.key==='ArrowDown'?1:-1)+commandOptions.length)%commandOptions.length:0);return;}
              if(event.key==='Escape'){event.preventDefault();setCommandMatch(null);return;}
              if((event.key==='Enter'||event.key==='Tab')&&!event.shiftKey&&!event.ctrlKey&&!event.altKey&&commandOptions[commandIndex]){event.preventDefault();acceptCommand(commandOptions[commandIndex],event.key==='Enter');return;}
            }
            if(mention){
              if(event.key==='ArrowDown'){event.preventDefault();if(mentionOptions.length)setMentionIndex(index=>Math.min(mentionOptions.length-1,index+1));return;}
              if(event.key==='ArrowUp'){event.preventDefault();if(mentionOptions.length)setMentionIndex(index=>Math.max(0,index-1));return;}
              if(event.key==='Escape'){event.preventDefault();setMention(null);return;}
              if(event.key==='Enter'&&!event.shiftKey&&!event.ctrlKey&&!event.altKey&&mentionOptions[mentionIndex]){event.preventDefault();acceptMention(mentionOptions[mentionIndex]);return;}
            }
            if(event.key==='Escape'&&agentRunning){event.preventDefault();confirmAbort();return;}
            if(event.key==='ArrowUp'&&browseHistory(-1)){event.preventDefault();return;}
            if(event.key==='ArrowDown'&&historyIndex.current!==null&&browseHistory(1)){event.preventDefault();return;}
            if(event.key==='Enter'&&!event.shiftKey){
              event.preventDefault();const bash=!!directBashCommand(draft);
              if(bash){if(!event.ctrlKey&&!event.altKey)submitInput();return;}
              if(event.ctrlKey&&!event.altKey){void queueDraft('steering');return;}
              if(event.altKey&&!event.ctrlKey){void queueDraft('followUp');return;}
              submitInput();
            }
          }}/>
        {showQueueToggle&&<button type="button" className="agent-input-queue-toggle" title="Show Queue" aria-label="Show queued messages" onClick={()=>setQueuePanelOpen(true)}><Icon name="queue" size={14}/></button>}
        {showQueuePanel&&queueCount>0&&<button type="button" className="agent-input-queue-clear" title="Clear Queue" aria-label="Clear queued messages" onClick={()=>void clearPendingQueue()}><Icon name="clear" size={13}/></button>}
        <footer><div className="agent-reference-actions">
          <button type="button" title="Commands" aria-label="Commands" disabled={!selectedProjectId} onMouseDown={event=>event.preventDefault()} onClick={insertCommandTrigger}><Icon name="commands" size={14}/></button>
          <button type="button" title="Mention File or Folder" aria-label="Mention file or folder" disabled={!selectedProjectId} onClick={insertMentionTrigger}><Icon name="mention" size={14}/></button>
          <button type="button" title="Choose File" aria-label="Choose file" disabled={!selectedProjectId} onClick={()=>void chooseFiles()}><Icon name="chatAdd" size={18}/></button>
          <button type="button" title={draft.startsWith('!')&&!draft.startsWith('!!')?'Exclude Bash result from context':'Direct Bash'} aria-label="Toggle Direct Bash mode" disabled={!selectedProjectId} onClick={toggleDirectBash}>
            <Icon name={draft.startsWith('!')&&!draft.startsWith('!!')?'directBashExcluded':'directBash'} size={14}/></button>
        </div><div className="agent-model-control" ref={modelControlRef}
            onBlur={event=>{const next=event.relatedTarget as Node|null;if(!event.currentTarget.contains(next)&&!modelMenuRef.current?.contains(next))setModelMenu(false);}}><button className="agent-footer-select-trigger"
              aria-haspopup="listbox" aria-expanded={modelMenu} disabled={!selectedProjectId||current?.status==='running'} onClick={()=>modelMenu?setModelMenu(false):void loadModels()}>
          {selectedModel?`${selectedModel.id} · ${selectedThinking}`:'Select Model'}<Icon name="down" size={11}/></button></div>
          {current?.status==='running'||current?.status==='stopping'?<button className="agent-send stop" onClick={()=>void stop()}>{abortArmed?'Abort ?':<><Icon name="stop" size={14}/>Stop</>}</button>
            :<button className="agent-send" disabled={!selectedProjectId||!draft.trim()||(!draftBash&&!draftBuiltin&&((!selectedModel&&!draftExtension)||dirty))||!!current?.bash} onClick={submitInput}><Icon name="send" size={14}/>Send</button>}</footer>
      </div>
      {selectedProjectId&&<div className="agent-session-meta"><span className="agent-project-path" title={current?.cwd??runtimeCwd}>{current?.cwd??(runtimeCwd||'Checking…')}</span>
        <div className="agent-context-control" ref={contextRef}><button className="agent-context-summary" aria-haspopup="dialog" aria-expanded={contextOpen} onClick={()=>setContextOpen(value=>!value)}>{formatContextPercent(usage.contextPercent)}</button>
          {contextOpen&&<section className="agent-context-popover" role="dialog" aria-label="Context usage"><header><strong>Context</strong><span>{(current?.isCompacting||contextOperation==='compact')&&'Compacting…'}</span>
            <button className="agent-icon-button" title="Context Detail" aria-label="Open context detail" disabled={!current} onClick={()=>void openContextDetail()}><Icon name="detail" size={13}/></button></header>
            <dl><div><dt>Used</dt><dd>{contextTokens.toLocaleString()}</dd></div><div><dt>Window</dt><dd>{contextWindow.toLocaleString()}</dd></div><div><dt>Remaining</dt><dd>{remainingContext.toLocaleString()}</dd></div></dl>
            <div className="agent-context-actions"><button className="agent-compact-now" disabled={!current||!!contextOperation||current.status==='running'||current.status==='stopping'||current.isCompacting} onClick={()=>void compactContext()}>{contextOperation==='compact'||current?.isCompacting?'Compacting…':'Compact Now'}</button>
              <button className="agent-compact-now" disabled={!current||!!contextOperation||current.status==='running'||current.status==='stopping'||current.isCompacting} onClick={()=>{setContextOpen(false);setCustomCompactError('');setCustomCompactOpen(true);}}>Custom Compact</button></div>
            {compactionResult&&<p className="agent-compaction-result">Compacted {formatAgentTokens(compactionResult.tokensBefore)}{compactionResult.estimatedTokensAfter!=null?` → ~${formatAgentTokens(compactionResult.estimatedTokensAfter)}`:''}{compactionResult.cost!=null?` · $${compactionResult.cost.toFixed(4)}`:''}</p>}
          </section>}
        </div>
        <div className="agent-usage-control" ref={usageRef}><button className="agent-usage-summary" aria-haspopup="dialog" aria-expanded={usageOpen} onClick={()=>setUsageOpen(value=>!value)}>
          In {formatAgentTokens(usage.input)} <span>Out {formatAgentTokens(usage.output)}</span> <span>R {formatAgentTokens(usage.cacheRead)}</span> <span>CH {usage.cacheHitPercent.toFixed(2)}%</span> <span>${usage.cost.toFixed(4)}</span>
        </button>{usageOpen&&<section className="agent-usage-popover" role="dialog" aria-label="Session usage">
          <header><strong>Session Usage</strong><button className="agent-icon-button session-info-trigger" title="Session Info" aria-label="Open session info" onClick={()=>void openSessionInfo()}><Icon name="detail" size={14}/></button></header><dl>
            <div><dt>Input</dt><dd>{usage.input.toLocaleString()}</dd></div><div><dt>Output</dt><dd>{usage.output.toLocaleString()}</dd></div>
            <div><dt>Cache read</dt><dd>{usage.cacheRead.toLocaleString()}</dd></div><div><dt>Cache write</dt><dd>{usage.cacheWrite.toLocaleString()}</dd></div>
            <div><dt>Cache hit</dt><dd>{usage.cacheHitPercent.toFixed(2)}%</dd></div><div><dt>Total tokens</dt><dd>{usage.total.toLocaleString()}</dd></div>
            <div><dt>Runs</dt><dd>{usage.runs}</dd></div><div><dt>Tool calls</dt><dd>{usage.toolCalls}</dd></div><div><dt>Cost</dt><dd>${usage.cost.toFixed(6)}</dd></div>
          </dl></section>}</div>
      </div>}

      {renameTarget&&<RenameSessionDialog key={renameTarget.sessionId} name={renameTarget.name} onClose={()=>{setRenameTarget(null);focusComposer(draftRef.current.length);}} onSave={async name=>{
        await window.revu.agent.renameSession(renameTarget.projectId,renameTarget.sessionId,name).then(unwrap);
        setChats(state=>({...state,[renameTarget.sessionId]:{...state[renameTarget.sessionId],name}}));await reloadSessions(renameTarget.projectId);
      }}/>}
      {sessionInfoOpen&&<div className="agent-chat-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setSessionInfoOpen(false);}}>
        <section className="agent-chat-modal session-info-dialog" role="dialog" aria-modal="true" aria-label="Session Info">
          <header><strong>Session Info</strong><button className="agent-icon-button" onClick={()=>setSessionInfoOpen(false)} aria-label="Close"><Icon name="close" size={14}/></button></header>
          <div className="session-info-content">{sessionInfoError?<p className="agent-empty">{sessionInfoError}</p>:!sessionInfo?<p className="agent-empty">Loading session information…</p>:<>
            <section className="session-info-identity"><dl>{sessionInfo.name&&<div><dt>Name</dt><dd>{sessionInfo.name}</dd></div>}<div><dt>File</dt><dd className="session-info-file" title={sessionInfo.file}>{sessionInfo.file}</dd></div><div><dt>ID</dt><dd>{sessionInfo.id}</dd></div></dl></section>
            <section><h3>Messages</h3><dl><div><dt>Total</dt><dd>{sessionInfo.messages.total.toLocaleString()}</dd></div><div><dt>User</dt><dd>{sessionInfo.messages.user.toLocaleString()}</dd></div><div><dt>Assistant</dt><dd>{sessionInfo.messages.assistant.toLocaleString()}</dd></div><div><dt>Tools</dt><dd>{sessionInfo.messages.toolCalls.toLocaleString()} calls, {sessionInfo.messages.toolResults.toLocaleString()} results</dd></div></dl></section>
            <section><h3>Tokens</h3><dl><div><dt>Input</dt><dd>{sessionInfo.tokens.input.toLocaleString()}</dd></div>{(sessionInfo.tokens.cached>0||sessionInfo.tokens.cacheWrite>0)&&<><div className="nested"><dt>Cached</dt><dd>{sessionInfo.tokens.cached.toLocaleString()} ({sessionInfo.tokens.cachePercent.toFixed(1)}%)</dd></div><div className="nested"><dt>Uncached</dt><dd>{sessionInfo.tokens.uncached.toLocaleString()}{sessionInfo.tokens.cacheWrite>0&&<span> ({sessionInfo.tokens.cacheWrite.toLocaleString()} written to cache)</span>}</dd></div></>}<div><dt>Output</dt><dd>{sessionInfo.tokens.output.toLocaleString()}</dd></div><div><dt>Total</dt><dd>{sessionInfo.tokens.total.toLocaleString()}</dd></div></dl></section>
            <section><h3>Cache Warming</h3><dl><div><dt>Mode</dt><dd>{sessionInfo.cacheWarming.mode}</dd></div><div><dt>Status</dt><dd>{sessionInfo.cacheWarming.status}</dd></div>
              {sessionInfo.cacheWarming.missPenalty!==undefined&&<div><dt>Cache miss penalty</dt><dd>${sessionInfo.cacheWarming.missPenalty.toFixed(3)}</dd></div>}
              {sessionInfo.cacheWarming.refreshCost!==undefined&&<div><dt>Refresh cost</dt><dd>${sessionInfo.cacheWarming.refreshCost.toFixed(3)}</dd></div>}</dl></section>
            {(sessionInfo.cost>0||sessionInfo.cacheRebilled)&&<section><h3>Cost</h3><dl><div><dt>Total</dt><dd>${sessionInfo.cost.toFixed(3)}</dd></div>
              {sessionInfo.costBreakdown.map(item=><div className="nested" key={item.key}><dt>{item.key}</dt><dd>${item.cost.toFixed(3)} <span>({formatAgentTokens(item.tokens)} tokens)</span></dd></div>)}
              {sessionInfo.cacheRebilled&&<div><dt>Cache Re-billed</dt><dd>{sessionInfo.cacheRebilled.cost>=.0001?<><span className="session-info-cost">${sessionInfo.cacheRebilled.cost.toFixed(3)}</span>{' '}<span>({sessionInfo.cacheRebilled.tokens.toLocaleString()} tokens, {sessionInfo.cacheRebilled.missCount} {sessionInfo.cacheRebilled.missCount===1?'miss':'misses'})</span></>:<>{sessionInfo.cacheRebilled.tokens.toLocaleString()} tokens, {sessionInfo.cacheRebilled.missCount} {sessionInfo.cacheRebilled.missCount===1?'miss':'misses'}</>}</dd></div>}
            </dl></section>}
          </>}</div>
        </section>
      </div>}
      {customCompactOpen&&<div className="agent-chat-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!contextOperation)setCustomCompactOpen(false);}}>
        <section className="agent-chat-modal custom-compact-dialog" role="dialog" aria-modal="true" aria-label="Custom Compact">
          <header><strong>Custom Compact</strong><button className="agent-icon-button" disabled={!!contextOperation} onClick={()=>setCustomCompactOpen(false)} aria-label="Close"><Icon name="close" size={14}/></button></header>
          <div className="custom-compact-content"><label htmlFor="custom-compact-instructions">Additional instructions for the compaction summary</label>
            <textarea id="custom-compact-instructions" autoFocus value={customCompactInstructions} onChange={event=>setCustomCompactInstructions(event.target.value)}/>
            {customCompactError&&<p>{customCompactError}</p>}</div><footer><button disabled={!!contextOperation} onClick={()=>setCustomCompactOpen(false)}>Cancel</button>
            <button className="agent-primary" disabled={!!contextOperation||!customCompactInstructions.trim()} onClick={()=>void compactContext(customCompactInstructions)}>{contextOperation?'Compacting…':'Compact'}</button></footer>
        </section>
      </div>}
      {contextDetailOpen&&<div className="agent-chat-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setContextDetailOpen(false);}}>
        <section className="agent-chat-modal context-detail-dialog" role="dialog" aria-modal="true" aria-label="Context Detail">
          <header><strong>Context Detail</strong><span className="context-detail-actions">
            <button className="agent-icon-button" title="Open normalized context" aria-label="Open normalized context" disabled={!contextProjection} onClick={openContextJson}><Icon name="json" size={21}/></button>
            <button className="agent-icon-button" onClick={()=>setContextDetailOpen(false)} aria-label="Close"><Icon name="close" size={14}/></button>
          </span></header>
          <div className="context-detail-content">{contextProjectionError?<p className="agent-empty">{contextProjectionError}</p>:!contextProjection?<p className="agent-empty">Loading context projection…</p>:contextProjection.entries.length===0?<p className="agent-empty">No context sources yet.</p>:
            <div className="context-source-list">{contextProjection.entries.map((entry,index)=>{const count=entry.messages.length;const roles=sourceRoles(entry.messages);
              return <details key={`${entry.sourceEntry.id}:${index}`}><summary><span className="context-source-line">
                <span className={count>0?'context-source-type active':'context-source-type'}>{entry.sourceEntry.type}</span>
                {roles.map((role,roleIndex)=><span className={`context-source-role role-${role}`} key={roleIndex}>{role}</span>)}
                <span className="context-source-preview">{sourcePreview(entry.sourceEntry)}</span>
                {count>0&&<small className="context-source-count">{count} {count===1?'message':'messages'}</small>}
              </span></summary><div className="context-source-body">
                <button type="button" className="context-source-expand" title="Open in Editor" aria-label={`Open ${entry.sourceEntry.type} details in editor`} onClick={()=>openSourceJson(entry.sourceEntry,entry.messages)}><Icon name="expand" size={13}/></button>
                <pre>{messageJson({sourceEntry:entry.sourceEntry,messages:entry.messages})}</pre></div></details>;})}</div>}
          </div>
        </section>
      </div>}
    </aside>
    {sessionMenuOpen&&projectsWithChats.length>0&&createPortal(<div ref={sessionMoreMenuRef} style={sessionMenuStyle} className="agent-session-more-menu" role="listbox" aria-label="Open chats">
      {projectsWithChats.map(project=>{
        const grouped=projectsWithChats.length>1;
        return <div key={project.id} role={grouped?'group':undefined} aria-label={grouped?project.name:undefined}>
          {grouped&&<div className="session-menu-project">{project.name}</div>}
          {[...openSessionIds[project.id]].reverse().map(sessionId=>{
            const summary=sessions[project.id]?.find(item=>item.id===sessionId);
            const chat=chats[sessionId];
            const active=selectedProjectId===project.id&&selectedSessionId===sessionId;
            const tone=sessionTone(chat?.status??summary?.status??'idle',doneSessionIds.has(sessionId),questions[sessionId]!==undefined?questions[sessionId].length>0:summary?.question);
            return <button type="button" role="option" aria-selected={active} className={active?'selected':''} key={sessionId}
              onClick={()=>{setSessionMenuOpen(false);void openSessionById(project.id,sessionId);}}>
              <i className={`session-menu-status ${tone}`}/><span>{titleFor(summary,chat)}</span>
            </button>;
          })}
        </div>;
      })}
    </div>,document.body)}
    {statsRun&&createPortal(<aside ref={statsMenuRef} style={statsMenuStyle} className="agent-run-stats-popover" role="dialog" aria-label="Run details"><RunStatsDetails run={statsRun}/></aside>,document.body)}
    {modelMenu&&createPortal(<div ref={modelMenuRef} style={modelMenuStyle} className="agent-model-menu combined" role="dialog" aria-label="Model and thinking">
      <div className="agent-model-picker"><div className="agent-model-list">{groupedModels.map(group=><section key={group.label}><strong>{group.label}</strong>
        {group.options.map(option=>{const [provider,id]=option.value.split('\u0000');const selected=selectedModel?.provider===provider&&selectedModel.id===id;return <button className={selected?'selected':''}
          key={option.value} onClick={()=>{const model=models.find(item=>item.provider===provider&&item.id===id);if(model)void setModel(model);}}><span>{option.label}</span>{selected&&<Icon name="check" size={11}/>}</button>;})}</section>)}</div>
        {selectedModel&&<div className="agent-thinking-list"><strong>Thinking</strong>{thinkingOptions.map(option=><button className={option.value===selectedThinking?'selected':''} key={option.value}
          onClick={()=>void setThinking(option.value as PiThinkingLevel).then(()=>setModelMenu(false))}>{option.label}{option.value===selectedThinking&&<Icon name="check" size={11}/>}</button>)}</div>}</div>
      <button className="configure-models" onClick={()=>{setModelMenu(false);setModelDialog(true);}}><Icon name="settings" size={13}/>Configure Models</button>
    </div>,document.body)}
    {sessionDialog&&selectedProjectId&&<SessionDialog projects={projects} projectId={selectedProjectId} selectedSessionId={selectedSessionId}
      sessions={sessions[selectedProjectId]??[]} doneSessionIds={doneSessionIds} notify={notify}
      onProject={id=>{chatNavigation.current++;setLoading(false);setSelectedProjectId(id);setSelectedSessionId(null);setNewChatModel(undefined);setDraft('');prepareDraft(id);}} onOpen={session=>void openCatalogSession(session)} onNew={startNewChat}
      onRename={(session,name)=>void window.revu.agent.renameSession(session.projectId,session.id,name,session.scope).then(unwrap).then(()=>{setChats(current=>{
        const chat=current[session.id];return chat?{...current,[session.id]:{...chat,name}}:current;});return reloadSessions(session.projectId);}).catch(error=>notify('error',errorMessage(error)))}
      onDelete={session=>{if(window.confirm(`Delete “${session.name}”? The session will be moved to the Recycle Bin.`))void window.revu.agent.deleteSession(session.projectId,session.id,session.scope).then(unwrap).then(()=>{
        setChats(current=>{const next={...current};delete next[session.id];return next;});setOpenSessionIds(current=>({...current,[session.projectId]:(current[session.projectId]??[]).filter(id=>id!==session.id)}));
        if(selectedSessionId===session.id)startNewChat();return reloadSessions(session.projectId);
      }).catch(error=>notify('error',errorMessage(error)));}} onClone={session=>void cloneSession(session)} onExport={session=>void exportSession(session)}
      onFolderChanged={()=>void reloadSessions(selectedProjectId)} onClose={()=>setSessionDialog(false)}/>}
      {forkTarget&&<ForkDialog key={forkTarget.sessionId} {...forkTarget} onClose={()=>{setForkTarget(null);focusComposer(draftRef.current.length);}} onFork={async entryId=>{
        const response=await window.revu.agent.forkSession(forkTarget.projectId,forkTarget.sessionId,entryId).then(unwrap);
        await adoptCreatedSession(forkTarget.projectId,response.snapshot,response.selectedText);
      }}/>}
    {treeDialog&&current&&<SessionTreeDialog projectId={current.projectId} sessionId={current.sessionId} onClose={()=>setTreeDialog(false)}
      summaryOperation={current.summaryOperations.filter(operation=>operation.kind==='branchSummary').at(-1)} summaryNow={summaryWaiting?retryClock:Date.now()} onOpenSummaryJson={openSummaryJson}
      onNavigated={response=>void adoptTreeNavigation(response)} notify={notify}/>}
    {!!cwdDialogs.length&&<CwdRecoveryDialog key={cwdDialogs[0].id} request={cwdDialogs[0]} onRespond={async accept=>{await window.revu.agent.respondSessionCwd(cwdDialogs[0].id,accept).then(unwrap);setCwdDialogs(items=>items.slice(1));}}/>}
    {!!trustDialogs.length&&<ProjectTrustDialog key={trustDialogs[0].id??`${trustDialogs[0].projectId}:${trustDialogs[0].sessionId}`} trust={trustDialogs[0].trust} onSave={saveTrust} onClose={()=>void closeTrust()}/>}
    {modelDialog&&selectedProjectId&&<ModelDialog projectId={selectedProjectId} sessionId={selectedSessionId??undefined} onClose={()=>setModelDialog(false)}
      onChanged={()=>{if(!selectedSessionId)void loadNewChatDefaults(selectedProjectId);}} notify={notify}/>} 
  </>;
}

function errorMessage(error:unknown){return error instanceof Error?error.message:String(error);}
