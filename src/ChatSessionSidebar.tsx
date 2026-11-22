import {useMemo,type MouseEvent} from 'react';
import type {PiSessionSummary} from '../shared/piTypes';
import type {Project} from '../shared/types';
import {showContextMenu} from './ContextMenu';
import Icon from './Icon';
import {canCloneOrExportSession,sessionDateGroups,SessionSearchInput,useSessionSearch} from './SessionSearch';

type SessionAction=(session:PiSessionSummary)=>void;
type Tone='running'|'idle'|'done'|'error'|'question';
interface Props{
  project?:Project;
  selectedSessionId:string|null;
  sessions:readonly PiSessionSummary[];
  getTone:(session:PiSessionSummary)=>Tone;
  onOpen:SessionAction;onRename:SessionAction;onClone:SessionAction;onExport:SessionAction;onDelete:SessionAction;
}

const clockTime=new Intl.DateTimeFormat(undefined,{hour:'2-digit',minute:'2-digit'});
const shortDate=new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric'});
const statusLabels:Record<Tone,string>={idle:'Idle',running:'Running',done:'Done',error:'Error',question:'Waiting for input'};

export default function ChatSessionSidebar({project,selectedSessionId,sessions,getTone,onOpen,onRename,onClone,onExport,onDelete}:Props){
  const search=useSessionSearch(project?.id??'','current',undefined,sessions);
  const byId=useMemo(()=>new Map(sessions.map(session=>[session.id,session])),[sessions]);
  const day=new Date().toDateString();
  const groups=useMemo(()=>sessionDateGroups([...sessions].sort((a,b)=>
    b.modifiedAt-a.modifiedAt||b.createdAt-a.createdAt||a.id.localeCompare(b.id))),[sessions,day]);
  const openActions=async(event:MouseEvent<HTMLElement>,session:PiSessionSummary,fromButton=false)=>{
    const trigger=event.currentTarget;
    const rect=trigger.getBoundingClientRect();
    const tone=getTone(session);
    const canExportOrClone=canCloneOrExportSession(session)&&tone!=='running'&&tone!=='question';
    const action=await showContextMenu(fromButton?{
      currentTarget:trigger,clientX:rect.left,clientY:rect.bottom,preventDefault:()=>event.preventDefault(),
    }:event,[
      {id:'rename',label:'Rename'},
      {id:'clone',label:'Clone',disabled:!canExportOrClone},
      {id:'export',label:'Export',disabled:!canExportOrClone},
      {id:'delete',label:'Delete',separatorBefore:true},
    ] as const);
    if(action==='rename')onRename(session);
    else if(action==='clone')onClone(session);
    else if(action==='export')onExport(session);
    else if(action==='delete')onDelete(session);
    else if(fromButton&&trigger.isConnected&&trigger.ownerDocument.hasFocus())trigger.focus();
  };
  const renderRow=(session:PiSessionSummary,snippet?:string)=>{
    const selected=session.id===selectedSessionId,tone=getTone(session);
    const date=new Date(session.modifiedAt);
    const stamp=(date.toDateString()===day?clockTime:shortDate).format(date);
    return <div key={session.id} className={'chat-history-row status-'+tone+(selected?' active':'')}
      data-panel-anchor onContextMenu={event=>void openActions(event,session)}>
      <button type="button" className="chat-history-select" title={session.name} aria-current={selected||undefined}
        onClick={()=>{if(!selected)onOpen(session);}}>
        {tone!=='idle'&&<span className="chat-history-status" role="img" aria-label={statusLabels[tone]} title={statusLabels[tone]}/>}
        <span className="chat-history-title"><span className="chat-history-name">{session.name}</span>
          {snippet&&<span className="chat-history-snippet">{snippet}</span>}</span>
        <time dateTime={date.toISOString()} title={date.toLocaleString()}>{stamp}</time>
      </button>
      <button type="button" className="agent-icon-button chat-history-more" aria-label={'Actions for '+session.name}
        title="Session actions" aria-haspopup="menu" onClick={event=>void openActions(event,session,true)}><Icon name="more" size={14}/></button>
    </div>;
  };
  let list;
  if(!project)list=<p className="agent-empty">Open a folder to start</p>;
  else if(search.searching)list=<p className="agent-empty">Searching…</p>;
  else if(search.trimmedQuery){
    const matches=search.results.flatMap(result=>{
      const session=byId.get(result.id);
      return session?[renderRow(session,result.matchSnippet)]:[];
    });
    list=matches.length?matches:<p className="agent-empty">No matching conversations.</p>;
  }else if(groups.length){
    list=groups.map(({label,items})=><section key={label} className="chat-session-group">
      <h3>{label}</h3>{items.map(session=>renderRow(session))}
    </section>);
  }else list=<p className="agent-empty">No conversations yet.</p>;
  return <aside className="chat-session-sidebar" aria-label="Project sessions">
    <h2>Sessions</h2>
    <div className="session-search"><SessionSearchInput query={search.query} setQuery={search.setQuery}/></div>
    <div className="chat-session-list" data-panel-scroll aria-busy={search.searching}>{list}</div>
  </aside>;
}
