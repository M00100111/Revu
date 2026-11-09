import { useEffect, useMemo, useState } from 'react';
import type { PiSessionEntry,PiSessionTreeNode,PiSessionTreeResponse,PiTreeNavigationResponse } from '../shared/piTypes';
import Icon from './Icon';
import { showContextMenu } from './ContextMenu';

type FilterMode='default'|'no-tools'|'user-only'|'labeled-only'|'all';
type ViewMode='tree'|'active';
type Notify=(level:'info'|'warning'|'error',message:string)=>void;
interface VisibleNode {node:PiSessionTreeNode;children:VisibleNode[]}
type TreeSegment='empty'|'gutter'|'branch'|'last';
interface VisibleRow {node:PiSessionTreeNode;segments:TreeSegment[];foldable:boolean}
interface ToolCall {name:string;arguments:Record<string,unknown>}

const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'?value as Record<string,unknown>:{};
const contentText=(content:unknown)=>typeof content==='string'?content:Array.isArray(content)?content.map(block=>{
  const item=record(block);return item.type==='text'&&typeof item.text==='string'?item.text:'';
}).filter(Boolean).join('\n'):'';
const message=(entry:PiSessionEntry)=>record(entry.message);
const normalized=(value:string)=>value.replace(/[\n\t]+/g,' ').replace(/\s+/g,' ').trim();

const toolCallsFromTree=(tree:PiSessionTreeNode[])=>{const calls=new Map<string,ToolCall>();const visit=(node:PiSessionTreeNode)=>{
  if(node.entry.type==='message'&&message(node.entry).role==='assistant'){const content=message(node.entry).content;
    if(Array.isArray(content))for(const block of content){const item=record(block);if(item.type==='toolCall'&&typeof item.id==='string')calls.set(item.id,{name:String(item.name??'tool'),arguments:record(item.arguments)});}}
  node.children.forEach(visit);};tree.forEach(visit);return calls;};

const formatToolCall=(call:ToolCall)=>{const args=call.arguments;
  if(call.name==='read'){const path=String(args.path??args.file_path??'');const offset=args.offset==null?'':`:${String(args.offset)}`;const limit=args.limit==null?'':`-${String(args.limit)}`;return `[read: ${path}${offset}${limit}]`;}
  if(call.name==='write'||call.name==='edit')return `[${call.name}: ${String(args.path??args.file_path??'')}]`;
  if(call.name==='bash'){const command=normalized(String(args.command??''));return `[bash: ${command.slice(0,50)}${command.length>50?'…':''}]`;}
  if(call.name==='grep')return `[grep: /${String(args.pattern??'')}/ in ${String(args.path??'.')}]`;
  if(call.name==='find')return `[find: ${String(args.pattern??'')} in ${String(args.path??'.')}]`;
  if(call.name==='ls')return `[ls: ${String(args.path??'.')}]`;
  const serialized=JSON.stringify(args);return `[${call.name}: ${serialized.slice(0,40)}${serialized.length>40?'…':''}]`;
};

