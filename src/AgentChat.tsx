import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Project } from './editor';
import Icon from './Icon';
import type {
  PiModelDefaults,PiModelSummary,PiProviderStatus,PiRuntimeStatus,PiSessionSnapshot,
  PiSessionSummary,PiThinkingLevel,PiUsageStats,RevuPiEvent,
} from '../shared/piTypes';

export interface ToolState {id:string;turnKey:string;name:string;status:'running'|'done'|'error';args?:unknown;result?:unknown}
export interface ChatState extends PiSessionSnapshot {tools:ToolState[];streamText:string;streamThinking:string}
interface TurnItem {type:'answer'|'thinking'|'tool';key:string;text?:string;tool?:ToolState;streaming?:boolean}
interface ChatTurn {key:string;user:string;items:TurnItem[]}
type Notify=(level:'info'|'warning'|'error',message:string)=>void;
interface SelectOption {value:string;label:string}
interface SelectGroup {label?:string;options:SelectOption[]}

const THINKING_LEVELS:PiThinkingLevel[]=['off','minimal','low','medium','high','xhigh','max'];
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
const turnKey=(index:number)=>`turn-${Math.max(0,index)}`;
const lastTurnKey=(messages:unknown[])=>turnKey(messages.reduce<number>((count,message)=>count+(record(message).role==='user'?1:0),0)-1);
const toolsFromMessages=(messages:unknown[]):ToolState[]=>{
  const tools=new Map<string,ToolState>();let turnIndex=-1;
  for(const message of messages){const item=record(message);const role=item.role;
    if(role==='user'){turnIndex++;continue;}
    if(role==='assistant'&&Array.isArray(item.content))for(const raw of item.content){const block=record(raw);if(block.type!=='toolCall')continue;
      const id=String(block.id??'');if(!id)continue;tools.set(id,{id,turnKey:turnKey(turnIndex),name:String(block.name??'Tool'),status:'running',args:block.arguments});}
    if(role==='toolResult'){const id=String(item.toolCallId??'');if(!id)continue;const existing=tools.get(id);
      tools.set(id,{id,turnKey:existing?.turnKey??turnKey(turnIndex),name:String(item.toolName??existing?.name??'Tool'),status:item.isError?'error':'done',args:existing?.args,result:message});}
  }
  return [...tools.values()];
};
export const withSnapshot=(snapshot:PiSessionSnapshot,previous?:ChatState):ChatState=>({
  ...snapshot,tools:(()=>{const history=toolsFromMessages(snapshot.messages);const known=new Set(history.map(tool=>tool.id));
    return [...history,...(previous?.tools??[]).filter(tool=>tool.status==='running'&&!known.has(tool.id))];})(),streamText:'',streamThinking:'',
});
const buildTurns=(state:ChatState):ChatTurn[]=>{
  const turns:ChatTurn[]=[];const tools=new Map(state.tools.map(tool=>[tool.id,tool]));const placed=new Set<string>();let current:ChatTurn|undefined;
  const ensureTurn=()=>current??(current={key:turnKey(turns.length),user:'',items:[]},turns.push(current),current);
  for(const message of state.messages){const item=record(message);const role=item.role;
    if(role==='user'){current={key:turnKey(turns.length),user:messageText(message),items:[]};turns.push(current);continue;}
    if(role==='assistant'&&Array.isArray(item.content)){const turn=ensureTurn();for(const raw of item.content){const block=record(raw);
      if(block.type==='text'&&typeof block.text==='string'&&block.text.trim())turn.items.push({type:'answer',key:`answer-${turn.items.length}`,text:block.text});
      if(block.type==='thinking'&&typeof block.thinking==='string'&&block.thinking.trim())turn.items.push({type:'thinking',key:`thinking-${turn.items.length}`,text:block.thinking});
      if(block.type==='toolCall'){const id=String(block.id??'');if(!id||placed.has(id))continue;const tool=tools.get(id)??{id,turnKey:turn.key,name:String(block.name??'Tool'),status:'running',args:block.arguments};
        turn.items.push({type:'tool',key:id,tool});placed.add(id);}
    }}
    if(role==='toolResult'){const id=String(item.toolCallId??'');if(!id||placed.has(id))continue;const tool=tools.get(id);if(tool){ensureTurn().items.push({type:'tool',key:id,tool});placed.add(id);}}
  }
  for(const tool of state.tools){if(placed.has(tool.id))continue;const turn=turns.find(candidate=>candidate.key===tool.turnKey)??ensureTurn();turn.items.push({type:'tool',key:tool.id,tool});placed.add(tool.id);}
  const live=ensureTurn();if(state.streamThinking)live.items.push({type:'thinking',key:'stream-thinking',text:state.streamThinking,streaming:true});
  if(state.streamText)live.items.push({type:'answer',key:'stream-answer',text:state.streamText,streaming:true});
  return turns.filter(turn=>turn.user||turn.items.length);
};
const titleFor=(session?:PiSessionSummary,snapshot?:ChatState)=>snapshot?.name&&snapshot.name!=='New Chat'
  ?snapshot.name:session?.name??'New Chat';
