import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Project } from './editor';
import Icon from './Icon';
import MarkdownContent from './MarkdownContent';
import SessionTreeDialog from './SessionTreeDialog';
import { showContextMenu } from './ContextMenu';
import { isReservedPiSessionName, threadPiSessions,type ThreadedPiSession } from '../shared/piSession';
import type { ProjectPathEntry } from '../shared/types';
import type {
  PiCompactionResult,PiEntriesResponse,PiModelDefaults,PiModelSummary,PiProviderStatus,PiQueueState,PiRuntimeStatus,
  PiSessionCatalog,PiSessionEntry,PiSessionGroup,PiSessionInfo,PiSessionScope,PiSessionSearchResult,PiSessionSnapshot,PiSessionSort,PiSessionSummary,PiThinkingLevel,
  PiTreeNavigationResponse,PiUsageStats,RevuPiEvent,
} from '../shared/piTypes';

export interface ToolState {
  id:string;runKey:string;name:string;status:'running'|'done'|'error';args?:unknown;result?:unknown;
  startedAt?:number;durationMs?:number;usage?:MessageUsage;
}
interface AutoRetryState {attempt:number;maxAttempts:number;errorMessage:string;deadline:number}
export interface ChatState extends PiSessionSnapshot {tools:ToolState[];streamText:string;streamThinking:string;entries:PiSessionEntry[];leafId:string|null;queue:PiQueueState;autoRetry?:AutoRetryState;settledRuns:Record<string,number>}
export interface ToolDetailRequest {
  id:string;projectId:string;sessionId:string;toolCallId:string;fileName:string;content:string;
}
interface RunItem {type:'answer'|'thinking'|'tool';key:string;text?:string;tool?:ToolState;streaming?:boolean}
interface MessageUsage {input:number;output:number;cacheRead:number;cacheWrite:number;reasoning:number;totalTokens:number;cost:number}
interface RunCall {key:string;type:'model'|'tool';name:string;durationMs?:number;usage?:MessageUsage}
interface RunStats {elapsedMs?:number;modelTimeMs:number;toolTimeMs:number;assistantUsage:MessageUsage;toolUsage:MessageUsage;calls:RunCall[]}
type AssistantStopReason='stop'|'toolUse'|'length'|'error'|'aborted'|'deferred';
interface ChatRun {key:string;user:string;userTimestamp?:number;userEntryId?:string;items:RunItem[];stats:RunStats;lastEventAt?:number;stopReason?:AssistantStopReason}
type SessionTone='idle'|'running'|'done'|'error';
export interface AgentNavigationRequest {projectId:string;sessionId:string;runKey?:string;token:number}
export interface AgentNotice {level:'success'|'error';message:string;projectId:string;sessionId:string;runKey?:string}
type Notify=(level:'info'|'warning'|'error',message:string)=>void;
interface SelectOption {value:string;label:string}
interface SelectGroup {label?:string;options:SelectOption[]}
interface MentionMatch {start:number;end:number;query:string}