const displayText=(node:PiSessionTreeNode,toolCalls?:ReadonlyMap<string,ToolCall>)=>{
  const entry=node.entry;
  if(entry.type==='message'){
    const item=message(entry);const role=String(item.role??'message');const text=normalized(contentText(item.content));
    if(role==='user')return {kind:'user',text:`user: ${text}`};
    if(role==='assistant')return {kind:'assistant',text:`assistant: ${text||String(item.errorMessage??(item.stopReason==='aborted'?'(aborted)':'(no content)'))}`};
    if(role==='toolResult'){const call=typeof item.toolCallId==='string'?toolCalls?.get(item.toolCallId):undefined;
      return {kind:'tool',text:call?formatToolCall(call):`[${String(item.toolName??'tool')}]`};}
    if(role==='bashExecution')return {kind:'tool',text:`[bash]: ${normalized(String(item.command??''))}`};
    return {kind:'meta',text:`[${role}]${text?`: ${text}`:''}`};
  }
  if(entry.type==='custom_message')return {kind:'custom',text:`[${String(entry.customType)}]: ${normalized(contentText(entry.content))}`};
  if(entry.type==='compaction')return {kind:'compaction',text:`[compaction: ${Math.round(Number(entry.tokensBefore??0)/1000)}k tokens]`};
  if(entry.type==='branch_summary')return {kind:'summary',text:`[branch summary]: ${normalized(String(entry.summary??''))}`};
  if(entry.type==='model_change')return {kind:'meta',text:`[model: ${String(entry.modelId??'')}]`};
  if(entry.type==='thinking_level_change')return {kind:'meta',text:`[thinking: ${String(entry.thinkingLevel??'')}]`};
  if(entry.type==='context_edit')return {kind:'meta',text:`[context ${entry.replacement==null?'omit':'replace'}: ${String(entry.targetId??'')}]`};
  if(entry.type==='label')return {kind:'meta',text:`[label: ${String(entry.label??'(cleared)')}]`};
  if(entry.type==='session_info')return {kind:'meta',text:`[title: ${String(entry.name??'empty')}]`};
  if(entry.type==='custom')return {kind:'meta',text:`[custom: ${String(entry.customType??'')}]`};
  return {kind:'meta',text:`[${entry.type}]`};
};

const copyText=(node:PiSessionTreeNode)=>{
  const entry=node.entry;
  if(entry.type==='message'){
    const item=message(entry);if(item.role==='bashExecution')return String(item.command??'').trim();
    return (contentText(item.content)||String(item.errorMessage??'')).trim();
  }
  if(entry.type==='custom_message')return contentText(entry.content).trim();
  if(entry.type==='compaction'||entry.type==='branch_summary')return String(entry.summary??'').trim();
  return '';
};

