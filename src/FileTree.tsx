import { useEffect, useState } from 'react';
import { api, errorMessage } from './files';
import type { Entry } from '../shared/types';
import Icon from './Icon';
type Props = {
  projectId: string; activePath: string | null;
  onOpen: (path: string) => void; onError: (message: string) => void;
  path?: string; depth?: number;
};
export default function FileTree({ projectId, activePath, onOpen, onError, path = '', depth = 0 }: Props) {
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
        ? <Directory key={entry.name} projectId={projectId} name={entry.name} path={entryPath}
            depth={depth} activePath={activePath} onOpen={onOpen} onError={onError}/>
        : <li key={entry.name}><button className={'tree-row '+(activePath===entryPath?'active':'')}
            style={{paddingLeft:16+depth*14}} title={entryPath} onClick={()=>onOpen(entryPath)}>
            <Icon name="file" size={15}/><span>{entry.name}</span>
          </button></li>;
    })}
  </ul>;
}
function Directory(props:Props & {name:string;path:string;depth:number}){
  const [expanded,setExpanded]=useState(false);
  return <li><button className="tree-row directory-row" style={{paddingLeft:8+props.depth*14}}
    aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>
    <Icon name="chevron" size={12} style={{transform:expanded?'rotate(90deg)':undefined}}/>
    <Icon name="folder" size={15}/><span>{props.name}</span>
  </button>{expanded&&<FileTree {...props} depth={props.depth+1}/>}</li>;
}