const THINKING_LEVELS:PiThinkingLevel[]=['off','minimal','low','medium','high','xhigh','max'];
const EMPTY_QUEUE:PiQueueState={steering:[],followUp:[]};
const unwrap=<T,>(result:{ok:boolean;value?:T;error?:string})=>{
  if(!result.ok)throw new Error(result.error||'Pi Agent request failed.');return result.value as T;
};
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'?value as Record<string,unknown>:{};
const messageKey=(message:unknown)=>{const item=record(message);return `${String(item.role)}:${String(item.timestamp??'')}`;};
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
const CHAT_HISTORY_KEY='revu-chat-input-history';const CHAT_HISTORY_LIMIT=20;
const historyProjectKey=(root:string)=>root.replaceAll('\\','/').replace(/\/$/,'').toLocaleLowerCase();
const savedInputHistory=(root:string):string[]=>{
  try{const all=JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY)??'{}') as Record<string,unknown>;const value=all[historyProjectKey(root)];
    return Array.isArray(value)?value.filter(item=>typeof item==='string').slice(-CHAT_HISTORY_LIMIT) as string[]:[];}catch{return [];}
};
const rememberInput=(root:string,text:string)=>{
  try{const all=JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY)??'{}') as Record<string,unknown>;const key=historyProjectKey(root);
    const items=savedInputHistory(root);if(items.at(-1)!==text)items.push(text);all[key]=items.slice(-CHAT_HISTORY_LIMIT);localStorage.setItem(CHAT_HISTORY_KEY,JSON.stringify(all));}catch{}
};
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
export const withSnapshot=(snapshot:PiSessionSnapshot,previous?:ChatState):ChatState=>({
  ...snapshot,tools:(()=>{const history=toolsFromMessages(snapshot.messages);const known=new Set(history.map(tool=>tool.id));
    return [...history,...(previous?.tools??[]).filter(tool=>tool.status==='running'&&!known.has(tool.id))];})(),streamText:'',streamThinking:'',
  entries:previous?.entries??[],leafId:previous?.leafId??null,queue:snapshot.queue??previous?.queue??EMPTY_QUEUE,
  autoRetry:snapshot.status==='running'?previous?.autoRetry:undefined,settledRuns:previous?.settledRuns??{},
});
const withEntries=(state:ChatState,response:PiEntriesResponse):ChatState=>({...state,entries:response.entries,leafId:response.leafId});
const activeEntries=(state:ChatState)=>{
  const byId=new Map(state.entries.map(entry=>[entry.id,entry]));const branch:PiSessionEntry[]=[];let id=state.leafId;
  while(id){const entry=byId.get(id);if(!entry)break;branch.push(entry);id=entry.parentId;}
  return branch.reverse();
};
export const buildRuns=(state:ChatState):ChatRun[]=>{
  const userEntries=activeEntries(state).filter(entry=>entry.type==='message'&&record(entry.message).role==='user');
  const runs:ChatRun[]=[];const tools=new Map(state.tools.map(tool=>[tool.id,tool]));const placed=new Set<string>();let current:ChatRun|undefined;let userIndex=0;
  const ensureRun=()=>current??(current={key:runKey(runs.length),user:'',items:[],stats:emptyRunStats()},runs.push(current),current);
  for(const message of state.messages){const item=record(message);const role=item.role;
    if(role==='user'){const text=messageText(message);const found=userEntries.findIndex((entry,index)=>index>=userIndex&&messageText(entry.message)===text);const entry=found>=0?userEntries[found]:undefined;if(found>=0)userIndex=found+1;
      current={key:runKey(runs.length),user:text,userTimestamp:messageTimestamp(message),userEntryId:entry?.id,items:[],stats:emptyRunStats()};runs.push(current);continue;}
    if(role==='assistant'&&Array.isArray(item.content)){const run=ensureRun();const usage=messageUsage(message);const durationMs=numberValue(item.durationMs);addUsage(run.stats.assistantUsage,usage);
      run.stopReason=assistantStopReason(item.stopReason)??run.stopReason;
      if(durationMs!==undefined)run.stats.modelTimeMs+=durationMs;run.stats.calls.push({key:`model-${run.stats.calls.length}`,type:'model',name:String(item.stopReason??'response'),durationMs,usage});
      const timestamp=messageTimestamp(message);if(timestamp!==undefined)run.lastEventAt=Math.max(run.lastEventAt??0,timestamp+(durationMs??0));for(const raw of item.content){const block=record(raw);
      if(block.type==='text'&&typeof block.text==='string'&&block.text.trim())run.items.push({type:'answer',key:`answer-${run.items.length}`,text:block.text});
      if(block.type==='thinking'&&typeof block.thinking==='string'&&block.thinking.trim())run.items.push({type:'thinking',key:`thinking-${run.items.length}`,text:block.thinking});
      if(block.type==='toolCall'){const id=String(block.id??'');if(!id||placed.has(id))continue;const tool=tools.get(id)??{id,runKey:run.key,name:String(block.name??'Tool'),status:'running',args:block.arguments};
        run.items.push({type:'tool',key:id,tool});placed.add(id);}
    }}
    if(role==='toolResult'){const run=ensureRun();const id=String(item.toolCallId??'');const usage=messageUsage(message);const durationMs=numberValue(item.durationMs);addUsage(run.stats.toolUsage,usage);
      if(durationMs!==undefined)run.stats.toolTimeMs+=durationMs;run.stats.calls.push({key:`tool-${id||run.stats.calls.length}`,type:'tool',name:String(item.toolName??'Tool'),durationMs,usage});
      const timestamp=messageTimestamp(message);if(timestamp!==undefined)run.lastEventAt=Math.max(run.lastEventAt??0,timestamp);if(!id||placed.has(id))continue;const tool=tools.get(id);if(tool){run.items.push({type:'tool',key:id,tool});placed.add(id);}}
  }
  for(const tool of state.tools){if(placed.has(tool.id))continue;const run=runs.find(candidate=>candidate.key===tool.runKey)??ensureRun();run.items.push({type:'tool',key:tool.id,tool});placed.add(tool.id);}
  const live=ensureRun();if(state.streamThinking)live.items.push({type:'thinking',key:'stream-thinking',text:state.streamThinking,streaming:true});
  if(state.streamText)live.items.push({type:'answer',key:'stream-answer',text:state.streamText,streaming:true});
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
const emptyUsage:PiUsageStats={input:0,output:0,cacheRead:0,cacheWrite:0,total:0,cost:0,runs:0,toolCalls:0,cacheHitPercent:0,contextTokens:0,contextWindow:0,contextPercent:0};
const finalAnswer=(run:ChatRun)=>[...run.items].reverse().find(item=>item.type==='answer'&&!item.streaming)?.text??'';
const usageMeta=(usage:MessageUsage)=>`${formatAgentTokens(usage.totalTokens)} tokens · $${usage.cost.toFixed(4)}`;
const runStatsSummary=(run:ChatRun)=>{const usage=combinedUsage(run.stats);return [run.stats.elapsedMs===undefined?undefined:formatToolDuration(run.stats.elapsedMs),
  `${formatAgentTokens(usage.totalTokens)} tokens`,`$${usage.cost.toFixed(4)}`].filter(Boolean).join(' · ');};
const stopReasonLabel=(reason:AssistantStopReason)=>reason==='toolUse'?'Tool Use':reason[0].toUpperCase()+reason.slice(1);
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
const sessionTone=(status:PiRuntimeStatus,done:boolean):SessionTone=>done?'done':status==='error'?'error':
  status==='running'||status==='starting'||status==='stopping'?'running':'idle';
const sessionStatusLabel=(tone:SessionTone)=>tone==='running'?'Running':tone==='done'?'Done':tone==='error'?'Error':'Idle';
const PROVIDER_NAMES:Record<string,string>={anthropic:'Anthropic',openai:'OpenAI',google:'Google Gemini',openrouter:'OpenRouter',deepseek:'DeepSeek',xai:'xAI',groq:'Groq',mistral:'Mistral',cerebras:'Cerebras',nvidia:'NVIDIA NIM',zai:'ZAI',moonshotai:'Moonshot AI','moonshotai-cn':'Moonshot AI CN'};
const providerName=(id:string)=>PROVIDER_NAMES[id]??id;
const modelValue=(provider:string,id:string)=>`${provider}\u0000${id}`;
const modelGroups=(models:PiModelSummary[]):SelectGroup[]=>{
  const groups=new Map<string,SelectOption[]>();
  for(const model of models){const options=groups.get(model.provider)??[];options.push({value:modelValue(model.provider,model.id),label:model.id});groups.set(model.provider,options);}
  return [...groups].map(([provider,options])=>({label:providerName(provider),options}));
};

function AgentSelect({value,groups,placeholder,onChange,disabled=false,placement='down',align='start',compact=false,showCheck=true}:{
  value?:string;groups:SelectGroup[];placeholder:string;onChange:(value:string)=>void;disabled?:boolean;
  placement?:'up'|'down';align?:'start'|'end';compact?:boolean;showCheck?:boolean;
}){
  const [open,setOpen]=useState(false);const [menuStyle,setMenuStyle]=useState<React.CSSProperties>({});
  const root=useRef<HTMLDivElement|null>(null);const menu=useRef<HTMLDivElement|null>(null);
  const options=groups.flatMap(group=>group.options);const selected=options.find(option=>option.value===value);
  useLayoutEffect(()=>{if(!open||!root.current)return;const rect=root.current.getBoundingClientRect();const width=compact?Math.max(96,rect.width):rect.width;
    const left=Math.max(8,Math.min(window.innerWidth-width-8,align==='end'?rect.right-width:rect.left));
    setMenuStyle({position:'fixed',left,width,maxHeight:Math.max(100,Math.min(280,(placement==='up'?rect.top:window.innerHeight-rect.bottom)-12)),
      ...(placement==='up'?{bottom:window.innerHeight-rect.top+5}:{top:rect.bottom+5})});
  },[open,placement,align,compact]);
  useEffect(()=>{if(!open)return;const outside=(event:PointerEvent|FocusEvent)=>{const target=event.target as Node;if(!root.current?.contains(target)&&!menu.current?.contains(target))setOpen(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false);};
    document.addEventListener('pointerdown',outside);document.addEventListener('focusin',outside);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside);document.removeEventListener('keydown',escape);};
  },[open]);
  const choose=(next:string)=>{onChange(next);setOpen(false);};
  const keyDown=(event:React.KeyboardEvent<HTMLButtonElement>)=>{
    if(event.key==='Escape'){setOpen(false);return;}
    if(event.key==='Enter'||event.key===' '){event.preventDefault();setOpen(current=>!current);return;}
    if(event.key!=='ArrowDown'&&event.key!=='ArrowUp')return;
    event.preventDefault();const index=options.findIndex(option=>option.value===value);
    const next=event.key==='ArrowDown'?Math.min(options.length-1,index+1):index<0?options.length-1:Math.max(0,index-1);if(options[next])choose(options[next].value);
  };
  return <div className={'agent-select '+(compact?'compact':'')} ref={root}
    onBlur={event=>{const next=event.relatedTarget as Node|null;if(!root.current?.contains(next)&&!menu.current?.contains(next))setOpen(false);}}
    onKeyDownCapture={event=>{if(event.key==='Escape')setOpen(false);}}><button type="button" className="agent-select-trigger" disabled={disabled}
    aria-haspopup="listbox" aria-expanded={open} onClick={()=>setOpen(current=>!current)} onKeyDown={keyDown}>
    <span className={selected?'':'placeholder'}>{selected?.label??placeholder}</span><Icon name="down" size={12}/></button>
    {open&&createPortal(<div ref={menu} style={menuStyle} className="agent-select-menu" role="listbox">{groups.map((group,index)=><section key={group.label??index}>
      {group.label&&<strong>{group.label}</strong>}{group.options.map(option=><button type="button" role="option" aria-selected={option.value===value}
        className={option.value===value?'selected':''} key={option.value} onClick={()=>choose(option.value)}><span>{option.label}</span>{showCheck&&option.value===value&&<Icon name="check" size={11}/>}</button>)}</section>)}</div>,document.body)}
  </div>;
}

