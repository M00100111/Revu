import {Fragment,useEffect,useMemo,useRef,useState} from 'react';
import type {ChatPathDirectory,ProjectPathEntry} from '../shared/types';
import Icon from './Icon';

function matchScore(path:string,query:string){
  if(!query)return 0;
  const full=path.replace(/\/$/,'').toLocaleLowerCase(),name=full.slice(full.lastIndexOf('/')+1);
  if(full===query)return 0;
  if(name===query)return 1;
  if(name.startsWith(query))return 2;
  if(name.includes(query))return 3;
  if(full.includes(query))return 4;
  let offset=0;
  for(const character of query){
    offset=full.indexOf(character,offset);
    if(offset<0)return Infinity;
    offset++;
  }
  return 5;
}

export function useChatPaths(projectId:string,query:string|undefined,completedFile?:string){
  const path=(query??'').replaceAll('\\','/'),slash=path.lastIndexOf('/');
  const prefix=path.slice(0,slash+1),leaf=path.slice(slash+1),filter=leaf.toLocaleLowerCase();
  const searchProject=!prefix&&!!filter&&filter!=='.'&&filter!=='..'&&!completedFile;
  const key=query!==undefined&&projectId?JSON.stringify([projectId,prefix,searchProject]):'';
  const [loaded,setLoaded]=useState<{key:string;data?:ChatPathDirectory;error?:string}>();
  useEffect(()=>{
    if(!key){setLoaded(undefined);return;}
    let active=true;
    async function load(){
      try{
        const response=await window.revu.invoke<ChatPathDirectory>({action:'chatDirectory',projectId,prefix,searchProject});
        if(!response.ok||!response.value)throw new Error(response.error||'Could not load this folder.');
        if(active)setLoaded({key,data:response.value,error:response.value.error});
      }catch(error){if(active)setLoaded({key,error:error instanceof Error?error.message:String(error)});}
    }
    void load();
    return ()=>{active=false;};
  },[key,projectId,prefix,searchProject]);
  const current=loaded?.key===key?loaded:undefined,data=current?.data;
  const options=useMemo(()=>{
    if(!data)return [];
    const matches=data.entries.map(entry=>({entry,score:matchScore(entry.path,filter)}))
      .filter(item=>Number.isFinite(item.score))
      .sort((a,b)=>a.score-b.score||(a.entry.kind===b.entry.kind?a.entry.path.localeCompare(b.entry.path):a.entry.kind==='directory'?-1:1));
    return (searchProject?matches.slice(0,8):matches).map(item=>item.entry);
  },[data,filter,searchProject]);
  const parent=data?.breadcrumbs.at(-2),folder=data?.breadcrumbs.at(-1);
  const up=leaf?{query:prefix,highlight:leaf}:parent&&folder?{query:parent.query,highlight:folder.name+'/'}:undefined;
  return {prefix,options,data,up,error:current?.error,loading:!current};
}

export function ChatPathMenu({paths,index,onHighlight,onAccept,onBrowse,onNavigate,onGoUp,onChoose}:{
  paths:ReturnType<typeof useChatPaths>;index:number;onHighlight:(path:string)=>void;
  onAccept:(entry:ProjectPathEntry)=>void;onBrowse:(entry:ProjectPathEntry)=>void;
  onNavigate:(query:string)=>void;onGoUp:()=>void;onChoose:()=>void;
}){
  const list=useRef<HTMLDivElement>(null),nav=useRef<HTMLElement>(null);
  useEffect(()=>{
    if(nav.current)nav.current.scrollLeft=nav.current.scrollWidth;
  },[paths.data?.directory]);
  useEffect(()=>{
    list.current?.children[index]?.scrollIntoView({block:'nearest'});
  },[index,paths.options]);
  return <div className="agent-path-menu chat-path-browser" onMouseDown={event=>event.preventDefault()}>
    <div className="chat-path-header">
      <nav ref={nav} aria-label="Current folder path">{paths.data?.breadcrumbs.map(({name,query},i,crumbs)=><Fragment key={query}>
        {i>0&&<span aria-hidden="true">/</span>}
        <button type="button" title={name} aria-current={i===crumbs.length-1?'location':undefined} onClick={()=>onNavigate(query)}>{name}</button>
      </Fragment>)}</nav>
      <button className="chat-path-up" type="button" aria-label="Go up one level" disabled={!paths.up} onClick={onGoUp}>
        <kbd>Shift+Tab</kbd> to go up
      </button>
      <button className="chat-path-choose" type="button" title="Choose File" aria-label="Choose file from this folder"
        disabled={!paths.data||!!paths.error} onClick={onChoose}><Icon name="chatAdd" size={18}/></button>
    </div>
    <div className="chat-path-options" ref={list} role="listbox" aria-label="Project files and folders">
      {paths.loading?<div className="agent-path-empty">Searching…</div>:paths.error?<div className="agent-path-empty error">{paths.error}</div>
        :paths.options.length?paths.options.map((entry,i)=><div key={entry.path} className={'chat-path-row'+(i===index?' selected':'')} onMouseMove={()=>onHighlight(entry.path)}>
          <button type="button" role="option" aria-selected={i===index} title={entry.path} onClick={()=>onAccept(entry)}>
            <Icon name={entry.kind==='directory'?'chatFolder':'chatFile'} size={15}/><span>{entry.path.replace(/\/$/,'')}</span>
          </button>
          {entry.kind==='directory'&&<button type="button" className="chat-path-browse" aria-label={'Browse '+entry.path} onClick={()=>onBrowse(entry)}>
            <span className="chat-path-hint"><kbd>Tab</kbd> to browse folder</span>
            <Icon name="down" size={12} style={{transform:'rotate(-90deg)'}}/>
          </button>}
        </div>):<div className="agent-path-empty">No matching files or folders</div>}
    </div>
  </div>;
}
