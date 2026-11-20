import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PiCwdRequest,PiEntriesResponse,PiProjectTrust,PiTrustChoice } from '../shared/piTypes';
import { activePiBranch } from '../shared/piCommands';
import Icon from './Icon';

function useEscape(close:()=>void,busy:boolean){
  const callback=useRef(close);callback.current=close;
  useEffect(()=>{const listener=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!busy)callback.current();}};
    window.addEventListener('keydown',listener,true);return()=>window.removeEventListener('keydown',listener,true);},[busy]);
}
const errorText=(error:unknown)=>error instanceof Error?error.message:String(error);

export function RenameSessionDialog({name,onSave,onClose}:{name:string;onSave:(name:string)=>Promise<void>;onClose:()=>void}){
  const inputRef=useRef<HTMLInputElement>(null);
  useLayoutEffect(()=>{inputRef.current?.focus();inputRef.current?.select();},[]);
  const [value,setValue]=useState(name);const [busy,setBusy]=useState(false);const [error,setError]=useState('');useEscape(onClose,busy);
  const save=async()=>{if(busy||!value.trim())return;setBusy(true);setError('');try{await onSave(value.trim());onClose();}catch(error){setError(errorText(error));}finally{setBusy(false);}};
  return <div className="agent-chat-modal-backdrop command-dialog-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onClose();}}>
    <section className="agent-chat-modal" role="dialog" aria-modal="true" aria-label="Rename Session">
      <header><strong>Rename Session</strong><button className="agent-icon-button" disabled={busy} onClick={onClose} aria-label="Close"><Icon name="close" size={14}/></button></header>
      <form className="command-dialog-content" onSubmit={event=>{event.preventDefault();void save();}}>
        <input ref={inputRef} aria-label="Session name" value={value} disabled={busy} onChange={event=>setValue(event.target.value)}/>
        {error&&<p className="command-dialog-error" role="alert">{error}</p>}
      </form><footer><button disabled={busy} onClick={onClose}>Cancel</button><button className="agent-primary" disabled={busy||!value.trim()} onClick={()=>void save()}>Save</button></footer>
    </section>
  </div>;
}

export function ForkDialog({projectId,sessionId,onFork,onClose}:{projectId:string;sessionId:string;onFork:(entryId:string)=>Promise<void>;onClose:()=>void}){
  const [entries,setEntries]=useState<PiEntriesResponse>({entries:[],leafId:null});const [query,setQuery]=useState('');const [selected,setSelected]=useState('');
  const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);const [error,setError]=useState('');useEscape(onClose,busy);
  useEffect(()=>{let cancelled=false;void window.revu.agent.getEntries(projectId,sessionId).then(response=>{
    if(!response.ok)throw new Error(response.error||'Could not load messages.');if(!cancelled)setEntries(response.value!);
  }).catch(error=>{if(!cancelled)setError(errorText(error));}).finally(()=>{if(!cancelled)setLoading(false);});return()=>{cancelled=true;};},[projectId,sessionId]);
  const messages=useMemo(()=>activePiBranch(entries.entries,entries.leafId).flatMap(entry=>{
    const message=entry.message as {role?:string;content?:unknown}|undefined;if(entry.type!=='message'||message?.role!=='user')return [];
    const content=message.content;const text=typeof content==='string'?content:Array.isArray(content)?content.map(block=>block?.type==='text'?String(block.text??''):'').join(''):'';
    return text?[{id:entry.id,text}]:[];
  }).filter(item=>query.toLocaleLowerCase().split(/\s+/).every(term=>item.text.toLocaleLowerCase().includes(term))),[entries,query]);
  const fork=async(id:string)=>{if(busy)return;setBusy(true);setError('');try{await onFork(id);onClose();}catch(error){setError(errorText(error));}finally{setBusy(false);}};
  return <div className="agent-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onClose();}}>
    <section className="agent-modal session-tree-dialog fork-dialog" role="dialog" aria-modal="true" aria-label="Fork">
      <header><strong>Fork</strong><button className="agent-icon-button" disabled={busy} onClick={onClose} aria-label="Close"><Icon name="close" size={15}/></button></header>
      <div className="session-tree-toolbar"><input autoFocus placeholder="Search user messages" aria-label="Search user messages" value={query} disabled={busy} onChange={event=>setQuery(event.target.value)}/></div>
      <div className="session-tree-body fork-message-list" role="listbox" aria-label="User messages" aria-busy={busy||loading}>
        {loading?<p>Loading…</p>:!messages.length?<p>No user messages</p>:messages.map(item=><button key={item.id} role="option" aria-selected={selected===item.id} disabled={busy}
          className={`session-tree-row ${selected===item.id?'selected':''}`} title={item.text} onClick={()=>setSelected(item.id)} onDoubleClick={()=>void fork(item.id)}
          onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();void fork(item.id);}}}>
          <span className="session-tree-text user">user: {item.text.replace(/\s+/g,' ')}</span></button>)}
      </div>{error&&<p className="command-dialog-error" role="alert">{error}</p>}
    </section>
  </div>;
}

