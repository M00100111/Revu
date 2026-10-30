import { useEffect, useRef, useState } from 'react';
import { monaco, type OpenFile, type Project } from './editor';
import { errorMessage } from './files';
import { useWorkspace } from './useWorkspace';
import EditorArea from './EditorArea';
import FileTree from './FileTree';
import Icon from './Icon';
import Sidebar, { type Panel } from './Sidebar';
import TabBar, { type TabContextAction } from './TabBar';
import ReviewDashboard from './ReviewDashboard';
import ConflictPanel from './ConflictPanel';
import ResizeHandle from './ResizeHandle';
import SettingsPage, { SettingsSidebar } from './SettingsPage';
import WindowControls from './WindowControls';

const savedWidth=(key:string,fallback:number)=>{
  const value=Number(localStorage.getItem(key));
  return value>=180&&value<=520?value:fallback;
};

export default function App(){
  const [dark,setDark]=useState(()=>localStorage.getItem('revu-theme')==='dark');
  const [panel,setPanel]=useState<Panel>('files');
  const [syncWidths,setSyncWidths]=useState(()=>localStorage.getItem('revu-sync-sidebar-widths')!=='false');
  const [widths,setWidths]=useState(()=>({
    shared:savedWidth('revu-sidebar-width',236),
    files:savedWidth('revu-file-sidebar-width',236),
    review:savedWidth('revu-review-sidebar-width',236),
    settings:savedWidth('revu-settings-sidebar-width',236),
  }));
  const [tabs,setTabs]=useState<string[]>([]);
  const [activeId,setActiveId]=useState<string|null>(null);
  const [projectId,setProjectId]=useState<string|null>(null);
  const [mixed,setMixed]=useState(()=>localStorage.getItem('revu-editor-tab-mode')==='mixed');
  const [error,setError]=useState('');
  const [picking,setPicking]=useState(false);
  const [reveal,setReveal]=useState<{id:string;line:number}|null>(null);
  const workspace=useWorkspace(setError);
  const {projects,documents,statuses,tick}=workspace;
  const editorRef=useRef<monaco.editor.IStandaloneCodeEditor|null>(null);
  const lastFile=useRef(new Map<string,string>());
  const documentsRef=useRef(documents);documentsRef.current=documents;
  const openFiles=tabs.map(id=>documents.find(file=>file.id===id)).filter((f):f is OpenFile=>!!f);
  const activeFile=openFiles.find(file=>file.id===activeId);
  const visibleFiles=mixed?openFiles:openFiles.filter(file=>file.project.id===projectId);
  useEffect(()=>{
    document.documentElement.dataset.theme=dark?'dark':'light';
    localStorage.setItem('revu-theme',dark?'dark':'light');
  },[dark]);
  useEffect(()=>{
    localStorage.setItem('revu-sync-sidebar-widths',String(syncWidths));
    localStorage.setItem('revu-sidebar-width',String(widths.shared));
    localStorage.setItem('revu-file-sidebar-width',String(widths.files));
    localStorage.setItem('revu-review-sidebar-width',String(widths.review));
    localStorage.setItem('revu-settings-sidebar-width',String(widths.settings));
  },[syncWidths,widths]);
  useEffect(()=>localStorage.setItem('revu-editor-tab-mode',mixed?'mixed':'isolated'),[mixed]);
  useEffect(()=>{
    const beforeUnload=(event:BeforeUnloadEvent)=>{if(documentsRef.current.some(file=>file.dirty))event.preventDefault();};
    window.addEventListener('beforeunload',beforeUnload);
    return()=>window.removeEventListener('beforeunload',beforeUnload);
  },[]);
  useEffect(()=>{
    const onKeyDown=(event:KeyboardEvent)=>{
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){
        event.preventDefault();if(activeFile)void workspace.save(activeFile);
      }
    };
    window.addEventListener('keydown',onKeyDown,true);
    return()=>window.removeEventListener('keydown',onKeyDown,true);
  });
  function selectFile(file:OpenFile){
    lastFile.current.set(file.project.id,file.id);setProjectId(file.project.id);setActiveId(file.id);setReveal(null);
  }
  function selectProject(id:string){
    setProjectId(id);
    const remembered=lastFile.current.get(id);
    const file=openFiles.find(file=>file.id===remembered)??openFiles.find(file=>file.project.id===id);
    setActiveId(file?.id??null);setReveal(null);
  }
  async function addFolder(){
    if(picking)return;setPicking(true);
    try{
      const project=await workspace.addProject();if(!project)return;
      if(!mixed||!activeFile)selectProject(project.id);
      setPanel('files');setError('');
    }catch(error){setError(errorMessage(error));}finally{setPicking(false);}
  }
  async function openFile(project:Project,path:string,line?:number){
    try{
      const file=await workspace.load(project,path);
      setTabs(current=>current.includes(file.id)?current:[...current,file.id]);
      selectFile(file);if(line)setReveal({id:file.id,line});setError('');
    }catch(error){setError(errorMessage(error));}
  }
  function closeFiles(targets:OpenFile[]){
    if(!targets.length||targets.some(file=>file.saving||file.syncing))return;
    const dirty=targets.filter(file=>file.dirty);
    if(dirty.length&&!window.confirm(`${dirty.length} tab${dirty.length===1?' has':'s have'} unsaved changes. Discard the draft${dirty.length===1?'':'s'} and close?`))return;
    const closing=new Set(targets.map(file=>file.id));
    for(const file of dirty){file.records=file.records.map(record=>({...record,stale:true}));file.model.setValue(file.synced.text);file.dirty=false;}
    const remaining=openFiles.filter(file=>!closing.has(file.id));
    for(const file of targets){
      if(lastFile.current.get(file.project.id)!==file.id)continue;
      const sibling=remaining.find(item=>item.project.id===file.project.id);
      if(sibling)lastFile.current.set(file.project.id,sibling.id);else lastFile.current.delete(file.project.id);
    }
    if(activeId&&closing.has(activeId)){
      const candidates=visibleFiles.filter(file=>!closing.has(file.id));
      const index=Math.max(0,visibleFiles.findIndex(file=>file.id===activeId));
      const next=candidates[Math.min(index,candidates.length-1)];
      if(next)selectFile(next);else setActiveId(null);
    }
    setTabs(current=>current.filter(id=>!closing.has(id)));
  }
  const closeFile=(file:OpenFile)=>closeFiles([file]);
  const tabContext=(file:OpenFile,action:TabContextAction)=>closeFiles(action==='close'?[file]:action==='closeOthers'
    ?openFiles.filter(item=>item!==file):openFiles);
  async function closeProject(project:Project){
    const affected=documents.filter(file=>file.project.id===project.id);
    if(affected.some(file=>file.saving||file.syncing)){setError('Wait for active file operations before closing the folder.');return;}
    const dirty=affected.filter(file=>file.dirty);
    if(dirty.length&&!window.confirm(`${project.name} has ${dirty.length} unsaved file${dirty.length===1?'':'s'}. Discard the drafts and close the folder?`))return;
    const remaining=openFiles.filter(file=>file.project.id!==project.id);
    try{
      await workspace.removeProject(project);
      setTabs(current=>current.filter(id=>!affected.some(file=>file.id===id)));lastFile.current.delete(project.id);
      if(activeFile?.project.id===project.id){const next=remaining[0];if(next)selectFile(next);else setActiveId(null);}
      if(projectId===project.id)setProjectId(remaining[0]?.project.id??projects.find(item=>item.id!==project.id)?.id??null);
      setError('');
    }catch(error){setError(errorMessage(error));}
  }
  const sidebarWidth=panel?(syncWidths?widths.shared:widths[panel]):0;
  const resizeSidebar=(width:number)=>{
    if(!panel)return;
    setWidths(current=>syncWidths?{...current,shared:width}:{...current,[panel]:width});
  };
  const changeWidthSync=(value:boolean)=>{
    setWidths(current=>value
      ? {...current,shared:panel?current[panel]:current.shared}
      : {...current,files:current.shared,review:current.shared,settings:current.shared});
    setSyncWidths(value);
  };
  return <div className="app">
    <WindowControls/>
    <Sidebar panel={panel} setPanel={setPanel} dark={dark} toggleTheme={()=>setDark(!dark)}/>
    {panel==='files'&&<aside className="explorer" style={{width:sidebarWidth}}>
      <header className="explorer-header"><span>File</span><button className="icon-button" onClick={addFolder}
        disabled={picking} title="Open folder" aria-label="Open folder"><Icon name="folder" size={17}/></button></header>
      {projects.length?<div className="tree-scroll">{projects.map(project=><details className="project-tree" key={project.id} open>
        <summary className="workspace-name" title={project.root} onContextMenu={async event=>{
          event.preventDefault();if(await window.revu.contextMenu('project')==='close')void closeProject(project);
        }}><Icon name="chevron" size={12}/><Icon name="folder" size={15}/><span>{project.name}</span></summary>
        <FileTree projectId={project.id} activePath={activeFile?.project.id===project.id?activeFile.path:null}
          onOpen={path=>void openFile(project,path)} onError={setError}/>
      </details>)}</div>:<p className="sidebar-empty">No folders open</p>}
      <ResizeHandle width={sidebarWidth} onResize={resizeSidebar}/>
    </aside>}
    {panel==='review'&&<ReviewDashboard projects={projects} documents={documents} statuses={statuses}
      width={sidebarWidth} onResize={resizeSidebar} onOpen={openFile} onAction={workspace.act}
      onBulk={workspace.bulk} onRefreshBase={workspace.refreshBase}/>}
    {panel==='settings'&&<SettingsSidebar width={sidebarWidth} onResize={resizeSidebar}/>}
    {panel==='settings'?<SettingsPage syncWidths={syncWidths} onChange={changeWidthSync}
      mixed={mixed} onModeChange={setMixed}/>:<>
    <main className="main">
      {error&&<div className="error-banner" role="alert"><span>{error}</span><button className="icon-button"
        aria-label="Dismiss error" onClick={()=>setError('')}><Icon name="close" size={14}/></button></div>}
      {projects.length>0&&<>
        {!mixed&&<div className="project-bar"><div className="project-tabs" aria-label="Project tabs">
          {projects.map(project=><button key={project.id} className={'project-tab '+(project.id===projectId?'active':'')}
            aria-pressed={project.id===projectId} onClick={()=>selectProject(project.id)}>
            <Icon name="folder" size={14}/><span>{project.name}</span>
            {documents.some(file=>file.project.id===project.id&&file.dirty)&&<span className="dirty-dot"/>}
          </button>)}</div></div>}
        <TabBar files={visibleFiles} activeId={activeId} onSelect={selectFile} onClose={closeFile}
          onContextAction={tabContext}
          onSave={()=>{if(activeFile)void workspace.save(activeFile);}}
          saving={!!(activeFile?.saving||activeFile?.syncing||activeFile?.conflict||activeFile?.reason)}
          mixed={mixed}/>
      </>}
      {activeFile?<>
        <div className="breadcrumb"><span>{activeFile.project.name}</span><span>/</span><span>{activeFile.path}</span></div>
        {activeFile.notice&&<div className="sync-notice">{activeFile.notice}</div>}
        {(activeFile.reason||activeFile.diffError)&&<div className="review-warning">{activeFile.reason||activeFile.diffError}</div>}
        <ConflictPanel file={activeFile} onFinish={()=>void workspace.finishMerge(activeFile)}/>
        <div className="editor-container"><EditorArea file={activeFile} dark={dark} editorRef={editorRef}
          tick={tick} onAction={workspace.act} revealLine={reveal?.id===activeFile.id?reveal.line:undefined}/></div>
        <footer className="status-bar"><span>{activeFile.conflict?'External conflict':activeFile.dirty?'Unsaved':'Saved'}
          {activeFile.computing?' · Updating diff…':''}</span>
          <span>{activeFile.model.getLanguageId()}<span className="status-divider">UTF-8{activeFile.synced.bom?' BOM':''}</span></span></footer>
      </>:<div className="empty-state">
        {projects.length?<span className="empty-project-hint">Select a file from the sidebar</span>
          :<button className="open-folder-button" onClick={addFolder} disabled={picking}><Icon name="folder" size={19}/>{picking?'Opening…':'Open Folder'}</button>}
        <div className="shortcut-hint"><kbd>Ctrl</kbd> + <kbd>S</kbd><span>Save</span><i/><kbd>Ctrl</kbd> + <kbd>F</kbd><span>Find</span></div>
      </div>}
    </main>
    </>}
  </div>;
}