const formatTokens=(value:number)=>value>=1_000_000?`${(value/1_000_000).toFixed(1)}m`:value>=1000?`${(value/1000).toFixed(1)}k`:String(value);
const formatTime=(value:number)=>new Intl.DateTimeFormat(undefined,{hour:'2-digit',minute:'2-digit'}).format(value);
const PROVIDER_NAMES:Record<string,string>={anthropic:'Anthropic',openai:'OpenAI',google:'Google Gemini',openrouter:'OpenRouter',deepseek:'DeepSeek',xai:'xAI',groq:'Groq',mistral:'Mistral',cerebras:'Cerebras',nvidia:'NVIDIA NIM',zai:'ZAI',moonshotai:'Moonshot AI','moonshotai-cn':'Moonshot AI CN'};
const providerName=(id:string)=>PROVIDER_NAMES[id]??id;
const modelValue=(provider:string,id:string)=>`${provider}\u0000${id}`;
const modelGroups=(models:PiModelSummary[]):SelectGroup[]=>{
  const groups=new Map<string,SelectOption[]>();
  for(const model of models){const options=groups.get(model.provider)??[];options.push({value:modelValue(model.provider,model.id),label:model.id});groups.set(model.provider,options);}
  return [...groups].map(([provider,options])=>({label:providerName(provider),options}));
};

function AgentSelect({value,groups,placeholder,onChange,disabled=false,placement='down',align='start',compact=false}:{
  value?:string;groups:SelectGroup[];placeholder:string;onChange:(value:string)=>void;disabled?:boolean;
  placement?:'up'|'down';align?:'start'|'end';compact?:boolean;
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
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false);};const close=()=>setOpen(false);
    document.addEventListener('pointerdown',outside);document.addEventListener('focusin',outside);document.addEventListener('keydown',escape);
    window.addEventListener('resize',close);window.addEventListener('scroll',close,true);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside);document.removeEventListener('keydown',escape);window.removeEventListener('resize',close);window.removeEventListener('scroll',close,true);};
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
    <span className={selected?'':'placeholder'}>{selected?.label??placeholder}</span><Icon name="chevron" size={12}/></button>
    {open&&createPortal(<div ref={menu} style={menuStyle} className="agent-select-menu" role="listbox">{groups.map((group,index)=><section key={group.label??index}>
      {group.label&&<strong>{group.label}</strong>}{group.options.map(option=><button type="button" role="option" aria-selected={option.value===value}
        className={option.value===value?'selected':''} key={option.value} onClick={()=>choose(option.value)}><span>{option.label}</span>{option.value===value&&<i>✓</i>}</button>)}</section>)}</div>,document.body)}
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
    const message=item.message;const key=messageKey(message);const index=current.messages.findIndex(existing=>messageKey(existing)===key);
    const messages=index<0?[...current.messages,message]:current.messages.map((existing,i)=>i===index?message:existing);
    return {...current,messages,streamText:'',streamThinking:''};
  }
  if(type==='tool_execution_start'){
    const id=String(item.toolCallId);const tool:ToolState={id,turnKey:lastTurnKey(current.messages),name:String(item.toolName),status:'running',args:item.args};
    return {...current,tools:[...current.tools.filter(existing=>existing.id!==id),tool]};
  }
  if(type==='tool_execution_update'){
    const id=String(item.toolCallId);
    return {...current,tools:current.tools.map(tool=>tool.id===id?{...tool,result:item.partialResult}:tool)};
  }
  if(type==='tool_execution_end'){
    const id=String(item.toolCallId);const result=record(item.result);
    return {...current,tools:current.tools.map(tool=>tool.id===id?{...tool,status:result.isError?'error':'done',result:item.result}:tool)};
  }
  return current;
}

