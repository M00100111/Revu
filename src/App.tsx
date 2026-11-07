import { useCallback, useEffect, useRef, useState } from 'react';
import { monaco, type OpenFile, type Project } from './editor';
import { errorMessage } from './files';
import { useWorkspace } from './useWorkspace';
import EditorArea from './EditorArea';
import FileSidebar from './FileSidebar';
import Icon from './Icon';
import Sidebar, { type Panel } from './Sidebar';
import TabBar, { type TabContextAction } from './TabBar';
import ReviewDashboard from './ReviewDashboard';
import SettingsPage, { SettingsSidebar, type ReviewFileLabels, type SettingsCategory } from './SettingsPage';
import WindowControls from './WindowControls';
import NotificationCenter, { type AppNotification, type NotificationAction, type NotificationLevel } from './NotificationCenter';
import { defaultTabExpansion, type FileTabExpansion, type FileTabOverflow } from './tabLayout';
import AgentChat, { type AgentNavigationRequest, type AgentNotice } from './AgentChat';

const savedWidth=(key:string,fallback:number)=>{
  const value=Number(localStorage.getItem(key));
  return Number.isFinite(value)&&value>=250?value:fallback;
};
const savedStringSet=(key:string)=>{
  try{
    const value=JSON.parse(localStorage.getItem(key)??'[]');
    return new Set<string>(Array.isArray(value)?value.filter((item:unknown)=>typeof item==='string'):[]);
  }catch{return new Set<string>();}
};
const savedFontSize=()=>{
  const value=Number(localStorage.getItem('revu-editor-font-size'));
  return Number.isFinite(value)&&value>=10&&value<=24?value:14;
};

