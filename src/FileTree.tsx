import { useEffect, useState } from 'react';
import { api, errorMessage } from './files';
import type { Entry } from '../shared/types';
import Icon from './Icon';
import { showContextMenu } from './ContextMenu';
type Props = {
  projectId: string; projectRoot:string; activePath: string | null;
  onOpen: (path: string) => void; onError: (message: string) => void;
  expandedDirectories: ReadonlySet<string>; onDirectoryToggle: (key: string) => void;
  onExpandAllSubfolders:(path:string)=>void;onCollapseAllSubfolders:(path:string)=>void;
  path?: string; depth?: number;
};
export default function FileTree({ projectId, projectRoot, activePath, onOpen, onError, expandedDirectories, onDirectoryToggle,
  onExpandAllSubfolders, onCollapseAllSubfolders, path = '', depth = 0 }: Props) {
  const [entries,setEntries]=useState<Entry[]>([]);
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
            depth={depth} activePath={activePath} onOpen={onOpen} onError={onError}
            expandedDirectories={expandedDirectories} onDirectoryToggle={onDirectoryToggle}
            onExpandAllSubfolders={onExpandAllSubfolders} onCollapseAllSubfolders={onCollapseAllSubfolders}/>
        : <li key={entry.name}><button className={'tree-row '+(activePath===entryPath?'active':'')}
            style={{paddingLeft:16+depth*14}} title={entryPath} onClick={()=>onOpen(entryPath)}>
            <Icon name="file" size={15}/><span>{entry.name}</span>
          </button></li>;
    })}
  </ul>;
}
function Directory(props:Props & {name:string;path:string;depth:number}){
  const key=props.projectRoot+'\n'+props.path;
  const expanded=props.expandedDirectories.has(key);
  return <li><button className="tree-row directory-row" style={{paddingLeft:8+props.depth*14}}
    aria-expanded={expanded} onClick={()=>props.onDirectoryToggle(key)} onContextMenu={async event=>{
      event.stopPropagation();const action=await showContextMenu(event,[{id:'expandAll',label:'Expand Subfolders'},{id:'collapseAll',label:'Collapse Subfolders'}] as const);
      if(action==='expandAll')props.onExpandAllSubfolders(props.path);
      if(action==='collapseAll')props.onCollapseAllSubfolders(props.path);
    }}>
    <Icon name="down" size={12} style={{transform:expanded?undefined:'rotate(-90deg)'}}/>
    <Icon name="folder" size={15}/><span>{props.name}</span>
  </button>{expanded&&<FileTree {...props} depth={props.depth+1}/>}</li>;
}
