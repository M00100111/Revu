import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import type { EditorTabItem } from './TabBar';
import { api, errorMessage } from './files';
import type { OpenFile, Project } from './editor';
import FileTree from './FileTree';
import {useFileTreeReveal} from './useFileTreeReveal';
import Icon from './Icon';
import ResizeHandle from './ResizeHandle';
import ScrollbarScope from './ScrollbarScope';
import { showContextMenu } from './ContextMenu';
import type {CiteRequest} from '../shared/citations';
import { moveFileSidebarItem, OPEN_EDITORS_KEY, reconcileFileSidebarOrder } from './fileSidebarOrder';

type SidebarEditorTab = EditorTabItem & {file?: Pick<OpenFile,'project'|'path'>};

const savedOrder=()=>{
  try{
    const value=JSON.parse(localStorage.getItem('revu-file-sidebar-order')??'[]');
    return Array.isArray(value)?value.filter((item:unknown)=>typeof item==='string'):[];
  }catch{return [];}
};

export default function FileSidebar({width,projects,projectsLoaded,tabs,activeId,activeFile,mixed,picking,collapsedProjects,
  expandedDirectories,onResize,onAddFolder,onSelectTab,onKeep,onOpenFile,onCloseProject,onExpandAllSubfolders,onCollapseAllSubfolders,
  onProjectToggle,onDirectoryToggle,onError,onCite,target}:{
  onCite:(request:CiteRequest)=>void;target?:{projectId:string|null;path:string;token:number;fromEditor?:boolean};
  width:number;projects:Project[];projectsLoaded:boolean;tabs:SidebarEditorTab[];activeId:string|null;activeFile?:OpenFile;mixed:boolean;picking:boolean;
  collapsedProjects:ReadonlySet<string>;expandedDirectories:ReadonlySet<string>;
  onResize:(width:number)=>void;onAddFolder:(root?:string)=>void;onSelectTab:(tab:EditorTabItem)=>void;onKeep:(id:string)=>void;
  onOpenFile:(project:Project,path:string,keep:boolean)=>void;onCloseProject:(project:Project)=>void;
  onExpandAllSubfolders:(project:Project,path:string)=>void;onCollapseAllSubfolders:(project:Project,path:string)=>void;
  onProjectToggle:(root:string,open:boolean)=>void;onDirectoryToggle:(key:string)=>void;onError:(message:string)=>void;
}){
  const rootsKey=projects.map(project=>project.root).join('\0');
  const revealRoot=useFileTreeReveal(target);
  const [historyOpen,setHistoryOpen]=useState(false);
  const [recent,setRecent]=useState<string[]>([]);
  const historyRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!historyOpen)return;
    let live=true;
    void api<string[]>('recentFolders').then(paths=>{if(live)setRecent(paths);}).catch(error=>{
      if(live){onError(errorMessage(error));setHistoryOpen(false);}
    });
    const outside=(event:PointerEvent)=>{if(!historyRef.current?.contains(event.target as Node))setHistoryOpen(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setHistoryOpen(false);historyRef.current?.querySelector('button')?.focus();}};
    window.addEventListener('pointerdown',outside);window.addEventListener('keydown',escape);
    return()=>{live=false;window.removeEventListener('pointerdown',outside);window.removeEventListener('keydown',escape);};
  },[historyOpen,onError]);
  const [order,setOrder]=useState(()=>{
    const saved=savedOrder();return saved.length?saved:[OPEN_EDITORS_KEY];
  });
  const [openEditorsCollapsed,setOpenEditorsCollapsed]=useState(()=>localStorage.getItem('revu-open-editors-collapsed')==='true');
  const [dragged,setDragged]=useState<string|null>(null);
  const [drop,setDrop]=useState<{key:string;after:boolean}|null>(null);
  useEffect(()=>{
    if(!projectsLoaded)return;
    const roots=rootsKey?rootsKey.split('\0'):[];
    setOrder(current=>{
      const next=reconcileFileSidebarOrder(current,roots);
      return next.length===current.length&&next.every((key,index)=>key===current[index])?current:next;
    });
  },[projectsLoaded,rootsKey]);
  useEffect(()=>{
    if(projectsLoaded)localStorage.setItem('revu-file-sidebar-order',JSON.stringify(order));
  },[projectsLoaded,order]);
  useEffect(()=>localStorage.setItem('revu-open-editors-collapsed',String(openEditorsCollapsed)),[openEditorsCollapsed]);
  const projectByRoot=useMemo(()=>new Map(projects.map(project=>[project.root,project])),[projects]);
  const orderedProjects=order.map(key=>projectByRoot.get(key)).filter((project):project is Project=>!!project);
  const beginDrag=(event:DragEvent<HTMLElement>,key:string)=>{
    event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',key);setDragged(key);
  };
  const dragOver=(event:DragEvent<HTMLElement>,key:string)=>{
    if(!dragged||dragged===key)return;
    event.preventDefault();event.dataTransfer.dropEffect='move';
    const bounds=event.currentTarget.getBoundingClientRect();
    setDrop({key,after:event.clientY>=bounds.top+bounds.height/2});
  };
  const finishDrop=(event:DragEvent<HTMLElement>,key:string)=>{
    event.preventDefault();
    if(dragged)setOrder(current=>moveFileSidebarItem(current,dragged,key,drop?.key===key&&!!drop.after));
    setDragged(null);setDrop(null);
  };
  const dragClass=(key:string)=>'sidebar-top-entry '+(dragged===key?'dragging ':'')+
    (drop?.key===key?(drop.after?'drop-after':'drop-before'):'');
  const editorRow=(tab:SidebarEditorTab,showProject:boolean)=><button key={tab.id}
    className={'open-editor-row '+(activeId===tab.id?'active':'')} title={tab.title}
    onClick={()=>onSelectTab(tab)} onDoubleClick={()=>onKeep(tab.id)}
    onContextMenu={async event=>{
      const {file}=tab;
      if(!file)return;
      const action=await showContextMenu(event,[{id:'cite',label:'Cite'}]);
      if(action==='cite')onCite({projectId:file.project.id,path:file.path});
    }}>
    <Icon name="file" size={13}/><span className={tab.preview?'preview-name':undefined}>{tab.name}</span>
    {showProject&&<small>{tab.projectName}</small>}{tab.dirty&&<i className="dirty-dot"/>}
  </button>;
  const openEditorsContent=()=>{
    if(!tabs.length)return <div className="open-editor-empty">No open editors</div>;
    if(mixed||tabs.every(tab=>tab.groupId===tabs[0].groupId))
      return <div className="open-editor-list">{tabs.map(tab=>editorRow(tab,mixed))}</div>;
    return <div className="open-editor-groups">{[...orderedProjects,{id:null,name:'Other'}].map(group=>{
      const items=tabs.filter(tab=>tab.groupId===group.id);
      return items.length?<section key={group.id??'other'}><div className="open-editor-project">{group.name}</div>
        <div className="open-editor-list">{items.map(tab=>editorRow(tab,false))}</div></section>:null;
    })}</div>;
  };
  const openEditors=<details key={OPEN_EDITORS_KEY} className={dragClass(OPEN_EDITORS_KEY)} open={!openEditorsCollapsed}
    onToggle={event=>setOpenEditorsCollapsed(!event.currentTarget.open)}
    >
    <summary className="workspace-name" ref={target?.projectId===null?revealRoot:undefined} draggable onDragStart={event=>beginDrag(event,OPEN_EDITORS_KEY)}
      onDragOver={event=>dragOver(event,OPEN_EDITORS_KEY)} onDrop={event=>finishDrop(event,OPEN_EDITORS_KEY)}
      onDragEnd={()=>{setDragged(null);setDrop(null);}}>
      <Icon name="down" size={12}/><Icon name="openEditors" size={15}/><span>Open Editors</span>
    </summary>{openEditorsContent()}
  </details>;
  const projectEntry=(project:Project)=><details className={dragClass(project.root)+' project-tree'} key={project.root}
    open={!collapsedProjects.has(project.root)} onToggle={event=>onProjectToggle(project.root,event.currentTarget.open)}
    >
    <summary className="workspace-name" title={project.root} draggable ref={target?.projectId===project.id&&!target.path?revealRoot:undefined}
      onDragStart={event=>beginDrag(event,project.root)} onDragEnd={()=>{setDragged(null);setDrop(null);}}
      onDragOver={event=>dragOver(event,project.root)} onDrop={event=>finishDrop(event,project.root)}
      onContextMenu={async event=>{
        const action=await showContextMenu(event,[{id:'cite',label:'Cite'},{id:'close',label:'Close Folder'},{id:'expandAll',label:'Expand Subfolders',separatorBefore:true},{id:'collapseAll',label:'Collapse Subfolders'}] as const);
        if(action==='cite')onCite({projectId:project.id,path:'.',directory:true});
        if(action==='close')onCloseProject(project);
        if(action==='expandAll')onExpandAllSubfolders(project,'');
        if(action==='collapseAll')onCollapseAllSubfolders(project,'');
      }}><Icon name="down" size={12}/><Icon name="folder" size={15}/><span>{project.name}</span></summary>
    <FileTree projectId={project.id} projectRoot={project.root} onCite={onCite} target={target?.projectId===project.id?target:undefined}
      activePath={activeFile?.project.id===project.id?activeFile.path:null}
      onOpen={(path,keep)=>onOpenFile(project,path,keep)} onError={onError}
      expandedDirectories={expandedDirectories} onDirectoryToggle={onDirectoryToggle}
      onExpandAllSubfolders={path=>onExpandAllSubfolders(project,path)}
      onCollapseAllSubfolders={path=>onCollapseAllSubfolders(project,path)}/>
  </details>;
  return <aside className="explorer" style={{width}}>
    <header className="explorer-header"><span>File</span><div className="file-header-actions">
      <div ref={historyRef}><button className="icon-button" title="Recent Folders" aria-label="Recent Folders"
        aria-expanded={historyOpen} disabled={picking} onClick={()=>setHistoryOpen(open=>!open)}><Icon name="history" size={17}/></button>
        {historyOpen&&<div className="project-dropdown-menu recent-folders">
          {recent.length?recent.map(path=><button key={path} title={path} onClick={()=>{setHistoryOpen(false);onAddFolder(path);}}>
            <span>{path.split(/[\\/]/).filter(Boolean).at(-1)??path}</span><small>{path}</small>
          </button>):<small>No recent folders</small>}
        </div>}
      </div>
      <button className="icon-button" onClick={()=>onAddFolder()}
      disabled={picking} title="Open folder" aria-label="Open folder"><Icon name="openFolder" size={17}/></button></div></header>
    {projects.length||tabs.length?<ScrollbarScope className="tree-scroll">{order.map(key=>key===OPEN_EDITORS_KEY?openEditors:
      projectByRoot.has(key)?projectEntry(projectByRoot.get(key)!):null)}</ScrollbarScope>:<p className="sidebar-empty">No folders open</p>}
    <ResizeHandle width={width} onResize={onResize}/>
  </aside>;
}