export function updateEvent(current:ChatState,event:unknown):ChatState{
  const item=record(event);const type=item.type;
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

function sessionCwdKey(path:string){const value=path.replace(/\\/g,'/').replace(/\/$/,'');return /^[A-Za-z]:\//.test(value)?value.toLocaleLowerCase():value;}

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
  const selectedProject=projects.find(project=>project.id===projectId)??projects[0];const [selectedCwd,setSelectedCwd]=useState(()=>sessionCwdKey(selectedProject?.root??''));
  const trimmedQuery=query.trim();
  useEffect(()=>localStorage.setItem('revu-session-sort',sort),[sort]);
  useEffect(()=>{if(!folderMenuOpen)return;const close=(event:MouseEvent)=>{if(!folderMenuRef.current?.contains(event.target as Node))setFolderMenuOpen(false);};
    document.addEventListener('mousedown',close);return()=>document.removeEventListener('mousedown',close);},[folderMenuOpen]);
  useEffect(()=>{if(scope==='current'&&selectedProject)setSelectedCwd(sessionCwdKey(selectedProject.root));},[scope,selectedProject?.root]);
  useEffect(()=>{
    if(scope!=='all'){setCatalog({groups:[],sessions:[]});setCatalogLoading(false);return;}
    let cancelled=false;setCatalogLoading(true);
    void window.revu.agent.listSessions(projectId,'all').then(unwrap).then(value=>{if(!cancelled){setCatalog(value);
      setSelectedCwd(current=>value.groups.some(group=>group.key===current)?current:sessionCwdKey(selectedProject?.root??value.groups[0]?.cwd??''));}})
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
  },[projectId,trimmedQuery,sort,scope]);
  const openGroups:PiSessionGroup[]=projects.map(project=>({key:sessionCwdKey(project.root),name:project.name,cwd:project.root,available:true}));
  const projectGroups=scope==='current'?openGroups:[...new Map([...openGroups,...catalog.groups].map(group=>[group.key,group])).values()];
  const sourceSessions=scope==='current'?sessions:catalog.sessions;
  const visibleSessions=sourceSessions.filter(session=>sessionCwdKey(session.cwd)===selectedCwd&&(!namedOnly||(session.hasName&&!isReservedPiSessionName(session.name))));
  const visibleResults=results.filter(session=>sessionCwdKey(session.cwd)===selectedCwd&&(!namedOnly||(session.hasName&&!isReservedPiSessionName(session.name))));
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
  const renderSession=(session:PiSessionSummary|PiSessionSearchResult,thread?:ThreadedPiSession<PiSessionSummary>)=>{const tone=sessionTone(session.status,doneSessionIds.has(session.id));const enabled=(session.status==='idle'||session.status==='error')&&session.hasSessionFile!==false&&!session.isCompacting;
    const openProject=projects.find(project=>sessionCwdKey(project.root)===sessionCwdKey(session.cwd));const canRuntimeAction=enabled&&!!openProject;
    const actionSession=openProject?{...session,projectId:openProject.id,scope:'current' as const}:session;
    const contextMenu=async(event:React.MouseEvent)=>{const action=await showContextMenu(event,[{id:'clone',label:'Clone',disabled:!canRuntimeAction},{id:'export',label:'Export',disabled:!canRuntimeAction}] as const);
      if(action==='clone')onClone(actionSession);if(action==='export')onExport(actionSession);};
    return <div className={`session-row status-${tone} ${session.id===selectedSessionId?'active':''}`} key={session.id} onContextMenu={event=>void contextMenu(event)}>
      {renaming===session.id?<form onSubmit={event=>{event.preventDefault();const normalized=name.trim();if(!normalized){notify('error','Session name is required.');return;}
        if(isReservedPiSessionName(normalized)){notify('error','Names ending in (Fork), (Clone), or a numbered variant are reserved.');return;}onRename(session,normalized);setRenaming(null);}}>
        <input autoFocus value={name} onChange={event=>setName(event.target.value)}/><button type="submit">Save</button><button type="button" onClick={()=>setRenaming(null)}>Cancel</button>
      </form>:<>
        <button className="session-select" onClick={()=>onOpen(session)}><span className="session-title">{thread&&thread.depth>0&&<i className="session-thread-prefix">{thread.ancestorContinues.map(value=>value?'│  ':'   ').join('')}{thread.isLast?'└─ ':'├─ '}</i>}<b>{session.name}</b></span>{'matchSnippet' in session&&session.matchSnippet&&<em>{session.matchSnippet}</em>}<small>{formatTime(session.modifiedAt)} · {session.runCount} {session.runCount===1?'run':'runs'}</small></button>
        <span className={`session-status ${tone}`}><i/>{sessionStatusLabel(tone)}</span>
        <div className="session-actions"><button className="session-action" onClick={()=>{setRenaming(session.id);setName(session.name);}}>Rename</button>
          <button className="session-action" onClick={()=>onDelete(session)}>Delete</button></div>
      </>}
    </div>;
  };
  return <div className="agent-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}>
    <section className="agent-modal session-dialog" role="dialog" aria-modal="true" aria-label="Sessions">
      <header><strong>Sessions</strong><div><button className="agent-primary" onClick={onNew}>New Chat</button><div className="session-folder-settings" ref={folderMenuRef}>
        <button className="agent-icon-button" title="Session settings" aria-label="Session settings" aria-expanded={folderMenuOpen} onClick={()=>setFolderMenuOpen(value=>!value)}><Icon name="sessionSettings" size={15}/></button>
        {folderMenuOpen&&<div className="session-folder-menu" role="menu"><button role="menuitem" onClick={()=>void chooseSessionFolder()}>Session Folder</button></div>}
      </div><button className="agent-icon-button" onClick={onClose} aria-label="Close"><Icon name="close" size={15}/></button></div></header>
      <div className="session-project-bar"><nav className="session-project-tabs" aria-label="Projects">{projectGroups.map(group=><button key={group.key} title={group.cwd}
        className={group.key===selectedCwd?'active':''} onClick={()=>{setSelectedCwd(group.key);if(scope==='current'){const project=projects.find(item=>sessionCwdKey(item.root)===group.key);if(project)onProject(project.id);}}}>{group.name}</button>)}</nav>
        <div className="session-scope-switch" role="group" aria-label="Session scope"><button className={scope==='current'?'active':''} onClick={()=>setScope('current')}>Current</button><button className={scope==='all'?'active':''} onClick={()=>setScope('all')}>All</button></div></div>
      <div className="session-search"><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search conversations..." aria-label="Search conversations"/>
        <AgentSelect compact align="end" showCheck={false} value={sort} placeholder="Sort" groups={[{options:[{value:'threaded',label:'Threaded'},{value:'relevance',label:'Relevant'},{value:'recent',label:'Recent'}]}]}
          onChange={value=>setSort(value as PiSessionSort)}/><label className="session-named-filter"><input type="checkbox" checked={namedOnly} onChange={event=>setNamedOnly(event.target.checked)}/><span>Named</span></label></div>
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
  const [busy,setBusy]=useState(false);
  const load=async()=>{
    const providerItems=await window.revu.agent.listProviders().then(unwrap);
    setProviders(providerItems);
    let defaultValues:PiModelDefaults={thinkingLevel:'medium'};
    try{defaultValues=await window.revu.agent.getModelDefaults(projectId).then(unwrap);setDefaults(defaultValues);setSavedDefaults(defaultValues);}
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
  const selected=providers.find(item=>item.id===selectedProvider);
  const providerGroups:SelectGroup[]=[{options:providers.map(provider=>({value:provider.id,label:provider.name}))}];
  const defaultModelValue=defaults.provider&&defaults.modelId?modelValue(defaults.provider,defaults.modelId):undefined;
  const thinkingGroups:SelectGroup[]=[{options:THINKING_LEVELS.map(level=>({value:level,label:level}))}];
  const defaultsDirty=defaults.provider!==savedDefaults.provider||defaults.modelId!==savedDefaults.modelId||defaults.thinkingLevel!==savedDefaults.thinkingLevel;
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
        <section className="model-section"><div className="model-section-heading"><div><h3>New Chat Defaults</h3><p>Applied when a new Pi session is created.</p></div><div className="model-section-actions">
            {defaultsDirty&&defaults.provider&&defaults.modelId&&<button className="save" disabled={busy} onClick={()=>void saveDefaults()}>Save</button>}</div></div>
          <div className="model-default-grid"><label><span>Model</span><AgentSelect value={defaultModelValue} groups={modelGroups(models)} placement="up"
              placeholder={models.length?'Select model':'Configure a provider first'} onChange={value=>{const [provider,id]=value.split('\u0000');setDefaults(current=>({...current,provider,modelId:id}));}}/></label>
            <label><span>Thinking</span><AgentSelect value={defaults.thinkingLevel} groups={thinkingGroups} placement="up" align="end" placeholder="Select level"
              onChange={value=>setDefaults(current=>({...current,thinkingLevel:value as PiThinkingLevel}))}/></label></div>
        </section>
      </div>
    </section>
  </div>;
}

export default function AgentChat({open,projects,activeProjectId,dirtyProjectIds,width,onResize,onResizeEnd,notify,navigationRequest,onNotice,onProjectAdded,onOpenToolDetail,onUpdateToolDetail}:{
  open:boolean;projects:Project[];activeProjectId:string|null;dirtyProjectIds:ReadonlySet<string>;width:number;
  onResize:(width:number)=>void;onResizeEnd:(width:number)=>void;notify:Notify;
  navigationRequest:AgentNavigationRequest|null;onNotice:(notice:AgentNotice)=>void;
  onProjectAdded:(project:Project)=>Project;
  onOpenToolDetail:(detail:ToolDetailRequest)=>void;onUpdateToolDetail:(detail:ToolDetailRequest)=>void;
}){
  const [selectedProjectId,setSelectedProjectId]=useState<string>('');const [selectedSessionId,setSelectedSessionId]=useState<string|null>(null);
  const [sessions,setSessions]=useState<Record<string,PiSessionSummary[]>>({});const [chats,setChats]=useState<Record<string,ChatState>>({});
  const [draft,setDraft]=useState('');const [sessionDialog,setSessionDialog]=useState(false);const [modelDialog,setModelDialog]=useState(false);
  const [treeDialog,setTreeDialog]=useState(false);
  const [modelMenu,setModelMenu]=useState(false);const [models,setModels]=useState<PiModelSummary[]>([]);const [loading,setLoading]=useState(false);
  const [composerExpanded,setComposerExpanded]=useState(false);
  const [usageOpen,setUsageOpen]=useState(false);const [contextOpen,setContextOpen]=useState(false);const [contextOperation,setContextOperation]=useState<'compact'|'toggle'|null>(null);
  const [sessionInfoOpen,setSessionInfoOpen]=useState(false);const [sessionInfo,setSessionInfo]=useState<PiSessionInfo|undefined>();const [sessionInfoError,setSessionInfoError]=useState('');
  const [compactionResult,setCompactionResult]=useState<PiCompactionResult|undefined>();const [activeRunKey,setActiveRunKey]=useState('');
  const [toolClock,setToolClock]=useState(Date.now());const [retryClock,setRetryClock]=useState(Date.now());
  const [previewRunKey,setPreviewRunKey]=useState('');const [previewTop,setPreviewTop]=useState(8);
  const [openSessionIds,setOpenSessionIds]=useState<Record<string,string[]>>({});
  const [sessionTabCapacity,setSessionTabCapacity]=useState(1);const [sessionMenuOpen,setSessionMenuOpen]=useState(false);const [sessionMenuStyle,setSessionMenuStyle]=useState<React.CSSProperties>({});
  const [statsRunKey,setStatsRunKey]=useState('');const [statsMenuStyle,setStatsMenuStyle]=useState<React.CSSProperties>({});
  const [doneSessionIds,setDoneSessionIds]=useState<Set<string>>(()=>new Set());
  const [sourceMessageKeys,setSourceMessageKeys]=useState<Set<string>>(()=>new Set());const [copiedMessageKey,setCopiedMessageKey]=useState('');
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
  const chatsRef=useRef(chats);const viewRef=useRef({open,selectedSessionId,projects,sessions});const erroredRuns=useRef(new Set<string>());const notifiedRuns=useRef(new Set<string>());
  const doneTimers=useRef(new Map<string,ReturnType<typeof setTimeout>>());const copiedTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);const abortTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const wasOpen=useRef(open);const handledNavigationToken=useRef<number|undefined>(undefined);
  const hasPendingNavigation=!!navigationRequest&&handledNavigationToken.current!==navigationRequest.token;
  chatsRef.current=chats;viewRef.current={open,selectedSessionId,projects,sessions};
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
  const selectedProject=projects.find(project=>project.id===selectedProjectId);
  const current=selectedSessionId?chats[selectedSessionId]:undefined;
  const hasRunningTool=!!current?.tools.some(tool=>tool.status==='running');
  const sessionTabs=openSessionIds[selectedProjectId]??[];
  const visibleSessionCount=Math.max(0,sessionTabCapacity-(!selectedSessionId&&selectedProjectId?1:0));
  const visibleSessionTabs=visibleSessionCount?sessionTabs.slice(-visibleSessionCount).reverse():[];
  const runs=current?buildRuns(current):[];const usage=current?.usage??emptyUsage;
  const queue=current?.queue??EMPTY_QUEUE;const queueCount=queue.steering.length+queue.followUp.length;
  const agentRunning=current?.status==='running';const agentActive=agentRunning||current?.status==='stopping';
  const showQueuePanel=!!agentActive&&(!!draft.trim()||queueCount>0);
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
  useEffect(()=>{if(!current?.autoRetry)return;setRetryClock(Date.now());const timer=setInterval(()=>setRetryClock(Date.now()),250);return()=>clearInterval(timer);},[current?.autoRetry?.deadline]);
  useLayoutEffect(()=>{
    const input=textareaRef.current;if(!input)return;
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
  },[draft,width,composerExpanded]);
  useEffect(()=>{
    if(!current)return;
    for(const tool of current.tools)if(tool.status==='running')onUpdateToolDetail(toolDetail(current,tool,toolClock));
  },[current,toolClock,onUpdateToolDetail]);
  const dirty=selectedProjectId?dirtyProjectIds.has(selectedProjectId):false;
  const reloadSessions=async(projectId:string)=>{
    try{const catalog=await window.revu.agent.listSessions(projectId).then(unwrap);const items=catalog.sessions;setSessions(current=>({...current,[projectId]:items}));return items;}
    catch(error){notify('error',error instanceof Error?error.message:String(error));return [];}
  };
  const openSessionById=async(projectId:string,sessionId:string,targetRunKey?:string)=>{setLoading(true);try{
    const snapshot=await window.revu.agent.openSession(projectId,sessionId).then(unwrap);pendingRunKey.current=targetRunKey;
    const entries=await window.revu.agent.getEntries(projectId,snapshot.sessionId).then(unwrap);
    setChats(current=>{const next={...current,[snapshot.sessionId]:withEntries(withSnapshot(snapshot,current[snapshot.sessionId]),entries)};chatsRef.current=next;return next;});
    setOpenSessionIds(current=>{const ids=current[projectId]??[];const next=[...ids.filter(id=>id!==snapshot.sessionId),snapshot.sessionId];return {...current,[projectId]:next};});
    setSelectedProjectId(projectId);setSelectedSessionId(snapshot.sessionId);setDraft('');setSessionDialog(false);
  }catch(error){notify('error',error instanceof Error?error.message:String(error));setModelDialog(true);}finally{setLoading(false);}};
  const openSession=async(session:PiSessionSummary,targetRunKey?:string)=>openSessionById(session.projectId,session.id,targetRunKey);
  const openCatalogSession=async(session:PiSessionSummary)=>{
    const project=projects.find(item=>sessionCwdKey(item.root)===sessionCwdKey(session.cwd));
    if(session.scope==='current'&&project){await openSessionById(project.id,session.id);return;}
    setLoading(true);try{
      const response=await window.revu.agent.openDiscoveredSession(session.projectId,session.id).then(unwrap);onProjectAdded(response.project);
      const snapshot=response.snapshot;const entries=await window.revu.agent.getEntries(response.project.id,snapshot.sessionId).then(unwrap);
      setChats(current=>{const next={...current,[snapshot.sessionId]:withEntries(withSnapshot(snapshot,current[snapshot.sessionId]),entries)};chatsRef.current=next;return next;});
      setOpenSessionIds(current=>({...current,[response.project.id]:[...(current[response.project.id]??[]).filter(id=>id!==snapshot.sessionId),snapshot.sessionId]}));
      setSelectedProjectId(response.project.id);setSelectedSessionId(snapshot.sessionId);setDraft('');setSessionDialog(false);
    }catch(error){notify('error',errorMessage(error));}finally{setLoading(false);}
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
  useEffect(()=>{if(selectedProjectId)void reloadSessions(selectedProjectId);},[selectedProjectId]);
  useLayoutEffect(()=>{activeSessionTabRef.current?.scrollIntoView({block:'nearest',inline:'nearest'});},[selectedProjectId,selectedSessionId,sessionTabs.length]);
  useLayoutEffect(()=>{const container=sessionTabsRef.current;if(!container)return;const update=()=>setSessionTabCapacity(Math.max(1,Math.floor((container.clientWidth+3)/95)));
    update();const observer=new ResizeObserver(update);observer.observe(container);return()=>observer.disconnect();},[]);
  useEffect(()=>{if(selectedProjectId&&!selectedSessionId)void loadNewChatDefaults(selectedProjectId);},[selectedProjectId,selectedSessionId]);
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
    const opening=open&&!wasOpen.current;wasOpen.current=open;
    if(!opening||hasPendingNavigation)return;
    const projectId=activeProjectId??projects[0]?.id??'';if(!projectId)return;
    let cancelled=false;
    setSelectedProjectId(projectId);setSelectedSessionId(null);setNewChatModel(undefined);setDraft('');setSessionDialog(false);
    void reloadSessions(projectId).then(items=>{
      if(cancelled)return;
      const latest=items.reduce<PiSessionSummary|undefined>((result,item)=>!result||item.modifiedAt>result.modifiedAt?item:result,undefined);
      if(latest)void openSessionById(projectId,latest.id);
    });
    return()=>{cancelled=true;};
  },[open]);
  useEffect(()=>{if(!navigationRequest)return;handledNavigationToken.current=navigationRequest.token;
    void openSessionById(navigationRequest.projectId,navigationRequest.sessionId,navigationRequest.runKey??'__latest__');},[navigationRequest?.token]);
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
        if(payload.type==='auto_retry_start')updated={...updated,autoRetry:{
          attempt:typeof payload.attempt==='number'?payload.attempt:1,maxAttempts:typeof payload.maxAttempts==='number'?payload.maxAttempts:1,
          errorMessage:typeof payload.errorMessage==='string'?payload.errorMessage:'The model request failed.',
          deadline:Date.now()+(typeof payload.delayMs==='number'?Math.max(0,payload.delayMs):0),
        }};
        if(payload.type==='auto_retry_end'||payload.type==='agent_settled')updated={...updated,autoRetry:undefined};
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
      if(payload.type==='agent_settled'){
        const settling=chatsRef.current[event.sessionId];if(settling){const key=lastRunKey(settling.messages);const next={...chatsRef.current,
          [event.sessionId]:{...settling,settledRuns:{...settling.settledRuns,[key]:Date.now()}}};chatsRef.current=next;setChats(next);}
      }
      const ended=record(payload.message);
      if(payload.type==='message_end'&&ended.role==='assistant'&&ended.stopReason==='error'){
        const message=typeof ended.errorMessage==='string'?ended.errorMessage:'The model response failed.';sendErrorNotice(message);
        const failed=chatsRef.current[event.sessionId];if(failed){const next={...chatsRef.current,[event.sessionId]:{...failed,error:message}};chatsRef.current=next;setChats(next);}
      }
      if(payload.type==='agent_settled'&&!payload.aborted&&!erroredRuns.current.has(event.sessionId)){
        markDone(event.sessionId);
        void window.revu.agent.getEntries(event.projectId,event.sessionId).then(unwrap).then(entries=>setChats(current=>{
          const chat=current[event.sessionId];if(!chat)return current;const next={...current,[event.sessionId]:withEntries(chat,entries)};chatsRef.current=next;return next;
        })).catch(()=>{});
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
    if(event.type==='error'){
      clearDone(event.sessionId);
      const message=typeof event.payload==='string'?event.payload:'Pi Agent failed.';sendErrorNotice(message);
      const currentChat=chatsRef.current[event.sessionId];if(currentChat){const next={...chatsRef.current,[event.sessionId]:{...currentChat,status:'error' as const,error:message}};chatsRef.current=next;setChats(next);}
      setSessions(current=>({...current,[event.projectId]:(current[event.projectId]??[]).map(session=>session.id===event.sessionId?{...session,status:'error'}:session)}));
    }
    if(event.type==='sessions-changed')void reloadSessions(event.projectId);
  }),[onNotice,markDone,clearDone,onUpdateToolDetail]);
  useLayoutEffect(()=>{
    const body=bodyRef.current;if(!body)return;const frame=requestAnimationFrame(updateRunRail);const observer=new ResizeObserver(updateRunRail);observer.observe(body);
    for(const element of runRefs.current.values())observer.observe(element);body.addEventListener('scroll',updateRunRail,{passive:true});
    return()=>{cancelAnimationFrame(frame);observer.disconnect();body.removeEventListener('scroll',updateRunRail);};
  },[selectedSessionId,width,current?.messages,current?.streamText,current?.streamThinking,current?.tools,updateRunRail]);
  useLayoutEffect(()=>{const requested=pendingRunKey.current;if(!requested)return;const key=requested==='__latest__'?runs.at(-1)?.key:requested;
    const element=key?runRefs.current.get(key):undefined;if(key&&element&&bodyRef.current){skipAutoScroll.current=true;bodyRef.current.scrollTo({top:Math.max(0,element.offsetTop-12)});setActiveRunKey(key);}
    pendingRunKey.current=undefined;
  },[selectedSessionId,runs.length]);
  useEffect(()=>{if(skipAutoScroll.current){skipAutoScroll.current=false;return;}bodyRef.current?.scrollTo({top:bodyRef.current.scrollHeight});},[current?.messages,current?.streamText,current?.streamThinking,current?.tools]);
  const startNewChat=()=>{if(!selectedProjectId)return;setSelectedSessionId(null);setNewChatModel(undefined);setDraft('');setSessionDialog(false);
    composerExpansionSource.current=null;composerManuallyCollapsed.current=false;setComposerExpanded(false);void loadNewChatDefaults(selectedProjectId);};
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
  const focusComposer=(caret:number)=>requestAnimationFrame(()=>{const input=textareaRef.current;if(!input)return;input.focus();input.setSelectionRange(caret,caret);});
  const updateDraftAt=(text:string,caret:number)=>{historyIndex.current=null;draftRef.current=text;setDraft(text);setMention(mentionAt(text,caret));setMentionIndex(0);focusComposer(caret);};
  const insertReferences=(paths:string[],start?:number,end?:number)=>{
    if(!selectedProject||!paths.length)return;const value=draftRef.current;const input=textareaRef.current;const from=start??input?.selectionStart??value.length;const to=end??input?.selectionEnd??from;
    const before=value.slice(0,from);const after=value.slice(to);const references=paths.map(path=>fileReference(path,selectedProject.root)).join(' ');
    const leading=before&&!/[\s(（]$/.test(before)?' ':'';const trailing=/^\s/.test(after)?'':' ';
    updateDraftAt(`${before}${leading}${references}${trailing}${after}`,before.length+leading.length+references.length+trailing.length);
  };
  const chooseFiles=async()=>{if(!selectedProjectId)return;try{const paths=await window.revu.chooseChatFiles(selectedProjectId);insertReferences(paths,draftRef.current.length,draftRef.current.length);}catch(error){notify('error',errorMessage(error));}};
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
    if(!selectedProject||mention)return false;const items=savedInputHistory(selectedProject.root);if(!items.length)return false;let index=historyIndex.current;
    if(index===null){if(direction>0||draft)return false;index=items.length-1;}else index+=direction;
    if(index>=items.length){historyIndex.current=null;setDraft('');setMention(null);focusComposer(0);return true;}
    index=Math.max(0,index);historyIndex.current=index;setDraft(items[index]);setMention(null);focusComposer(items[index].length);return true;
  };
  const queueDraft=async(kind:'steering'|'followUp')=>{
    if(!selectedProjectId||!current||current.status!=='running'||!draft.trim())return;const text=draft;const projectRoot=selectedProject?.root;
    historyIndex.current=null;setMention(null);draftRef.current='';setDraft('');focusComposer(0);
    try{
      if(kind==='steering')await window.revu.agent.steer(selectedProjectId,current.sessionId,text).then(unwrap);
      else await window.revu.agent.followUp(selectedProjectId,current.sessionId,text).then(unwrap);
      if(projectRoot)rememberInput(projectRoot,text);
    }catch(error){if(!draftRef.current)updateDraftAt(text,text.length);notify('error',errorMessage(error));}
  };
  const clearPendingQueue=async()=>{
    if(!selectedProjectId||!current||!queueCount)return;
    try{await window.revu.agent.clearQueue(selectedProjectId,current.sessionId).then(unwrap);}
    catch(error){notify('error',errorMessage(error));}
  };
  const send=async()=>{if(!selectedProjectId||!draft.trim()||dirty||(!current&&!newChatModel))return;const text=draft;const projectRoot=selectedProject?.root;historyIndex.current=null;setMention(null);setDraft('');
    try{
      let session=current;
      if(!session){
        let snapshot=await window.revu.agent.newSession(selectedProjectId).then(unwrap);
        if(!snapshot.model||snapshot.model.provider!==newChatModel!.provider||snapshot.model.id!==newChatModel!.id)
          snapshot=await window.revu.agent.setModel(selectedProjectId,snapshot.sessionId,newChatModel!.provider,newChatModel!.id).then(unwrap);
        if(snapshot.thinkingLevel!==newChatThinking)
          snapshot=await window.revu.agent.setThinkingLevel(selectedProjectId,snapshot.sessionId,newChatThinking).then(unwrap);
        session=withSnapshot(snapshot);setChats(state=>({...state,[snapshot.sessionId]:session!}));
        setOpenSessionIds(current=>({...current,[selectedProjectId]:[...(current[selectedProjectId]??[]),snapshot.sessionId]}));setSelectedSessionId(snapshot.sessionId);
      }
      await window.revu.agent.prompt(selectedProjectId,session.sessionId,text).then(unwrap);if(projectRoot)rememberInput(projectRoot,text);
    }
    catch(error){setDraft(text);notify('error',error instanceof Error?error.message:String(error));}
  };
  const stop=async()=>{if(!current||!selectedProjectId)return;setAbortArmed(false);if(abortTimer.current)clearTimeout(abortTimer.current);
    try{await window.revu.agent.stop(selectedProjectId,current.sessionId).then(unwrap);}catch(error){notify('error',error instanceof Error?error.message:String(error));}};
  const confirmAbort=()=>{if(abortArmed){void stop();return;}setAbortArmed(true);if(abortTimer.current)clearTimeout(abortTimer.current);
    abortTimer.current=setTimeout(()=>setAbortArmed(false),2000);};
  const applyContextSnapshot=(snapshot:PiSessionSnapshot)=>setChats(state=>{const chat=state[snapshot.sessionId];if(!chat)return state;
    const next={...state,[snapshot.sessionId]:{...chat,usage:snapshot.usage,autoCompactionEnabled:snapshot.autoCompactionEnabled,isCompacting:snapshot.isCompacting}};chatsRef.current=next;return next;});
  const compactContext=async()=>{if(!current||!selectedProjectId||contextOperation)return;setContextOperation('compact');setCompactionResult(undefined);try{
    const response=await window.revu.agent.compact(selectedProjectId,current.sessionId).then(unwrap);applyContextSnapshot(response.snapshot);setCompactionResult(response.result);
  }catch(error){notify('error',errorMessage(error));}finally{setContextOperation(null);}};
  const toggleAutoCompaction=async()=>{if(!current||!selectedProjectId||contextOperation)return;setContextOperation('toggle');try{
    const snapshot=await window.revu.agent.setAutoCompaction(selectedProjectId,current.sessionId,!current.autoCompactionEnabled).then(unwrap);applyContextSnapshot(snapshot);
  }catch(error){notify('error',errorMessage(error));}finally{setContextOperation(null);}};
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
          const tone=sessionTone(chat?.status??summary?.status??'idle',doneSessionIds.has(sessionId));return <div ref={active?activeSessionTabRef:undefined} className={`agent-session-tab status-${tone} ${active?'active':''}`} key={sessionId}
            onContextMenu={event=>void sessionTabContext(event,sessionId)}>
            <button role="tab" aria-selected={selectedSessionId===sessionId} title={titleFor(summary,chat)} onClick={()=>void openSessionById(selectedProjectId,sessionId)}>{titleFor(summary,chat)}</button>
            <button className="agent-session-tab-close" title="Close Chat" aria-label={`Close ${titleFor(summary,chat)}`} onClick={()=>closeSessionTab(sessionId)}><Icon name="close" size={10}/></button>
          </div>;})}
          {!selectedSessionId&&selectedProjectId&&<div ref={activeSessionTabRef} className="agent-session-tab active new"><button role="tab" aria-selected="true">New Chat</button>
            {!!sessionTabs.length&&<button className="agent-session-tab-close" title="Close Chat" aria-label="Close New Chat" onClick={closeNewChatTab}><Icon name="close" size={10}/></button>}</div>}
        </div>
        <button ref={sessionMoreRef} className="agent-icon-button agent-session-more" title="Open Chats" aria-label="Open chats" aria-haspopup="listbox" aria-expanded={sessionMenuOpen}
          disabled={!sessionTabs.length} onClick={()=>setSessionMenuOpen(value=>!value)}><Icon name="more" size={15}/></button>
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
        :<>{runs.map(run=>{const messageKey=`${current.sessionId}:${run.key}`;const answerText=assistantText(run);const showSource=sourceMessageKeys.has(messageKey);
          const latest=run.key===runs.at(-1)?.key;const showActions=shouldShowAssistantActions(latest,current.status);const autoRetry=latest?current.autoRetry:undefined;return <section className="agent-run" key={run.key} ref={element=>{if(element)runRefs.current.set(run.key,element);else runRefs.current.delete(run.key);}}>
          {run.user&&<article className="agent-message user"><div className="agent-user-bubble">{run.user}</div>
            <footer className="agent-user-meta">{run.userTimestamp!==undefined&&<time dateTime={new Date(run.userTimestamp).toISOString()} title={formatFullTime(run.userTimestamp)}>{formatTime(run.userTimestamp)}</time>}
              <button type="button" title={copiedMessageKey===messageKey+'-user'?'Copied':'Copy'} aria-label="Copy user message" onClick={()=>void copyMessage(messageKey+'-user',run.user)}>
                <Icon name={copiedMessageKey===messageKey+'-user'?'check':'copy'} size={12}/></button>
              <button type="button" disabled={!run.userEntryId||!['idle','error'].includes(current.status)||current.isCompacting} title={run.userEntryId?'Fork from this message':'Fork unavailable'} aria-label="Fork from this message" onClick={()=>void forkRun(run)}>
                <Icon name="fork" size={12}/></button>
            </footer></article>}
          {(!!run.items.length||showActions||!!autoRetry)&&<div className="agent-response"><span className="agent-role" role="img" aria-label="Pi"><Icon name="pi" size={16}/></span>{run.items.map(part=>part.type==='answer'
            ?part.streaming||showSource?<div className={'agent-answer source '+(part.streaming?'streaming':'')} key={part.key}>{part.text}</div>
              :<MarkdownContent text={part.text??''} key={part.key}/>
            :part.type==='thinking'?<details className="agent-thinking" key={part.key} open={part.streaming||undefined} onToggle={()=>requestAnimationFrame(updateRunRail)}><summary title="Toggle thought process"><Icon name="thought" size={16}/><span>Thought process</span></summary><div>{part.text}</div></details>
            :part.tool&&<details className={`agent-tool ${part.tool.status}`} key={part.key} onToggle={()=>requestAnimationFrame(updateRunRail)}><summary><span>{part.tool.name}</span>
              <span className="agent-tool-meta">{part.tool.usage&&<span className="agent-tool-usage">{usageMeta(part.tool.usage)}</span>}{toolDuration(part.tool,toolClock)!==undefined&&<time>{formatToolDuration(toolDuration(part.tool,toolClock)!)}</time>}<small>{part.tool.status}</small></span></summary>
              <div className="agent-tool-detail"><button type="button" className="agent-tool-expand" title="Open in Editor" aria-label={`Open ${part.tool.name} details in editor`}
                onClick={()=>onOpenToolDetail(toolDetail(current,part.tool!,toolClock))}><Icon name="expand" size={13}/></button>
                <pre>{JSON.stringify({input:part.tool.args,output:part.tool.result},null,2)}</pre></div></details>)}
            {autoRetry&&<div className="agent-auto-retry" role="status"><span><strong>Auto retry</strong><span title={autoRetry.errorMessage}>{autoRetry.errorMessage}</span></span>
              <small>{`Retrying ${autoRetry.attempt}/${autoRetry.maxAttempts} in ${Math.max(0,Math.ceil((autoRetry.deadline-retryClock)/1000))}s`}</small></div>}
            {(showActions||run.stopReason)&&<div className="agent-response-footer">{showActions&&<div className="agent-message-actions" aria-label="Assistant message actions">
                <button type="button" disabled={!answerText} title={copiedMessageKey===messageKey+'-assistant'?'Copied':'Copy'} aria-label="Copy assistant message"
                  onClick={()=>void copyMessage(messageKey+'-assistant',answerText)}><Icon name={copiedMessageKey===messageKey+'-assistant'?'check':'copy'} size={14}/></button>
                <button type="button" disabled={!answerText} title={showSource?'Show Preview':'Show Source'} aria-label={showSource?'Show Markdown preview':'Show Markdown source'}
                  aria-pressed={showSource} onClick={()=>toggleMessageSource(messageKey)}><Icon name="format" size={14}/></button>
                <button type="button" disabled title="Retry · Coming soon" aria-label="Retry · Coming soon"><Icon name="retry" size={14}/></button>
                <button type="button" disabled title="More · Coming soon" aria-label="More · Coming soon"><Icon name="more" size={14}/></button>
              </div>}<div className="agent-response-meta">{run.stopReason&&<span className={`agent-stop-reason ${run.stopReason}`}>{stopReasonLabel(run.stopReason)}</span>}
                {showActions&&answerText&&<button ref={statsRunKey===run.key?statsButtonRef:undefined} type="button" className="agent-run-stats-button" title="View run details" aria-haspopup="dialog" aria-expanded={statsRunKey===run.key}
                  onClick={()=>setStatsRunKey(current=>current===run.key?'':run.key)}>{runStatsSummary(run)}</button>}</div></div>}</div>}
        </section>;})}
          {current.error&&<div className="agent-inline-error">{current.error}</div>}</>}
        </div>
      </div>
      <div ref={composerRef} className={`agent-composer ${composerExpanded?'expanded':''} ${showQueuePanel?'queues-visible':''}`}>{dirty&&<div className="agent-dirty-warning">Save unsaved files before running Pi.</div>}
        {showQueuePanel&&<div className="agent-input-queues" aria-label="Queued messages">
          <div className="agent-input-queue-row"><Icon name="steering" size={17}/><div className="agent-input-queue-messages">
            {queue.steering.map((message,index)=><span key={`${index}:${message}`} title={message}>{message}</span>)}</div>
            <button type="button" className="agent-input-queue-submit" disabled={!agentRunning||!draft.trim()} title="Steer the current run (Enter)" onClick={()=>void queueDraft('steering')}>
              <Icon name="steeringButton" size={16}/><span>Steering</span></button></div>
          <div className="agent-input-queue-row"><Icon name="followUp" size={15}/><div className="agent-input-queue-messages">
            {queue.followUp.map((message,index)=><span key={`${index}:${message}`} title={message}>{message}</span>)}</div>
            <button type="button" className="agent-input-queue-submit" disabled={!agentRunning||!draft.trim()} title="Queue follow-up (Alt+Enter)" onClick={()=>void queueDraft('followUp')}>
              <Icon name="followUpButton" size={16}/><span>FollowUp</span></button></div>
        </div>}
        {mention&&<div className="agent-path-menu" role="listbox" aria-label="Project files and folders">
          {mentionLoading?<div className="agent-path-empty">Searching…</div>:mentionError?<div className="agent-path-empty error">{mentionError}</div>
            :mentionOptions.length?mentionOptions.map((entry,index)=><button type="button" role="option" aria-selected={index===mentionIndex}
              className={index===mentionIndex?'selected':''} title={entry.path} key={`${entry.kind}:${entry.path}`}
              onMouseDown={event=>{event.preventDefault();acceptMention(entry);}}>
              <Icon name={entry.kind==='directory'?'chatFolder':'chatFile'} size={15}/><span>{entry.path}</span></button>)
            :<div className="agent-path-empty">No matching files or folders</div>}
        </div>}
        {selectedProjectId&&draft.length>0&&<button className="agent-composer-expand" title={composerExpanded?'Collapse Input':'Expand Input'} aria-label={composerExpanded?'Collapse Input':'Expand Input'}
          onClick={()=>{if(composerExpanded){composerExpansionSource.current=null;composerManuallyCollapsed.current=true;setComposerExpanded(false);}
            else{composerExpansionSource.current='manual';composerManuallyCollapsed.current=false;setComposerExpanded(true);}}}><Icon name={composerExpanded?'collapse':'expand'} size={15}/></button>}
        <textarea ref={textareaRef} value={draft} disabled={!selectedProjectId} placeholder="" onPaste={event=>void pasteFiles(event)}
          onBlur={event=>{if(!composerRef.current?.contains(event.relatedTarget as Node|null))setMention(null);}}
          onSelect={event=>setMention(mentionAt(draft,event.currentTarget.selectionStart))}
          onChange={event=>{historyIndex.current=null;draftRef.current=event.target.value;setDraft(event.target.value);setMention(mentionAt(event.target.value,event.target.selectionStart));setMentionIndex(0);}}
          onKeyDown={event=>{
            if(mention){
              if(event.key==='ArrowDown'){event.preventDefault();if(mentionOptions.length)setMentionIndex(index=>Math.min(mentionOptions.length-1,index+1));return;}
              if(event.key==='ArrowUp'){event.preventDefault();if(mentionOptions.length)setMentionIndex(index=>Math.max(0,index-1));return;}
              if(event.key==='Escape'){event.preventDefault();setMention(null);return;}
              if(event.key==='Enter'&&!event.shiftKey&&mentionOptions[mentionIndex]){event.preventDefault();acceptMention(mentionOptions[mentionIndex]);return;}
            }
            if(event.key==='Escape'&&agentRunning){event.preventDefault();confirmAbort();return;}
            if(event.key==='ArrowUp'&&browseHistory(-1)){event.preventDefault();return;}
            if(event.key==='ArrowDown'&&historyIndex.current!==null&&browseHistory(1)){event.preventDefault();return;}
            if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();if(agentRunning)void queueDraft(event.altKey?'followUp':'steering');else void send();}
          }}/>
        {showQueuePanel&&queueCount>0&&<button type="button" className="agent-input-queue-clear" title="Clear Queue" aria-label="Clear queued messages" onClick={()=>void clearPendingQueue()}><Icon name="clear" size={13}/></button>}
        <footer><div className="agent-reference-actions">
          <button type="button" title="Mention File or Folder" aria-label="Mention file or folder" disabled={!selectedProjectId} onClick={insertMentionTrigger}><Icon name="mention" size={14}/></button>
          <button type="button" title="Choose File" aria-label="Choose file" disabled={!selectedProjectId} onClick={()=>void chooseFiles()}><Icon name="add" size={14}/></button>
        </div><div className="agent-model-control" ref={modelControlRef}
            onBlur={event=>{const next=event.relatedTarget as Node|null;if(!event.currentTarget.contains(next)&&!modelMenuRef.current?.contains(next))setModelMenu(false);}}><button className="agent-footer-select-trigger"
              aria-haspopup="listbox" aria-expanded={modelMenu} disabled={!selectedProjectId||current?.status==='running'} onClick={()=>modelMenu?setModelMenu(false):void loadModels()}>
          {selectedModel?`${selectedModel.id} · ${selectedThinking}`:'Select Model'}<Icon name="down" size={11}/></button></div>
          {current?.status==='running'||current?.status==='stopping'?<button className="agent-send stop" onClick={()=>void stop()}>{abortArmed?'Abort ?':<><Icon name="stop" size={14}/>Stop</>}</button>
            :<button className="agent-send" disabled={!selectedProjectId||!selectedModel||!draft.trim()||dirty} onClick={()=>void send()}><Icon name="send" size={14}/>Send</button>}</footer>
      </div>
      {selectedProjectId&&<div className="agent-session-meta"><span className="agent-project-path" title={selectedProject?.root}>{selectedProject?.root}</span>
        <div className="agent-context-control" ref={contextRef}><button className="agent-context-summary" aria-haspopup="dialog" aria-expanded={contextOpen} onClick={()=>setContextOpen(value=>!value)}>{formatContextPercent(usage.contextPercent)}</button>
          {contextOpen&&<section className="agent-context-popover" role="dialog" aria-label="Context usage"><header><strong>Context</strong>{(current?.isCompacting||contextOperation==='compact')&&<span>Compacting…</span>}</header>
            <dl><div><dt>Used</dt><dd>{contextTokens.toLocaleString()}</dd></div><div><dt>Window</dt><dd>{contextWindow.toLocaleString()}</dd></div><div><dt>Remaining</dt><dd>{remainingContext.toLocaleString()}</dd></div></dl>
            <div className="agent-context-actions"><button className="agent-context-toggle" disabled={!current||!!contextOperation||current.status==='running'||current.status==='stopping'||current.isCompacting} aria-pressed={current?.autoCompactionEnabled??false} onClick={()=>void toggleAutoCompaction()}>
              <span>Auto compact</span><i>{contextOperation==='toggle'?'…':current?.autoCompactionEnabled?'On':'Off'}</i></button>
              <button className="agent-compact-now" disabled={!current||!!contextOperation||current.status==='running'||current.status==='stopping'||current.isCompacting} onClick={()=>void compactContext()}>{contextOperation==='compact'||current?.isCompacting?'Compacting…':'Compact Now'}</button></div>
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
    </aside>
    {sessionMenuOpen&&createPortal(<div ref={sessionMoreMenuRef} style={sessionMenuStyle} className="agent-session-more-menu" role="listbox" aria-label="Open chats">
      {[...sessionTabs].reverse().map(sessionId=>{const summary=(sessions[selectedProjectId]??[]).find(item=>item.id===sessionId);const chat=chats[sessionId];const active=selectedSessionId===sessionId;
        const tone=sessionTone(chat?.status??summary?.status??'idle',doneSessionIds.has(sessionId));return <button type="button" role="option" aria-selected={active} className={active?'selected':''} key={sessionId}
          onClick={()=>{setSessionMenuOpen(false);void openSessionById(selectedProjectId,sessionId);}}><i className={`session-menu-status ${tone}`}/><span>{titleFor(summary,chat)}</span></button>;})}
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
      onProject={id=>{setSelectedProjectId(id);setSelectedSessionId(null);setNewChatModel(undefined);setDraft('');void reloadSessions(id);}} onOpen={session=>void openCatalogSession(session)} onNew={startNewChat}
      onRename={(session,name)=>void window.revu.agent.renameSession(session.projectId,session.id,name,session.scope).then(unwrap).then(()=>{setChats(current=>{
        const chat=current[session.id];return chat?{...current,[session.id]:{...chat,name}}:current;});return reloadSessions(session.projectId);}).catch(error=>notify('error',errorMessage(error)))}
      onDelete={session=>{if(window.confirm(`Delete “${session.name}”? The session will be moved to the Recycle Bin.`))void window.revu.agent.deleteSession(session.projectId,session.id,session.scope).then(unwrap).then(()=>{
        setChats(current=>{const next={...current};delete next[session.id];return next;});setOpenSessionIds(current=>({...current,[session.projectId]:(current[session.projectId]??[]).filter(id=>id!==session.id)}));
        if(selectedSessionId===session.id)startNewChat();return reloadSessions(session.projectId);
      }).catch(error=>notify('error',errorMessage(error)));}} onClone={session=>void cloneSession(session)} onExport={session=>void exportSession(session)}
      onFolderChanged={()=>void reloadSessions(selectedProjectId)} onClose={()=>setSessionDialog(false)}/>}
    {treeDialog&&current&&<SessionTreeDialog projectId={current.projectId} sessionId={current.sessionId} onClose={()=>setTreeDialog(false)}
      onNavigated={response=>void adoptTreeNavigation(response)} notify={notify}/>}
    {modelDialog&&selectedProjectId&&<ModelDialog projectId={selectedProjectId} sessionId={selectedSessionId??undefined} onClose={()=>setModelDialog(false)}
      onChanged={()=>{if(!selectedSessionId)void loadNewChatDefaults(selectedProjectId);}} notify={notify}/>} 
  </>;
}

function errorMessage(error:unknown){return error instanceof Error?error.message:String(error);}