function SessionDialog({projects,projectId,selectedSessionId,sessions,onProject,onOpen,onNew,onRename,onDelete,onClose}:{
  projects:Project[];projectId:string;sessions:PiSessionSummary[];onProject:(id:string)=>void;
  selectedSessionId:string|null;
  onOpen:(session:PiSessionSummary)=>void;onNew:()=>void;onRename:(session:PiSessionSummary,name:string)=>void;
  onDelete:(session:PiSessionSummary)=>void;onClose:()=>void;
}){
  const [renaming,setRenaming]=useState<string|null>(null);const [name,setName]=useState('');
  const now=new Date();const today=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime();
  const groups=[
    ['Today',(item:PiSessionSummary)=>item.modifiedAt>=today],
    ['Yesterday',(item:PiSessionSummary)=>item.modifiedAt>=today-86400000&&item.modifiedAt<today],
    ['Previous 7 Days',(item:PiSessionSummary)=>item.modifiedAt>=today-6*86400000&&item.modifiedAt<today-86400000],
    ['Older',(item:PiSessionSummary)=>item.modifiedAt<today-6*86400000],
  ] as const;
  return <div className="agent-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}>
    <section className="agent-modal session-dialog" role="dialog" aria-modal="true" aria-label="Sessions">
      <header><strong>Sessions</strong><div><button className="agent-primary" onClick={onNew}>New Chat</button><button className="agent-icon-button" onClick={onClose} aria-label="Close"><Icon name="close" size={15}/></button></div></header>
      {projects.length>1&&<nav className="session-project-tabs" aria-label="Projects">{projects.map(project=><button key={project.id}
        className={project.id===projectId?'active':''} onClick={()=>onProject(project.id)}>{project.name}</button>)}</nav>}
      <div className="session-groups">{sessions.length===0?<p className="agent-empty">No conversations yet.</p>:groups.map(([label,match])=>{
        const items=sessions.filter(match);if(!items.length)return null;
        return <section className="session-group" key={label}><h3>{label}</h3>{items.map(session=><div className={'session-row '+(session.id===selectedSessionId?'active':'')} key={session.id}>
          {renaming===session.id?<form onSubmit={event=>{event.preventDefault();onRename(session,name);setRenaming(null);}}>
            <input autoFocus value={name} onChange={event=>setName(event.target.value)}/><button type="submit">Save</button><button type="button" onClick={()=>setRenaming(null)}>Cancel</button>
          </form>:<>
            <button className="session-select" onClick={()=>onOpen(session)}><span>{session.name}</span><small>{formatTime(session.modifiedAt)} · {session.messageCount} messages</small></button>
            <span className={`session-status ${session.status}`}><i/>{session.status==='running'?'Running':session.status==='error'?'Error':'Idle'}</span>
            <div className="session-actions"><button className="session-action" onClick={()=>{setRenaming(session.id);setName(session.name);}}>Rename</button>
              <button className="session-action" onClick={()=>onDelete(session)}>Delete</button></div>
          </>}
        </div>)}</section>;
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

export default function AgentChat({open,projects,activeProjectId,dirtyProjectIds,width,onResize,onResizeEnd,notify}:{
  open:boolean;projects:Project[];activeProjectId:string|null;dirtyProjectIds:ReadonlySet<string>;width:number;
  onResize:(width:number)=>void;onResizeEnd:(width:number)=>void;notify:Notify;
}){
  const [selectedProjectId,setSelectedProjectId]=useState<string>('');const [selectedSessionId,setSelectedSessionId]=useState<string|null>(null);
  const [sessions,setSessions]=useState<Record<string,PiSessionSummary[]>>({});const [chats,setChats]=useState<Record<string,ChatState>>({});
  const [draft,setDraft]=useState('');const [sessionDialog,setSessionDialog]=useState(false);const [modelDialog,setModelDialog]=useState(false);
  const [modelMenu,setModelMenu]=useState(false);const [models,setModels]=useState<PiModelSummary[]>([]);const [loading,setLoading]=useState(false);
  const [composerExpanded,setComposerExpanded]=useState(false);
  const [newChatModel,setNewChatModel]=useState<PiModelSummary|undefined>();const [newChatThinking,setNewChatThinking]=useState<PiThinkingLevel>('medium');
  const [modelMenuStyle,setModelMenuStyle]=useState<React.CSSProperties>({});
  const bodyRef=useRef<HTMLDivElement|null>(null);const modelControlRef=useRef<HTMLDivElement|null>(null);const modelMenuRef=useRef<HTMLDivElement|null>(null);const draftConfigRequest=useRef(0);
  const selectedProject=projects.find(project=>project.id===selectedProjectId);
  const current=selectedSessionId?chats[selectedSessionId]:undefined;
  const currentSession=(sessions[selectedProjectId]??[]).find(item=>item.id===selectedSessionId);
  const dirty=selectedProjectId?dirtyProjectIds.has(selectedProjectId):false;
  const reloadSessions=async(projectId:string)=>{
    try{const items=await window.revu.agent.listSessions(projectId).then(unwrap);setSessions(current=>({...current,[projectId]:items}));return items;}
    catch(error){notify('error',error instanceof Error?error.message:String(error));return [];}
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
  useEffect(()=>{if(selectedProjectId&&!selectedSessionId)void loadNewChatDefaults(selectedProjectId);},[selectedProjectId,selectedSessionId]);
  useEffect(()=>{if(selectedSessionId)draftConfigRequest.current++;setComposerExpanded(false);setModelMenu(false);},[selectedSessionId]);
  useLayoutEffect(()=>{if(!modelMenu||!modelControlRef.current)return;const trigger=modelControlRef.current.getBoundingClientRect();
    const panel=modelControlRef.current.closest('.agent-chat')?.getBoundingClientRect();const limitLeft=panel?panel.left+8:8;const limitRight=panel?panel.right-8:window.innerWidth-8;
    const width=Math.max(190,Math.min(236,limitRight-limitLeft));const left=Math.max(limitLeft,Math.min(limitRight-width,trigger.right-width));
    setModelMenuStyle({position:'fixed',left,width,bottom:window.innerHeight-trigger.top+7,maxHeight:Math.max(160,Math.min(340,trigger.top-14))});
  },[modelMenu]);
  useEffect(()=>{if(!modelMenu)return;
    const outside=(event:PointerEvent|FocusEvent)=>{const target=event.target as Node;if(!modelControlRef.current?.contains(target)&&!modelMenuRef.current?.contains(target))setModelMenu(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setModelMenu(false);};const close=()=>setModelMenu(false);
    document.addEventListener('pointerdown',outside);document.addEventListener('focusin',outside);document.addEventListener('keydown',escape);
    window.addEventListener('resize',close);window.addEventListener('scroll',close,true);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside);document.removeEventListener('keydown',escape);window.removeEventListener('resize',close);window.removeEventListener('scroll',close,true);};
  },[modelMenu]);
  useEffect(()=>window.revu.agent.onEvent((event:RevuPiEvent)=>{
    if(event.type==='event')setChats(current=>{
      const chat=current[event.sessionId];return chat?{...current,[event.sessionId]:updateEvent(chat,event.payload)}:current;
    });
    if(event.type==='status'){
      const status=event.payload as PiRuntimeStatus;
      setChats(current=>{const chat=current[event.sessionId];return chat?{...current,[event.sessionId]:{...chat,status}}:current;});
      setSessions(current=>({...current,[event.projectId]:(current[event.projectId]??[]).map(session=>session.id===event.sessionId?{...session,status}:session)}));
    }
    if(event.type==='usage')setChats(current=>{
      const chat=current[event.sessionId];return chat?{...current,[event.sessionId]:{...chat,usage:event.payload as PiUsageStats}}:current;
    });
    if(event.type==='error'){
      const message=typeof event.payload==='string'?event.payload:'Pi Agent failed.';notify('error',message);
      setChats(current=>{const chat=current[event.sessionId];return chat?{...current,[event.sessionId]:{...chat,status:'error',error:message}}:current;});
      setSessions(current=>({...current,[event.projectId]:(current[event.projectId]??[]).map(session=>session.id===event.sessionId?{...session,status:'error'}:session)}));
    }
    if(event.type==='sessions-changed')void reloadSessions(event.projectId);
  }),[notify]);
  useEffect(()=>{bodyRef.current?.scrollTo({top:bodyRef.current.scrollHeight});},[current?.messages,current?.streamText,current?.streamThinking,current?.tools]);
  const openSession=async(session:PiSessionSummary)=>{setLoading(true);try{
    const snapshot=await window.revu.agent.openSession(session.projectId,session.id).then(unwrap);
    setChats(current=>({...current,[snapshot.sessionId]:withSnapshot(snapshot,current[snapshot.sessionId])}));setSelectedProjectId(session.projectId);setSelectedSessionId(snapshot.sessionId);setDraft('');setSessionDialog(false);
  }catch(error){notify('error',error instanceof Error?error.message:String(error));setModelDialog(true);}finally{setLoading(false);}};
  const startNewChat=()=>{if(!selectedProjectId)return;setSelectedSessionId(null);setNewChatModel(undefined);setDraft('');setSessionDialog(false);setComposerExpanded(false);void loadNewChatDefaults(selectedProjectId);};
  const send=async()=>{if(!selectedProjectId||!draft.trim()||dirty||(!current&&!newChatModel))return;const text=draft;setDraft('');
    try{
      let session=current;
      if(!session){
        let snapshot=await window.revu.agent.newSession(selectedProjectId).then(unwrap);
        if(!snapshot.model||snapshot.model.provider!==newChatModel!.provider||snapshot.model.id!==newChatModel!.id)
          snapshot=await window.revu.agent.setModel(selectedProjectId,snapshot.sessionId,newChatModel!.provider,newChatModel!.id).then(unwrap);
        if(snapshot.thinkingLevel!==newChatThinking)
          snapshot=await window.revu.agent.setThinkingLevel(selectedProjectId,snapshot.sessionId,newChatThinking).then(unwrap);
        session=withSnapshot(snapshot);setChats(state=>({...state,[snapshot.sessionId]:session!}));setSelectedSessionId(snapshot.sessionId);
      }
      await window.revu.agent.prompt(selectedProjectId,session.sessionId,text).then(unwrap);
    }
    catch(error){setDraft(text);notify('error',error instanceof Error?error.message:String(error));}
  };
  const stop=async()=>{if(!current||!selectedProjectId)return;try{await window.revu.agent.stop(selectedProjectId,current.sessionId).then(unwrap);}catch(error){notify('error',error instanceof Error?error.message:String(error));}};
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
  const turns=current?buildTurns(current):[];
  const selectedModel=current?.model??newChatModel;const selectedThinking=current?.thinkingLevel??newChatThinking;
  const thinkingOptions=(current?.availableThinkingLevels??THINKING_LEVELS).map(level=>({value:level,label:level}));
  const groupedModels=modelGroups(models);
  return <>
    <aside className={'agent-chat '+(open?'open':'')} style={{width:open?width:0}} aria-hidden={!open}>
      <div className="agent-resize-handle" onPointerDown={beginResize}/>
      <header className="agent-chat-header"><button className="agent-session-trigger" disabled={!projects.length} onClick={()=>setSessionDialog(true)}>
        <span>{selectedProject?.name??'No Project'}</span><i>/</i><strong>{titleFor(currentSession,current)}</strong><Icon name="chevron" size={12}/></button>
        <button className="agent-icon-button" title="New Chat" disabled={!selectedProjectId||loading} onClick={startNewChat}><Icon name="plus" size={16}/></button></header>
      <div className="agent-chat-body" ref={bodyRef}>{!projects.length?<div className="agent-welcome"><strong>Open a folder to start</strong></div>
        :!current?null
        :<>{turns.map(turn=><section className="agent-turn" key={turn.key}>
          {turn.user&&<article className="agent-message user"><div>{turn.user}</div></article>}
          {!!turn.items.length&&<div className="agent-response"><span className="agent-role">Pi</span>{turn.items.map(part=>part.type==='answer'
            ?<div className={'agent-answer '+(part.streaming?'streaming':'')} key={part.key}>{part.text}</div>
            :part.type==='thinking'?<details className="agent-thinking" key={part.key} open={part.streaming||undefined}><summary>Thought process</summary><div>{part.text}</div></details>
            :part.tool&&<details className={`agent-tool ${part.tool.status}`} key={part.key}><summary><span>{part.tool.name}</span><small>{part.tool.status}</small></summary>
              <pre>{JSON.stringify({input:part.tool.args,output:part.tool.result},null,2)}</pre></details>)}</div>}
        </section>)}
          {current.error&&<div className="agent-inline-error">{current.error}</div>}</>}
      </div>
      <div className={'agent-composer '+(composerExpanded?'expanded':'')}>{dirty&&<div className="agent-dirty-warning">Save unsaved files before running Pi.</div>}
        {selectedProjectId&&<button className="agent-composer-expand" title={composerExpanded?'Collapse Input':'Expand Input'} aria-label={composerExpanded?'Collapse Input':'Expand Input'}
          onClick={()=>setComposerExpanded(value=>!value)}><Icon name={composerExpanded?'collapse':'expand'} size={13}/></button>}
        <textarea value={draft} disabled={!selectedProjectId} placeholder=""
          onChange={event=>setDraft(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();void send();}}}/>
        <footer><span className="agent-usage" title={current?.usage?`${current.usage.total} total tokens · $${current.usage.cost.toFixed(4)}`:'No usage yet'}>{current?.usage?.contextPercent!=null?`${Math.round(current.usage.contextPercent)}%`:current?.usage?formatTokens(current.usage.total):''}</span>
          <div className="agent-model-control" ref={modelControlRef}
            onBlur={event=>{const next=event.relatedTarget as Node|null;if(!event.currentTarget.contains(next)&&!modelMenuRef.current?.contains(next))setModelMenu(false);}}><button className="agent-footer-select-trigger"
              aria-haspopup="listbox" aria-expanded={modelMenu} disabled={!selectedProjectId||current?.status==='running'} onClick={()=>modelMenu?setModelMenu(false):void loadModels()}>
          {selectedModel?`${selectedModel.id} · ${selectedThinking}`:'Select Model'}<Icon name="chevron" size={11}/></button></div>
          {current?.status==='running'||current?.status==='stopping'?<button className="agent-send stop" onClick={()=>void stop()}><Icon name="stop" size={14}/>Stop</button>
            :<button className="agent-send" disabled={!selectedProjectId||!selectedModel||!draft.trim()||dirty} onClick={()=>void send()}><Icon name="send" size={14}/>Send</button>}</footer>
      </div>
    </aside>
    {modelMenu&&createPortal(<div ref={modelMenuRef} style={modelMenuStyle} className="agent-model-menu combined" role="dialog" aria-label="Model and thinking">
      <div className="agent-model-picker"><div className="agent-model-list">{groupedModels.map(group=><section key={group.label}><strong>{group.label}</strong>
        {group.options.map(option=>{const [provider,id]=option.value.split('\u0000');const selected=selectedModel?.provider===provider&&selectedModel.id===id;return <button className={selected?'selected':''}
          key={option.value} onClick={()=>{const model=models.find(item=>item.provider===provider&&item.id===id);if(model)void setModel(model);}}><span>{option.label}</span>{selected&&<i>✓</i>}</button>;})}</section>)}</div>
        {selectedModel&&<div className="agent-thinking-list"><strong>Thinking</strong>{thinkingOptions.map(option=><button className={option.value===selectedThinking?'selected':''} key={option.value}
          onClick={()=>void setThinking(option.value as PiThinkingLevel).then(()=>setModelMenu(false))}>{option.label}{option.value===selectedThinking&&<i>✓</i>}</button>)}</div>}</div>
      <button className="configure-models" onClick={()=>{setModelMenu(false);setModelDialog(true);}}><Icon name="settings" size={13}/>Configure Models</button>
    </div>,document.body)}
    {sessionDialog&&selectedProjectId&&<SessionDialog projects={projects} projectId={selectedProjectId} selectedSessionId={selectedSessionId} sessions={sessions[selectedProjectId]??[]}
      onProject={id=>{setSelectedProjectId(id);setSelectedSessionId(null);setNewChatModel(undefined);setDraft('');void reloadSessions(id);}} onOpen={session=>void openSession(session)} onNew={startNewChat}
      onRename={(session,name)=>void window.revu.agent.renameSession(session.projectId,session.id,name).then(unwrap).then(()=>reloadSessions(session.projectId)).catch(error=>notify('error',errorMessage(error)))}
      onDelete={session=>{if(window.confirm(`Delete “${session.name}”? The session will be moved to the Recycle Bin.`))void window.revu.agent.deleteSession(session.projectId,session.id).then(unwrap).then(()=>{
        setChats(current=>{const next={...current};delete next[session.id];return next;});if(selectedSessionId===session.id)setSelectedSessionId(null);return reloadSessions(session.projectId);
      }).catch(error=>notify('error',errorMessage(error)));}} onClose={()=>setSessionDialog(false)}/>} 
    {modelDialog&&selectedProjectId&&<ModelDialog projectId={selectedProjectId} sessionId={selectedSessionId??undefined} onClose={()=>setModelDialog(false)}
      onChanged={()=>{if(!selectedSessionId)void loadNewChatDefaults(selectedProjectId);}} notify={notify}/>} 
  </>;
}

function errorMessage(error:unknown){return error instanceof Error?error.message:String(error);}