export function ProjectTrustDialog({trust,onSave,onClose}:{trust:PiProjectTrust;onSave:(choice:PiTrustChoice)=>Promise<void>;onClose:()=>void}){
  const [choice,setChoice]=useState<PiTrustChoice>(trust.saved?.decision===false?'untrust':trust.parentPath&&trust.saved?.path.toLocaleLowerCase()===trust.parentPath.toLocaleLowerCase()?'parent':'trust');
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');useEscape(onClose,busy);
  const inherited=trust.saved&&trust.saved.path.toLocaleLowerCase()!==trust.cwd.toLocaleLowerCase();
  const saving=useRef(false);
  const save=async(value:PiTrustChoice=choice)=>{if(saving.current)return;saving.current=true;setBusy(true);setError('');try{await onSave(value);}catch(error){setError(errorText(error));}finally{saving.current=false;setBusy(false);}};
  return createPortal(<div className="project-trust-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onClose();}}>
    <section className="agent-chat-modal project-trust-dialog" role="dialog" aria-modal="true" aria-label="Project trust">
      <header><div><strong>Project trust</strong><span title={trust.cwd}>{trust.cwd}</span></div><button className="agent-icon-button" disabled={busy} onClick={onClose} aria-label="Close"><Icon name="close" size={14}/></button></header>
      <div className="command-dialog-content"><dl className="trust-status"><div><dt>Saved decision:</dt><dd>{trust.saved?(trust.saved.decision?'trusted':'untrusted'):'none'}
        {inherited&&<small>Inherited from {trust.saved!.path}</small>}</dd></div><div><dt>Current session:</dt><dd>{trust.current===null?'not started':trust.current?'trusted':'untrusted'}</dd></div></dl>
        <div className="trust-options" role="radiogroup" aria-label="Project trust decision">
          {(['trust',...(trust.parentPath?['parent']:[]),'untrust'] as PiTrustChoice[]).map(value=><button key={value} type="button" role="radio" aria-checked={choice===value} autoFocus={value===choice} disabled={busy}
            className={choice===value?'selected':''} onClick={()=>setChoice(value)} onDoubleClick={()=>void save(value)}
            onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();void save(value);return;}if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const values:PiTrustChoice[]=trust.parentPath?['trust','parent','untrust']:['trust','untrust'];const next=values[(values.indexOf(value)+(event.key==='ArrowUp'||event.key==='ArrowLeft'?-1:1)+values.length)%values.length];setChoice(next);(event.currentTarget.parentElement?.querySelectorAll('button')[values.indexOf(next)] as HTMLButtonElement)?.focus();}}}>
            <span>{value==='trust'?'Trust':value==='parent'?'Trust parent folder':'Do not trust'}</span>{value==='parent'&&<small title={trust.parentPath}>{trust.parentPath}</small>}
          </button>)}
        </div>{error&&<p className="command-dialog-error" role="alert">{error}</p>}
      </div>
    </section>
  </div>,document.body);
}

export function CwdRecoveryDialog({request,onRespond}:{request:PiCwdRequest;onRespond:(accept:boolean)=>Promise<void>}){
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const pending=useRef(false);
  const respond=async(accept:boolean)=>{if(pending.current)return;pending.current=true;setBusy(true);try{await onRespond(accept);}catch(error){setError(errorText(error));pending.current=false;setBusy(false);}};
  useEscape(()=>void respond(false),busy);
  return createPortal(<div className="project-trust-backdrop"><section className="agent-chat-modal cwd-recovery-dialog" role="dialog" aria-modal="true" aria-label="Session directory unavailable">
    <header><strong>Session directory unavailable</strong></header><div className="command-dialog-content"><dl><dt>Saved directory</dt><dd>{request.saved}</dd><dt>Current directory</dt><dd>{request.current}</dd></dl><p>Continue in the current directory?</p>{error&&<p role="alert">{error}</p>}</div>
    <footer><button disabled={busy} onClick={()=>void respond(false)}>Cancel</button><button className="agent-primary" autoFocus disabled={busy} onClick={()=>void respond(true)}>Use Current Directory</button></footer>
  </section></div>,document.body);
}
