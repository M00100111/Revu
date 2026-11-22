import { useCallback,useEffect, useState } from 'react';
import { api, errorMessage } from './files';
import type { Entry } from '../shared/types';
import Icon from './Icon';
import { showContextMenu } from './ContextMenu';
import type {CiteRequest} from '../shared/citations';
type Props = {
  projectId: string; projectRoot:string; activePath: string | null;
  onOpen: (path: string,keep:boolean) => void; onError: (message: string) => void;
  expandedDirectories: ReadonlySet<string>; onDirectoryToggle: (key: string) => void;
  onExpandAllSubfolders:(path:string)=>void;onCollapseAllSubfolders:(path:string)=>void;
  path?: string; depth?: number;
  onCite:(request:CiteRequest)=>void;target?:{path:string;token:number};
};
export default function FileTree({ projectId, projectRoot, activePath, onOpen, onError, expandedDirectories, onDirectoryToggle,
  onExpandAllSubfolders, onCollapseAllSubfolders,onCite,target, path = '', depth = 0 }: Props) {
  const [entries,setEntries]=useState<Entry[]>([]);
  const revealRow=useCallback((node:HTMLButtonElement|null)=>{node?.scrollIntoView({block:'nearest'});},[target?.token]);
  const [status,setStatus]=useState('Loading…');
  useEffect(()=>{
    let live=true;
    const read=()=>{void api<Entry[]>('list',{projectId,path}).then(items=>{
      if(live){setEntries(items);setStatus(items.length?'':'Empty folder');}
    }).catch(error=>{if(live){setStatus('Failed to load');onError(errorMessage(error));}});};
    read();
    const changed=(event:Event)=>{if((event as CustomEvent).detail===projectId)read();};
    window.addEventListener('revu-project-changed',changed);
    return ()=>{live=false;window.removeEventListener('revu-project-changed',changed);};
  },[projectId,path,onError]);
  return <ul className="file-tree">
    {status&&<li className="tree-note">{status}</li>}
    {entries.map(entry=>{
      const entryPath=path?path+'/'+entry.name:entry.name;
      return entry.kind==='directory'
        ? <Directory key={entry.name} projectId={projectId} projectRoot={projectRoot} name={entry.name} path={entryPath}
          depth={depth} activePath={activePath} onOpen={onOpen} onError={onError} onCite={onCite} target={target}
            expandedDirectories={expandedDirectories} onDirectoryToggle={onDirectoryToggle}
            onExpandAllSubfolders={onExpandAllSubfolders} onCollapseAllSubfolders={onCollapseAllSubfolders}/>
        : <li key={entry.name}><button className={'tree-row '+(activePath===entryPath?'active':'')}
            ref={target?.path===entryPath?revealRow:undefined}
            onContextMenu={async event=>{if(await showContextMenu(event,[{id:'cite',label:'Cite'}]))onCite({projectId,path:entryPath});}}
            style={{paddingLeft:16+depth*14}} title={entryPath} onClick={event=>onOpen(entryPath,event.detail>=2)}>
            <Icon name="file" size={15}/><span>{entry.name}</span>
          </button></li>;
    })}
  </ul>;
}
function Directory(props:Props & {name:string;path:string;depth:number}){
  const key=props.projectRoot+'\n'+props.path;
  const expanded=props.expandedDirectories.has(key);
  const revealRow=useCallback((node:HTMLButtonElement|null)=>{node?.scrollIntoView({block:'nearest'});},[props.target?.token]);
  return <li><button className={'tree-row directory-row '+(props.target?.path===props.path?'active':'')} style={{paddingLeft:8+props.depth*14}}
    ref={props.target?.path===props.path?revealRow:undefined}
    aria-expanded={expanded} onClick={()=>props.onDirectoryToggle(key)} onContextMenu={async event=>{
      event.stopPropagation();const action=await showContextMenu(event,[{id:'cite',label:'Cite'},{id:'expandAll',label:'Expand Subfolders',separatorBefore:true},{id:'collapseAll',label:'Collapse Subfolders'}] as const);
      if(action==='cite')props.onCite({projectId:props.projectId,path:props.path,directory:true});
      if(action==='expandAll')props.onExpandAllSubfolders(props.path);
      if(action==='collapseAll')props.onCollapseAllSubfolders(props.path);
    }}>
    <Icon name="down" size={12} style={{transform:expanded?undefined:'rotate(-90deg)'}}/>
    <Icon name="folder" size={15}/><span>{props.name}</span>
  </button>{expanded&&<FileTree {...props} depth={props.depth+1}/>}</li>;
}