export default function App(){
  const [dark,setDark]=useState(()=>localStorage.getItem('revu-theme')==='dark');
  const [showThemeSwitcher,setShowThemeSwitcher]=useState(()=>localStorage.getItem('revu-show-theme-switcher')!=='false');
  const [panel,setPanel]=useState<Panel>('files');
  const [syncWidths,setSyncWidths]=useState(()=>localStorage.getItem('revu-sync-sidebar-widths')!=='false');
  const [widths,setWidths]=useState(()=>({
    shared:savedWidth('revu-sidebar-width',250),
    files:savedWidth('revu-file-sidebar-width',250),
    review:savedWidth('revu-review-sidebar-width',250),
    settings:savedWidth('revu-settings-sidebar-width',250),
  }));
  const [tabs,setTabs]=useState<string[]>([]);
  const [activeId,setActiveId]=useState<string|null>(null);
  const [projectId,setProjectId]=useState<string|null>(null);
  const [mixed,setMixed]=useState(()=>localStorage.getItem('revu-editor-tab-mode')==='mixed');
  const [fileTabOverflow,setFileTabOverflow]=useState<FileTabOverflow>(()=>
    localStorage.getItem('revu-file-tab-overflow')==='wrap'?'wrap':'scroll');
  const [fileTabExpansion,setFileTabExpansion]=useState<FileTabExpansion>(()=>defaultTabExpansion(
    localStorage.getItem('revu-file-tab-overflow')==='wrap'?'wrap':'scroll'));
  const [hideSingleProjectTabs,setHideSingleProjectTabs]=useState(()=>localStorage.getItem('revu-hide-single-project-tabs')==='true');
  const [settingsCategory,setSettingsCategory]=useState<SettingsCategory>('interaction');
  const [fontSize,setFontSize]=useState(savedFontSize);
  const [reviewFileLabels,setReviewFileLabels]=useState<ReviewFileLabels>(()=>
    localStorage.getItem('revu-review-file-labels')==='name'?'name':'path');
  const [notifications,setNotifications]=useState<AppNotification[]>([]);
  const [notificationsOpen,setNotificationsOpen]=useState(false);
  const [agentOpen,setAgentOpen]=useState(false);
  const [agentNavigation,setAgentNavigation]=useState<AgentNavigationRequest|null>(null);
  const [agentWidth,setAgentWidth]=useState(()=>savedWidth('revu-agent-width',400));
  const [picking,setPicking]=useState(false);
  const [reveal,setReveal]=useState<{id:string;line:number}|null>(null);
  const [reviewFilter,setReviewFilter]=useState('all');
  const [reviewSelected,setReviewSelected]=useState('');
  const [reviewReveal,setReviewReveal]=useState<{fileId:string;itemId:string;token:number}|null>(null);
  const [expandedReviewRecords,setExpandedReviewRecords]=useState<Set<string>>(()=>new Set());
  const [reviewSplit,setReviewSplit]=useState(()=>localStorage.getItem('revu-review-split')==='true');
  const [reviewChunkWidth,setReviewChunkWidth]=useState(()=>savedWidth('revu-review-chunk-width',320));
  const [collapsedProjects,setCollapsedProjects]=useState(()=>savedStringSet('revu-collapsed-projects'));
  const [expandedDirectories,setExpandedDirectories]=useState(()=>savedStringSet('revu-expanded-directories'));
  const notify=useCallback((level:NotificationLevel,message:string,action?:NotificationAction)=>{
    const createdAt=Date.now();
    setNotifications(current=>{
      const duplicate=current.find(item=>item.level===level&&item.message===message&&createdAt-item.createdAt<3000);
      if(duplicate){
        const updated={...duplicate,createdAt,read:false,toast:true,count:duplicate.count+1,action:action??duplicate.action};
        return [updated,...current.filter(item=>item.id!==duplicate.id)];
      }
      return [{id:crypto.randomUUID(),level,message,createdAt,read:false,toast:true,count:1,action},...current];
    });
  },[]);
  const notifyError=useCallback((message:string)=>notify('error',message),[notify]);
  const notifyWarning=useCallback((message:string)=>notify('warning',message),[notify]);
  const dismissToast=useCallback((id:string)=>setNotifications(current=>current.map(item=>
    item.id===id?{...item,toast:false}:item)),[]);
  const deleteNotification=useCallback((id:string)=>setNotifications(current=>current.filter(item=>item.id!==id)),[]);
  const activateNotification=useCallback((id:string)=>{
    const notification=notifications.find(item=>item.id===id);
    setNotifications(current=>current.map(item=>item.id===id?{...item,read:true,toast:false}:item));
    const action=notification?.action;
    if(action?.type==='open-agent-session'){
      setAgentOpen(true);setNotificationsOpen(false);
      setAgentNavigation(current=>({projectId:action.projectId,sessionId:action.sessionId,
        runKey:action.runKey,token:(current?.token??0)+1}));
    }
  },[notifications]);
  const handleAgentNotice=useCallback((notice:AgentNotice)=>notify(notice.level,notice.message,
    {type:'open-agent-session',projectId:notice.projectId,sessionId:notice.sessionId,runKey:notice.runKey}),[notify]);
  const readAllNotifications=useCallback(()=>setNotifications(current=>current.map(item=>
    item.read?item:{...item,read:true})),[]);
  const workspace=useWorkspace(notifyError,notifyWarning);
  const {projects,projectsLoaded,documents,statuses,tick}=workspace;
  const editorRef=useRef<monaco.editor.IStandaloneCodeEditor|null>(null);
  const lastFile=useRef(new Map<string,string>());
  const seenNotices=useRef(new Map<string,string>());
  const openFiles=tabs.map(id=>documents.find(file=>file.id===id)).filter((f):f is OpenFile=>!!f);
  const activeFile=openFiles.find(file=>file.id===activeId);
  const visibleFiles=mixed?openFiles:openFiles.filter(file=>file.project.id===projectId);
  const tabScope=mixed?'mixed':projectId;
  useEffect(()=>{
    if(!projectId&&projects.length)setProjectId(projects[0].id);
  },[projects,projectId]);
  useEffect(()=>{
    const documentIds=new Set(documents.map(file=>file.id));
    if(tabs.every(id=>documentIds.has(id)))return;
    const activeIndex=activeId?tabs.indexOf(activeId):-1;
    const remaining=tabs.filter(id=>documentIds.has(id));
    setTabs(remaining);
    if(activeId&&!documentIds.has(activeId)){
      const nextId=remaining[Math.min(Math.max(activeIndex,0),remaining.length-1)]??null;
      const next=documents.find(file=>file.id===nextId);
      setActiveId(nextId);setProjectId(next?.project.id??null);setReveal(null);
    }
  },[documents,tabs,activeId]);
  useEffect(()=>{
    document.documentElement.dataset.theme=dark?'dark':'light';
    localStorage.setItem('revu-theme',dark?'dark':'light');
  },[dark]);
  useEffect(()=>localStorage.setItem('revu-show-theme-switcher',String(showThemeSwitcher)),[showThemeSwitcher]);
  useEffect(()=>{
    localStorage.setItem('revu-sync-sidebar-widths',String(syncWidths));
    localStorage.setItem('revu-sidebar-width',String(widths.shared));
    localStorage.setItem('revu-file-sidebar-width',String(widths.files));
    localStorage.setItem('revu-review-sidebar-width',String(widths.review));
    localStorage.setItem('revu-settings-sidebar-width',String(widths.settings));
  },[syncWidths,widths]);
  useEffect(()=>localStorage.setItem('revu-editor-tab-mode',mixed?'mixed':'isolated'),[mixed]);
  useEffect(()=>localStorage.setItem('revu-file-tab-overflow',fileTabOverflow),[fileTabOverflow]);
  useEffect(()=>setFileTabExpansion(defaultTabExpansion(fileTabOverflow)),[fileTabOverflow,tabScope]);
  useEffect(()=>localStorage.setItem('revu-hide-single-project-tabs',String(hideSingleProjectTabs)),[hideSingleProjectTabs]);
  useEffect(()=>{
    localStorage.setItem('revu-review-split',String(reviewSplit));
    localStorage.setItem('revu-review-chunk-width',String(reviewChunkWidth));
  },[reviewSplit,reviewChunkWidth]);
  useEffect(()=>{
    localStorage.setItem('revu-collapsed-projects',JSON.stringify([...collapsedProjects]));
  },[collapsedProjects]);
  useEffect(()=>{
    localStorage.setItem('revu-expanded-directories',JSON.stringify([...expandedDirectories]));
  },[expandedDirectories]);
  useEffect(()=>{
    const size=Math.max(10,Math.min(24,fontSize));
    const lineHeight=Math.round(size*12/7);
    localStorage.removeItem('revu-editor-font-family');
    localStorage.setItem('revu-editor-font-size',String(size));
    document.documentElement.style.setProperty('--editor-font-size',size+'px');
    document.documentElement.style.setProperty('--editor-line-height',lineHeight+'px');
  },[fontSize]);
  useEffect(()=>localStorage.setItem('revu-review-file-labels',reviewFileLabels),[reviewFileLabels]);
  useEffect(()=>{window.revu.setDirty(documents.some(file=>file.dirty));},[documents]);
  useEffect(()=>{
    const live=new Set(documents.map(file=>file.id));
    for(const id of seenNotices.current.keys())if(!live.has(id))seenNotices.current.delete(id);
    for(const file of documents){
      if(!file.notice){seenNotices.current.delete(file.id);continue;}
      const marker=file.notice+'\0'+file.synced.hash;
      if(seenNotices.current.get(file.id)===marker)continue;
      seenNotices.current.set(file.id,marker);
      notify('info',`${file.project.name}/${file.path}: ${file.notice}`);
    }
  },[documents,tick,notify]);
  useEffect(()=>{
    const valid=new Set(documents.flatMap(file=>file.records.map(record=>record.id)));
    setExpandedReviewRecords(current=>{
      const next=new Set([...current].filter(id=>valid.has(id)));
      return next.size===current.size?current:next;
    });
  },[documents,tick]);
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
  function toggleDirectory(key:string){
    setExpandedDirectories(current=>{
      const next=new Set(current);
      if(next.has(key))next.delete(key);else next.add(key);
      return next;
    });
  }
  function toggleProject(root:string,open:boolean){
    setCollapsedProjects(current=>{
      if(open===!current.has(root))return current;
      const next=new Set(current);if(open)next.delete(root);else next.add(root);return next;
    });
  }
  function toggleReviewPreview(id:string){
    setExpandedReviewRecords(current=>{
      const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next;
    });
  }
  async function addFolder(){
    if(picking)return;setPicking(true);
    try{
      const project=await workspace.addProject();if(!project)return;
      if(!mixed||!activeFile)selectProject(project.id);
      setPanel('files');
    }catch(error){notifyError(errorMessage(error));}finally{setPicking(false);}
  }
  async function openFile(project:Project,path:string,line?:number){
    try{
      const file=await workspace.load(project,path);
      setTabs(current=>current.includes(file.id)?current:[...current,file.id]);
      selectFile(file);if(line)setReveal({id:file.id,line});
    }catch(error){notifyError(errorMessage(error));}
  }
  function closeFiles(targets:OpenFile[]){
    if(!targets.length||targets.some(file=>file.saving||file.syncing))return;
    const dirty=targets.filter(file=>file.dirty);
    if(dirty.length&&!window.confirm(`${dirty.length} tab${dirty.length===1?' has':'s have'} unsaved changes. Discard the draft${dirty.length===1?'':'s'} and close?`))return;
    const closing=new Set(targets.map(file=>file.id));
    for(const file of dirty){
      file.records=[];file.chunks=[];file.draftExists=file.synced.exists;
      file.model.setValue(file.synced.text);file.dirty=false;
    }
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
    if(affected.some(file=>file.saving||file.syncing)){notify('warning','Wait for active file operations before closing the folder.');return;}
    const dirty=affected.filter(file=>file.dirty);
    if(dirty.length&&!window.confirm(`${project.name} has ${dirty.length} unsaved file${dirty.length===1?'':'s'}. Discard the drafts and close the folder?`))return;
    const remaining=openFiles.filter(file=>file.project.id!==project.id);
    try{
      await workspace.removeProject(project);
      setTabs(current=>current.filter(id=>!affected.some(file=>file.id===id)));lastFile.current.delete(project.id);
      if(activeFile?.project.id===project.id){const next=remaining[0];if(next)selectFile(next);else setActiveId(null);}
      if(projectId===project.id)setProjectId(remaining[0]?.project.id??projects.find(item=>item.id!==project.id)?.id??null);
    }catch(error){notifyError(errorMessage(error));}
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
  return <div className={'app '+(agentOpen?'agent-open':'')}>
    <WindowControls onSave={()=>{if(activeFile)void workspace.save(activeFile);}}
      saveDisabled={!activeFile||!activeFile.dirty||!!(activeFile.saving||activeFile.syncing||activeFile.reason)}
      saving={!!activeFile?.saving}/>
    <Sidebar panel={panel} setPanel={setPanel} dark={dark} toggleTheme={()=>setDark(!dark)}
      showThemeSwitcher={showThemeSwitcher}
      agentOpen={agentOpen} toggleAgent={()=>setAgentOpen(open=>!open)}
      notificationCount={notifications.filter(item=>!item.read).length} notificationsOpen={notificationsOpen}
      toggleNotifications={()=>setNotificationsOpen(open=>!open)}/>
    <NotificationCenter notifications={notifications} open={notificationsOpen}
      onClose={()=>setNotificationsOpen(false)} onDismissToast={dismissToast}
      onDelete={deleteNotification} onActivate={activateNotification} onReadAll={readAllNotifications}/>
    {panel==='files'&&<FileSidebar width={sidebarWidth} projects={projects} projectsLoaded={projectsLoaded}
      openFiles={openFiles} activeFile={activeFile}
      mixed={mixed} picking={picking} collapsedProjects={collapsedProjects} expandedDirectories={expandedDirectories}
      onResize={resizeSidebar} onAddFolder={()=>void addFolder()} onSelectFile={selectFile}
      onOpenFile={(project,path)=>void openFile(project,path)} onCloseProject={project=>void closeProject(project)}
      onProjectToggle={toggleProject} onDirectoryToggle={toggleDirectory} onError={notifyError}/>}
    {panel==='review'&&<ReviewDashboard projects={projects} documents={documents} statuses={statuses}
      filter={reviewFilter} selected={reviewSelected} onFilterChange={setReviewFilter} onSelectedChange={setReviewSelected}
      revealTarget={reviewReveal}
      expandedRecords={expandedReviewRecords} onToggleReviewPreview={(file,itemId,line)=>{
        void openFile(file.project,file.path,line);toggleReviewPreview(itemId);
      }}
      width={sidebarWidth} onResize={resizeSidebar} onOpen={openFile} onAction={workspace.act}
      onBulk={workspace.bulk} onFileBulk={workspace.bulkFile}
      split={reviewSplit} onSplitChange={setReviewSplit}
      chunkWidth={reviewChunkWidth} onChunkResize={setReviewChunkWidth} fileLabels={reviewFileLabels}/>}
    {panel==='settings'&&<SettingsSidebar width={sidebarWidth} onResize={resizeSidebar}
      category={settingsCategory} onCategoryChange={setSettingsCategory}/>}
    {panel==='settings'?<SettingsPage category={settingsCategory} syncWidths={syncWidths} onChange={changeWidthSync}
      mixed={mixed} onModeChange={setMixed} hideSingleProjectTabs={hideSingleProjectTabs}
      onHideSingleProjectTabsChange={setHideSingleProjectTabs} fontSize={fontSize}
      onFontSizeChange={setFontSize} onResetEditor={()=>setFontSize(14)}
      fileTabOverflow={fileTabOverflow} onFileTabOverflowChange={setFileTabOverflow}
      reviewFileLabels={reviewFileLabels} onReviewFileLabelsChange={setReviewFileLabels}
      dark={dark} onThemeChange={setDark} showThemeSwitcher={showThemeSwitcher}
      onShowThemeSwitcherChange={setShowThemeSwitcher}/>:<>
    <main className="main">
      {projects.length>0&&<>
        {!mixed&&!(hideSingleProjectTabs&&projects.length===1)&&<div className="project-bar"><div className="project-tabs" aria-label="Project tabs">
          {projects.map(project=><button key={project.id} className={'project-tab '+(project.id===projectId?'active':'')}
            aria-pressed={project.id===projectId} onClick={()=>selectProject(project.id)}>
            <Icon name="projectFolder" size={14}/><span>{project.name}</span>
            {documents.some(file=>file.project.id===project.id&&file.dirty)&&<span className="dirty-dot"/>}
          </button>)}</div></div>}
        <TabBar files={visibleFiles} activeId={activeId} onSelect={selectFile} onClose={closeFile}
          onContextAction={tabContext}
          mixed={mixed} overflowMode={fileTabOverflow} expansion={fileTabExpansion}
          onExpansionChange={setFileTabExpansion}
          underWindowControls={mixed||(!mixed&&hideSingleProjectTabs&&projects.length===1)}/>
      </>}
      {activeFile?<>
        <div className="breadcrumb"><span>{activeFile.project.name}</span><span>/</span><span>{activeFile.path}</span></div>
        {(activeFile.reason||activeFile.diffError)&&<div className="review-warning">{activeFile.reason||activeFile.diffError}</div>}
        <div className="editor-container"><EditorArea file={activeFile} dark={dark} editorRef={editorRef}
          tick={tick} onAction={workspace.act} onReviewReveal={itemId=>{
            setPanel('review');
            setReviewFilter(current=>current==='all'||current===activeFile.project.id?current:activeFile.project.id);
            setReviewSelected(activeFile.id);
            setReviewReveal(current=>({fileId:activeFile.id,itemId,token:(current?.token??0)+1}));
          }} expandedRecords={expandedReviewRecords} onToggleReviewPreview={toggleReviewPreview}
          revealLine={reveal?.id===activeFile.id?reveal.line:undefined}
          fontSize={fontSize}/></div>
        <footer className="status-bar"><span>{activeFile.dirty?'Unsaved':'Saved'}
          {activeFile.computing?' · Updating diff…':''}</span>
          <span>{activeFile.model.getLanguageId()}<span className="status-divider">UTF-8{activeFile.synced.bom?' BOM':''}</span></span></footer>
      </>:<div className="empty-state">
        {projects.length?<span className="empty-project-hint">Select a file from the sidebar</span>
          :<button className="open-folder-button" onClick={addFolder} disabled={picking}><Icon name="openFolder" size={19}/>{picking?'Opening…':'Open Folder'}</button>}
        <div className="shortcut-hint"><kbd>Ctrl</kbd> + <kbd>S</kbd><span>Save</span><i/><kbd>Ctrl</kbd> + <kbd>F</kbd><span>Find</span></div>
      </div>}
    </main>
    </>}
    <AgentChat open={agentOpen} projects={projects} activeProjectId={projectId}
      dirtyProjectIds={new Set(documents.filter(file=>file.dirty).map(file=>file.project.id))}
      width={agentWidth} onResize={setAgentWidth}
      onResizeEnd={value=>localStorage.setItem('revu-agent-width',String(value))} notify={notify}
      navigationRequest={agentNavigation} onNotice={handleAgentNotice}/>
  </div>;
}