const formatLabelTime=(value:string)=>{
  const date=new Date(value);const now=new Date();const time=new Intl.DateTimeFormat(undefined,{hour:'2-digit',minute:'2-digit'}).format(date);
  if(date.toDateString()===now.toDateString())return time;
  return new Intl.DateTimeFormat(undefined,{year:date.getFullYear()===now.getFullYear()?undefined:'2-digit',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(date);
};

const visibleByMode=(node:PiSessionTreeNode,leafId:string|null,mode:FilterMode)=>{
  const entry=node.entry;if(entry.type==='usage')return false;
  if(entry.type==='message'&&message(entry).role==='assistant'&&entry.id!==leafId){const item=message(entry);
    if(!contentText(item.content).trim()&&(!item.stopReason||item.stopReason==='stop'||item.stopReason==='toolUse'))return false;}
  const settings=['label','context_edit','custom','model_change','thinking_level_change','session_info'].includes(entry.type);
  if(mode==='user-only')return entry.type==='message'&&message(entry).role==='user';
  if(mode==='no-tools')return !settings&&!(entry.type==='message'&&message(entry).role==='toolResult');
  if(mode==='labeled-only')return node.label!==undefined;
  if(mode==='all')return true;
  return !settings;
};

const filterTree=(tree:PiSessionTreeNode[],leafId:string|null,mode:FilterMode,view:ViewMode,query:string,toolCalls:ReadonlyMap<string,ToolCall>,path:ReadonlySet<string>):VisibleNode[]=>{
  const tokens=query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const walk=(node:PiSessionTreeNode):VisibleNode[]=>{
    const children=node.children.flatMap(walk).sort((a,b)=>Number(path.has(b.node.entry.id))-Number(path.has(a.node.entry.id)));
    if(view==='active'&&!path.has(node.entry.id))return children;
    const searchable=`${node.label??''} ${displayText(node,toolCalls).text} ${JSON.stringify(node.entry)}`.toLocaleLowerCase();
    const visible=visibleByMode(node,leafId,mode)&&tokens.every(token=>searchable.includes(token));
    return visible?[{node,children}]:children;
  };
  return tree.flatMap(walk).sort((a,b)=>Number(path.has(b.node.entry.id))-Number(path.has(a.node.entry.id)));
};

const flatten=(tree:VisibleNode[],folded:ReadonlySet<string>)=>{
  const rows:VisibleRow[]=[];const multipleRoots=tree.length>1;
  type Frame={node:VisibleNode;indent:number;justBranched:boolean;showConnector:boolean;isLast:boolean;gutters:{position:number;show:boolean}[];virtualRootChild:boolean;parent:VisibleNode|null};
  const stack:Frame[]=[];for(let index=tree.length-1;index>=0;index--)stack.push({node:tree[index],indent:multipleRoots?1:0,justBranched:multipleRoots,
    showConnector:multipleRoots,isLast:index===tree.length-1,gutters:[],virtualRootChild:multipleRoots,parent:null});
  while(stack.length){const frame=stack.pop()!;const {node}=frame;const displayIndent=multipleRoots?Math.max(0,frame.indent-1):frame.indent;
    const connectorDisplayed=frame.showConnector&&!frame.virtualRootChild;const connectorPosition=displayIndent-1;const segments:TreeSegment[]=[];
    for(let level=0;level<displayIndent;level++){const gutter=frame.gutters.find(item=>item.position===level);
      if(gutter)segments.push(gutter.show?'gutter':'empty');else if(connectorDisplayed&&level===connectorPosition)segments.push(frame.isLast?'last':'branch');else segments.push('empty');}
    const foldable=node.children.length>0&&(frame.parent===null||frame.parent.children.length>1);
    rows.push({node:node.node,segments,foldable});if(folded.has(node.node.entry.id))continue;
    const multipleChildren=node.children.length>1;const childIndent=multipleChildren?frame.indent+1:frame.justBranched&&frame.indent>0?frame.indent+1:frame.indent;
    const childGutters=connectorDisplayed?[...frame.gutters,{position:connectorPosition,show:!frame.isLast}]:frame.gutters;
    for(let index=node.children.length-1;index>=0;index--)stack.push({node:node.children[index],indent:childIndent,justBranched:multipleChildren,
      showConnector:multipleChildren,isLast:index===node.children.length-1,gutters:childGutters,virtualRootChild:false,parent:node});
  }
  return rows;
};

const activePath=(tree:PiSessionTreeNode[],leafId:string|null)=>{const byId=new Map<string,PiSessionEntry>();
  const collect=(node:PiSessionTreeNode)=>{byId.set(node.entry.id,node.entry);node.children.forEach(collect);};tree.forEach(collect);
  const result=new Set<string>();let current=leafId;while(current){const entry=byId.get(current);if(!entry)break;result.add(current);current=entry.parentId;}return result;};

export default function SessionTreeDialog({projectId,sessionId,onClose,onNavigated,notify}:{
  projectId:string;sessionId:string;onClose:()=>void;onNavigated:(response:PiTreeNavigationResponse)=>void;notify:Notify;
}){
  const [tree,setTree]=useState<PiSessionTreeResponse>({tree:[],leafId:null});const [loading,setLoading]=useState(true);
  const [query,setQuery]=useState('');const [view,setView]=useState<ViewMode>('tree');const [filter,setFilter]=useState<FilterMode>('default');const [labelTime,setLabelTime]=useState(false);
  const [selected,setSelected]=useState('');const [folded,setFolded]=useState<Set<string>>(new Set());
  const [navigationTarget,setNavigationTarget]=useState<PiSessionTreeNode|null>(null);const [customPrompt,setCustomPrompt]=useState(false);
  const [instructions,setInstructions]=useState('');const [navigating,setNavigating]=useState(false);const [cancelling,setCancelling]=useState(false);
  const [labelTarget,setLabelTarget]=useState<PiSessionTreeNode|null>(null);const [label,setLabel]=useState('');
  useEffect(()=>{let cancelled=false;setLoading(true);void window.revu.agent.getSessionTree(projectId,sessionId).then(result=>{
    if(!result.ok)throw new Error(result.error||'Could not load the session tree.');if(!cancelled){setTree(result.value!);setSelected(result.value!.leafId??'');}
  }).catch(error=>{if(!cancelled)notify('error',error instanceof Error?error.message:String(error));}).finally(()=>{if(!cancelled)setLoading(false);});return()=>{cancelled=true;};},[projectId,sessionId]);
  const path=useMemo(()=>activePath(tree.tree,tree.leafId),[tree]);
  const toolCalls=useMemo(()=>toolCallsFromTree(tree.tree),[tree.tree]);
  const visible=useMemo(()=>filterTree(tree.tree,tree.leafId,filter,view,query,toolCalls,path),[tree,filter,view,query,toolCalls,path]);const rows=useMemo(()=>flatten(visible,folded),[visible,folded]);
  const toggleFold=(id:string)=>setFolded(current=>{const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next;});
  const openNavigation=(node:PiSessionTreeNode)=>{setSelected(node.entry.id);if(node.entry.id===tree.leafId){notify('info','Already at this point.');return;}
    setNavigationTarget(node);setCustomPrompt(false);setInstructions('');};
  const navigate=async(summarize:boolean,customInstructions?:string)=>{if(!navigationTarget)return;setNavigating(true);setCancelling(false);try{
    const result=await window.revu.agent.navigateSessionTree(projectId,sessionId,navigationTarget.entry.id,summarize,customInstructions).then(value=>{
      if(!value.ok)throw new Error(value.error||'Session tree navigation failed.');return value.value!;});
    setTree({tree:result.tree,leafId:result.leafId});if(result.cancelled||result.aborted){setNavigationTarget(null);notify('info','Branch navigation cancelled.');return;}
    onNavigated(result);
  }catch(error){notify('error',error instanceof Error?error.message:String(error));}finally{setNavigating(false);setCancelling(false);}};
  const abortNavigation=async()=>{setCancelling(true);try{await window.revu.agent.abortSessionTreeNavigation(projectId,sessionId).then(result=>{
    if(!result.ok)throw new Error(result.error||'Could not cancel branch summarization.');});}catch(error){setCancelling(false);notify('error',error instanceof Error?error.message:String(error));}};
  const applyLabel=async(node:PiSessionTreeNode,value?:string)=>{try{const result=await window.revu.agent.setSessionEntryLabel(projectId,sessionId,node.entry.id,value).then(response=>{
    if(!response.ok)throw new Error(response.error||'Could not update the label.');return response.value!;});setTree(result);setLabelTarget(null);
  }catch(error){notify('error',error instanceof Error?error.message:String(error));}};
  const contextMenu=async(event:React.MouseEvent,node:PiSessionTreeNode)=>{setSelected(node.entry.id);const text=copyText(node);
    const action=await showContextMenu(event,[{id:'copy',label:'Copy',disabled:!text},{id:'label',label:node.label?'Edit Label':'Set Label'},
      ...(node.label?[{id:'removeLabel' as const,label:'Remove Label'}]:[])] as const);
    if(action==='copy'&&text){if(!await window.revu.copyText(text))notify('error','Could not copy the entry.');}
    if(action==='label'){setLabelTarget(node);setLabel(node.label??'');}if(action==='removeLabel')void applyLabel(node,undefined);};
  return <div className="agent-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!navigating)onClose();}}>
    <section className="agent-modal session-tree-dialog" role="dialog" aria-modal="true" aria-label="Session Tree">
      <header><strong>Session Tree</strong><button className="agent-icon-button" disabled={navigating} onClick={onClose} aria-label="Close"><Icon name="close" size={15}/></button></header>
      <div className="session-tree-toolbar"><input value={query} onChange={event=>{setQuery(event.target.value);setFolded(new Set());}} placeholder="Search entries..." aria-label="Search session tree"/>
        <div className="setting-options session-tree-view" role="group" aria-label="Session tree view">{([['tree','Tree'],['active','Active']] as const).map(([value,title])=><button
          className={view===value?'active':''} aria-pressed={view===value} key={value} onClick={()=>{setView(value);setFolded(new Set());}}>{title}</button>)}</div>
        <div className="setting-options session-tree-filters" role="group" aria-label="Session tree filter">{([
          ['default','Default'],['no-tools','No Tools'],['user-only','User'],['labeled-only','Labeled'],['all','All'],
        ] as const).map(([value,title])=><button className={filter===value?'active':''} aria-pressed={filter===value} key={value} onClick={()=>{setFilter(value);setFolded(new Set());}}>{title}</button>)}</div>
        <label className="session-tree-label-time"><input type="checkbox" checked={labelTime} onChange={event=>setLabelTime(event.target.checked)}/><span>Label Time</span></label>
      </div>
      <div className="session-tree-body">{loading?<p className="agent-empty">Loading session tree…</p>:rows.length===0?<p className="agent-empty">No entries found.</p>:rows.map(row=>{
        const id=row.node.entry.id;const display=displayText(row.node,toolCalls);return <div className={`session-tree-row ${selected===id?'selected':''}`} key={id}
          onClick={()=>setSelected(id)} onContextMenu={event=>void contextMenu(event,row.node)}>
          <span className={`session-tree-fold-slot ${path.has(id)?'active':''}`}>{row.foldable&&<button className={`session-tree-fold ${folded.has(id)?'folded':''}`}
              aria-label={folded.has(id)?'Expand branch':'Collapse branch'} onClick={event=>{event.stopPropagation();toggleFold(id);}}
              onDoubleClick={event=>event.stopPropagation()}><Icon name="down" size={11}/></button>}</span><span
            className={`session-tree-connectors ${path.has(id)?'active':''}`}>{row.segments.map((segment,index)=><i className={`session-tree-segment ${segment}`} key={index}/>)}</span>
          <span className={`session-tree-path ${path.has(id)?'active':''}`}/><div className="session-tree-entry-content" onDoubleClick={()=>openNavigation(row.node)}>
            {row.node.label&&<span className="session-tree-label">[{row.node.label}]</span>}
            {labelTime&&row.node.label&&row.node.labelTimestamp&&<time>{formatLabelTime(row.node.labelTimestamp)}</time>}
            <span className={`session-tree-text ${display.kind}`} title={display.text}>{display.text}</span>
          </div>
        </div>;})}</div>
    </section>
    {navigationTarget&&<div className="agent-nested-backdrop" role="presentation"><section className="agent-tree-prompt summary" role="dialog" aria-modal="true" aria-label="Summarize branch">
      <header><strong>{navigating?'Navigating branch…':'Summarize branch?'}</strong></header>{navigating?<div className="tree-operation-progress"><span className="agent-spinner"/><p>{cancelling?'Cancelling…':'Pi is preparing the selected branch.'}</p></div>
      :customPrompt?<div className="tree-custom-prompt"><label htmlFor="tree-custom-summary">Custom summarization instructions</label><textarea id="tree-custom-summary" autoFocus value={instructions} onChange={event=>setInstructions(event.target.value)}/></div>
      :<div className="tree-summary-options"><button onClick={()=>void navigate(false)}>No Summary</button><button onClick={()=>void navigate(true)}>Summarize</button>
        <button onClick={()=>setCustomPrompt(true)}>Summarize with Custom Prompt</button></div>}
      <footer>{navigating?<button disabled={cancelling} onClick={()=>void abortNavigation()}>{cancelling?'Cancelling…':'Cancel'}</button>:customPrompt?<><button onClick={()=>setCustomPrompt(false)}>Back</button>
        <button className="agent-primary" onClick={()=>void navigate(true,instructions.trim()||undefined)}>Summarize</button></>:<button onClick={()=>setNavigationTarget(null)}>Cancel</button>}</footer>
    </section></div>}
    {labelTarget&&<div className="agent-nested-backdrop" role="presentation"><form className="agent-tree-prompt label" onSubmit={event=>{event.preventDefault();void applyLabel(labelTarget,label.trim()||undefined);}}>
      <header><strong>{labelTarget.label?'Edit Label':'Set Label'}</strong></header><div className="tree-label-input"><input autoFocus value={label} onChange={event=>setLabel(event.target.value)} placeholder="Label"/></div>
      <footer><button type="button" onClick={()=>setLabelTarget(null)}>Cancel</button><button className="agent-primary" type="submit">Save</button></footer>
    </form></div>}
  </div>;
}
