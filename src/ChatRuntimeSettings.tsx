import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import type {PiRuntimeConfig,PiRuntimeInfo} from '../shared/piTypes';
import AgentSelect from './AgentSelect';
const unwrap=<T,>(response:{ok:boolean;value?:T;error?:string})=>{if(!response.ok)throw new Error(response.error||'Request failed.');return response.value!;};
const errorText=(error:unknown)=>error instanceof Error?error.message:String(error);
const BROWSE='__browse__';
export default function ChatRuntimeSettings(){
  const [info,setInfo]=useState<PiRuntimeInfo>();const [pending,setPending]=useState<PiRuntimeConfig|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const applying=useRef(false);
  useEffect(()=>{let cancelled=false;void window.revu.agent.getRuntimeInfo().then(unwrap).then(value=>{if(!cancelled)setInfo(value);}).catch(error=>{if(!cancelled)setError(errorText(error));});
    const dispose=window.revu.agent.onEvent(event=>{if(event.type==='runtime-changed')setInfo((event.payload as {info:PiRuntimeInfo}).info);});return()=>{cancelled=true;dispose();};},[]);
  useEffect(()=>{if(!pending)return;const listener=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!document.querySelector('.agent-select-menu')){event.preventDefault();event.stopPropagation();if(!busy)setPending(null);}};
    window.addEventListener('keydown',listener,true);return()=>window.removeEventListener('keydown',listener,true);},[pending,busy]);
  const apply=async(config:PiRuntimeConfig)=>{if(applying.current)return;applying.current=true;setBusy(true);setError('');try{const response=await window.revu.agent.setRuntime(config).then(unwrap);setInfo(response.info);setPending(null);}
    catch(error){setError(errorText(error));setPending(null);}finally{applying.current=false;setBusy(false);}};
  const selectBash=async(value:string)=>{
    if(!info||applying.current)return;
    if(value===BROWSE){applying.current=true;setBusy(true);setError('');try{const path=await window.revu.agent.chooseBashPath().then(unwrap);if(!path)return;value=path;}
      catch(error){setError(errorText(error));return;}finally{applying.current=false;setBusy(false);}}
    if(value===(info.config.nativeShellPath??''))return;await apply({...info.config,nativeShellPath:value||undefined});
  };
  const config=pending??info?.config;const distribution=info?.config.distribution??info?.defaultDistribution??'';
  const paths=[...new Map([...(info?.bashPaths??[]),...(info?.config.nativeShellPath?[info.config.nativeShellPath]:[])].map(path=>[path.replace(/\\/g,'/').toLowerCase(),path])).values()];
  const distributions=[{options:info?.distributions.map(name=>({value:name,label:name}))??[]}];
  return <><h1>Chat</h1><div className="setting-row"><span><strong>Runtime</strong><small>Choose where Pi and its tools run.</small></span>
    {!info?<span className="setting-value">Checking…</span>:info.platform!=='win32'?<span className="setting-value">Native</span>:<div className="setting-options" role="group" aria-label="Runtime">
      {(['native','wsl'] as const).map(kind=><button key={kind} className={config?.kind===kind?'active':''} aria-pressed={config?.kind===kind} disabled={busy||!!pending}
        onClick={()=>{if(info.config.kind!==kind){setError('');setPending({...info.config,kind,distribution:distribution||undefined});}}}>{kind==='native'?'Native':'WSL'}</button>)}
    </div>}
  </div>{info?.platform==='win32'&&<>
    {info.config.kind==='wsl'&&<div className="setting-row"><span><strong>Distribution</strong><small>Use the selected distribution's default user.</small></span>
      <AgentSelect ariaLabel="WSL distribution" placeholder="Choose distribution" groups={distributions} value={distribution} disabled={busy} onChange={value=>{if(value!==distribution)setPending({...info.config,distribution:value});}}/>
    </div>}
    {info.config.kind==='native'&&<div className="setting-row"><span><strong>Bash path</strong><small>Choose a detected Bash or browse for an executable.</small></span>
      <AgentSelect ariaLabel="Windows Bash path" placeholder="Automatic" value={info.config.nativeShellPath??''} disabled={busy} onChange={value=>void selectBash(value)}
        groups={[{options:[{value:'',label:'Automatic'},...paths.map(path=>({value:path,label:path}))]},{options:[{value:BROWSE,label:'Browse…'}]}]}/>
    </div>}
  </>}
  <div className="runtime-status" role="status">{!info?'Checking runtime…':<><strong>{info.config.kind==='wsl'?'WSL · '+distribution:info.platform==='darwin'?'macOS':'Windows'}{info.user?' · '+info.user:''}</strong><span>{info.ready?info.shell:info.error}</span></>}</div>
  {error&&<p className="command-dialog-error" role="alert">{error}</p>}
  {pending&&createPortal(<div className="project-trust-backdrop"><section className="agent-chat-modal runtime-confirm-dialog" role="dialog" aria-modal="true" aria-label="Switch runtime?">
    <header><strong>Switch runtime?</strong></header><div className="command-dialog-content"><p>Existing sessions may be missing from session lists, and parent session links may be unavailable. Available commands and tools may change.</p>
      {pending.kind==='wsl'&&<label>Distribution<AgentSelect ariaLabel="Target WSL distribution" placeholder="Choose distribution" value={pending.distribution} disabled={busy} groups={distributions} onChange={value=>setPending({...pending,distribution:value})}/></label>}
      {!info?.distributions.length&&pending.kind==='wsl'&&<p>No WSL distributions found.</p>}
    </div><footer><button disabled={busy} onClick={()=>setPending(null)}>Cancel</button><button className="agent-primary" disabled={busy||pending.kind==='wsl'&&!pending.distribution} onClick={()=>void apply(pending)}>{busy?'Switching…':'Switch'}</button></footer>
  </section></div>,document.body)}</>;
}
