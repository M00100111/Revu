import { useEffect, useMemo, useState, type DragEvent } from 'react';
import type { OpenFile, Project } from './editor';
import FileTree from './FileTree';
import Icon from './Icon';
import ResizeHandle from './ResizeHandle';
import { moveFileSidebarItem, OPEN_EDITORS_KEY, reconcileFileSidebarOrder } from './fileSidebarOrder';

const savedOrder=()=>{
  try{
    const value=JSON.parse(localStorage.getItem('revu-file-sidebar-order')??'[]');
    return Array.isArray(value)?value.filter((item:unknown)=>typeof item==='string'):[];
  }catch{return [];}
};

export default function FileSidebar({width,projects,projectsLoaded,openFiles,activeFile,mixed,picking,collapsedProjects,
  expandedDirectories,onResize,onAddFolder,onSelectFile,onOpenFile,onCloseProject,onProjectToggle,onDirectoryToggle,onError}:{
  width:number;projects:Project[];projectsLoaded:boolean;openFiles:OpenFile[];activeFile?:OpenFile;mixed:boolean;picking:boolean;
  collapsedProjects:ReadonlySet<string>;expandedDirectories:ReadonlySet<string>;
  onResize:(width:number)=>void;onAddFolder:()=>void;onSelectFile:(file:OpenFile)=>void;
  onOpenFile:(project:Project,path:string)=>void;onCloseProject:(project:Project)=>void;
  onProjectToggle:(root:string,open:boolean)=>void;onDirectoryToggle:(key:string)=>void;onError:(message:string)=>void;
}){
  const rootsKey=projects.map(project=>project.root).join('\0');
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
  const editorRow=(file:OpenFile,showProject:boolean)=><button key={file.id}
    className={'open-editor-row '+(activeFile?.id===file.id?'active':'')} title={file.project.name+'/'+file.path}
    onClick={()=>onSelectFile(file)}>
    <Icon name="file" size={13}/><span>{file.name}</span>
    {showProject&&<small>{file.project.name}</small>}{file.dirty&&<i className="dirty-dot"/>}
  </button>;
  const openEditorsContent=()=>{
    if(!openFiles.length)return <p className="tree-note">No open editors</p>;
    if(mixed)return <div className="open-editor-list">{openFiles.map(file=>editorRow(file,true))}</div>;
    if(projects.length===1)return <div className="open-editor-list">{openFiles.map(file=>editorRow(file,false))}</div>;
    return <div className="open-editor-groups">{orderedProjects.map(project=>{
      const files=openFiles.filter(file=>file.project.id===project.id);
      return files.length?<section key={project.id}><div className="open-editor-project">{project.name}</div>
        <div className="open-editor-list">{files.map(file=>editorRow(file,false))}</div></section>:null;
    })}</div>;
  };
  const openEditors=<details key={OPEN_EDITORS_KEY} className={dragClass(OPEN_EDITORS_KEY)} open={!openEditorsCollapsed}
    onToggle={event=>setOpenEditorsCollapsed(!event.currentTarget.open)}
    >
    <summary className="workspace-name" draggable onDragStart={event=>beginDrag(event,OPEN_EDITORS_KEY)}
      onDragOver={event=>dragOver(event,OPEN_EDITORS_KEY)} onDrop={event=>finishDrop(event,OPEN_EDITORS_KEY)}
      onDragEnd={()=>{setDragged(null);setDrop(null);}}>
      <Icon name="chevron" size={12}/><Icon name="file" size={15}/><span>Open Editors</span>
    </summary>{openEditorsContent()}
  </details>;
  const projectEntry=(project:Project)=><details className={dragClass(project.root)+' project-tree'} key={project.root}
    open={!collapsedProjects.has(project.root)} onToggle={event=>onProjectToggle(project.root,event.currentTarget.open)}
    >
    <summary className="workspace-name" title={project.root} draggable
      onDragStart={event=>beginDrag(event,project.root)} onDragEnd={()=>{setDragged(null);setDrop(null);}}
      onDragOver={event=>dragOver(event,project.root)} onDrop={event=>finishDrop(event,project.root)}
      onContextMenu={async event=>{
        event.preventDefault();if(await window.revu.contextMenu('project')==='close')onCloseProject(project);
      }}><Icon name="chevron" size={12}/><Icon name="folder" size={15}/><span>{project.name}</span></summary>
    <FileTree projectId={project.id} projectRoot={project.root}
      activePath={activeFile?.project.id===project.id?activeFile.path:null}
      onOpen={path=>onOpenFile(project,path)} onError={onError}
      expandedDirectories={expandedDirectories} onDirectoryToggle={onDirectoryToggle}/>
  </details>;
  return <aside className="explorer" style={{width}}>
    <header className="explorer-header"><span>File</span><button className="icon-button" onClick={onAddFolder}
      disabled={picking} title="Open folder" aria-label="Open folder"><Icon name="folder" size={17}/></button></header>
    {projects.length?<div className="tree-scroll">{order.map(key=>key===OPEN_EDITORS_KEY?openEditors:
      projectByRoot.has(key)?projectEntry(projectByRoot.get(key)!):null)}</div>:<p className="sidebar-empty">No folders open</p>}
    <ResizeHandle width={width} onResize={onResize}/>
  </aside>;
}
