import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {locateCitation,type CiteRequest,type CiteTarget} from '../shared/citations';
import { fileMenuTargets, updateFileTabs } from './editorTabs';
import { defineRevuThemes, monaco, tokenizeSnapshot, type OpenFile, type Project } from './editor';
import { api, errorMessage } from './files';
import type { Entry, Snapshot } from '../shared/types';
import { useWorkspace } from './useWorkspace';
import EditorArea from './EditorArea';
import FileSidebar from './FileSidebar';
import Icon from './Icon';
import Sidebar, { type Panel } from './Sidebar';
import TabBar, { type EditorTabItem, type TabContextAction } from './TabBar';
import ReviewDashboard from './ReviewDashboard';
import ReadonlyEditor from './ReadonlyEditor';
import SettingsPage, { SettingsSidebar, type ReviewFileLabels, type SettingsCategory } from './SettingsPage';
import WindowControls from './WindowControls';
import PanelWindowControls, {usePanelMaximized} from './PanelWindowControls';
import {usePanelWindows} from './usePanelWindows';
import type {PanelWindow} from '../shared/panelWindows';
import {useChatToolbarSettings} from './ChatToolbarSettings';
import NotificationCenter, { type AppNotification, type NotificationAction, type NotificationLevel } from './NotificationCenter';
import { defaultTabExpansion, type FileTabExpansion, type FileTabOverflow } from './tabLayout';
import AgentChat, { type AgentNavigationRequest, type AgentNotice, type ToolDetailRequest } from './AgentChat';
import {placementsFor,useCodePins} from './useCodePins';
import type {PinTarget} from '../shared/codePins';
import type {PinPlacement} from '../shared/pinLayout';
import {codeLineCount} from '../shared/codeSource';

interface ToolDocument {
  id:string;projectId:string;sessionId:string;toolCallId:string;name:string;model:monaco.editor.ITextModel;
  snapshotFile?:OpenFile;
}
type AppEditorTab=(EditorTabItem&{kind:'file';file:OpenFile})|(EditorTabItem&{kind:'tool';toolDocument:ToolDocument});

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
const savedColor=(key:string,fallback:string)=>{
  const value=localStorage.getItem(key)?.toUpperCase();
  return value&&/^#[0-9A-F]{6}$/.test(value)?value:fallback;
};

export default function App(){
  const [dark,setDark]=useState(()=>localStorage.getItem('revu-theme')==='dark');
  const [lightThemeColor,setLightThemeColor]=useState(()=>savedColor('revu-light-theme-color','#FFFFFF'));
  const [darkThemeColor,setDarkThemeColor]=useState(()=>savedColor('revu-dark-theme-color','#191919'));
  const [showThemeSwitcher,setShowThemeSwitcher]=useState(()=>localStorage.getItem('revu-show-theme-switcher')!=='false');
  const [showDockButton,setShowDockButton]=useState(()=>localStorage.getItem('revu-show-dock-button')!=='false');
  const chatToolbar=useChatToolbarSettings();
  const [panel,setPanel]=useState<Panel>('files');
  const [syncWidths,setSyncWidths]=useState(()=>localStorage.getItem('revu-sync-sidebar-widths')!=='false');
  const [widths,setWidths]=useState(()=>({
    shared:savedWidth('revu-sidebar-width',250),
    files:savedWidth('revu-file-sidebar-width',250),
    review:savedWidth('revu-review-sidebar-width',250),
    settings:savedWidth('revu-settings-sidebar-width',250),
  }));
  const [{ids:tabs,previews},dispatchTabs]=useReducer(updateFileTabs,{ids:[],previews:[]});
  const keepTab=useCallback((id:string)=>dispatchTabs({type:'keep',id}),[]);
  const [previewMode,setPreviewMode]=useState(()=>localStorage.getItem('revu-file-open-mode')==='preview');
  const treeOpens=useRef(Promise.resolve());
  const [toolDocuments,setToolDocuments]=useState<ToolDocument[]>([]);
  const [activeId,setActiveId]=useState<string|null>(null);
  const [projectId,setProjectId]=useState<string|null>(null);
  const [otherSelected,setOtherSelected]=useState(false);
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
  const [reveal,setReveal]=useState<{id:string;line:number;lastLine?:number;href?:string;pinId?:string}|null>(null);
  const [citeRequest,setCiteRequest]=useState<CiteRequest>();
  const [revealEditorSelection,setRevealEditorSelection]=useState(()=>localStorage.getItem('revu-reveal-editor-selection')==='true');
  useEffect(()=>localStorage.setItem('revu-reveal-editor-selection',String(revealEditorSelection)),[revealEditorSelection]);
  const [treeTarget,setTreeTarget]=useState<{projectId:string|null;path:string;token:number;fromEditor?:boolean}>();
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
  const onDetach=useCallback((name:PanelWindow)=>{
    if(name==='review')setPanel(current=>current==='review'?null:current);
    else setAgentOpen(true);
  },[]);
  const onDock=useCallback((name:PanelWindow)=>{
    if(name==='review')setPanel('review');else setAgentOpen(true);
  },[]);
  const {windows,isDetached,focus:focusWindow,toggle:toggleWindow,dockAll}=usePanelWindows(onDetach,onDock,notifyError);
  const chatMaximized=usePanelMaximized('chat',windows.chat);
  const reviewMaximized=usePanelMaximized('review',windows.review);
  const reviewVisible=panel==='review'||!!windows.review;
  const showChat=useCallback(()=>{
    setAgentOpen(true);
    focusWindow('chat');
  },[focusWindow]);
  const showReview=()=>{
    if(!isDetached('review'))setPanel('review');
    focusWindow('review');
  };
  const showEditor=useCallback(()=>{
    setPanel(current=>current==='settings'?null:current);
    focusWindow('main');
  },[focusWindow]);
  const cite=useCallback((request:CiteRequest)=>{setCiteRequest(request);showChat();},[showChat]);
  const notifyWarning=useCallback((message:string)=>notify('warning',message),[notify]);
  const dismissToast=useCallback((id:string)=>setNotifications(current=>current.map(item=>
    item.id===id?{...item,toast:false}:item)),[]);
  const deleteNotification=useCallback((id:string)=>setNotifications(current=>current.filter(item=>item.id!==id)),[]);
  const activateNotification=useCallback((id:string)=>{
    const notification=notifications.find(item=>item.id===id);
    setNotifications(current=>current.map(item=>item.id===id?{...item,read:true,toast:false}:item));
    const action=notification?.action;
    if(action?.type==='open-agent-session'){
      showChat();setNotificationsOpen(false);
      setAgentNavigation(current=>({projectId:action.projectId,sessionId:action.sessionId,
        runKey:action.runKey,token:(current?.token??0)+1}));
    }
  },[notifications,showChat]);
  const handleAgentNotice=useCallback((notice:AgentNotice)=>{
    if(notice.question===false){setNotifications(current=>current.map(item=>item.action?.question&&item.action.projectId===notice.projectId&&item.action.sessionId===notice.sessionId
      ?{...item,read:true,toast:false,message:item.message.replace(/^Question ·/,'Question resolved ·'),action:{...item.action,question:false}}:item));return;}
    if(notice.question){
      setNotifications(current=>{
        const existing=current.find(item=>item.action?.question&&item.action.projectId===notice.projectId&&item.action.sessionId===notice.sessionId);
        if(existing)return current.map(item=>item.id===existing.id?{...item,message:notice.message}:item);
        return [{id:crypto.randomUUID(),level:'info',message:notice.message,createdAt:Date.now(),read:false,toast:true,count:1,action:{type:'open-agent-session',projectId:notice.projectId,sessionId:notice.sessionId,question:true}},...current];
      });return;
    }
    notify(notice.level,notice.message,{type:'open-agent-session',projectId:notice.projectId,sessionId:notice.sessionId,runKey:notice.runKey});
  },[notify]);
  const readAllNotifications=useCallback(()=>setNotifications(current=>current.map(item=>
    item.read?item:{...item,read:true})),[]);
  const clearNotifications=useCallback(()=>setNotifications([]),[]);
  const workspace=useWorkspace(notifyError,notifyWarning,keepTab);
  const {projects,projectsLoaded,documents,statuses,tick}=workspace;
  const snapshots=useMemo(()=>toolDocuments.flatMap(document=>document.snapshotFile?[document.snapshotFile]:[]),[toolDocuments]);
  const pins=useCodePins(documents,snapshots,tick);
  const codeRequest=useRef(0);
  const lastCodeReview=useRef<typeof reveal>(null);
  const loadPinFile=useRef(workspace.load);loadPinFile.current=workspace.load;
  const editorRef=useRef<monaco.editor.IStandaloneCodeEditor|null>(null);
  const lastFile=useRef(new Map<string,string>());
  const lastToolDocument=useRef<string|null>(null);
  const seenNotices=useRef(new Map<string,string>());
  const openFiles=tabs.map(id=>documents.find(file=>file.id===id)).filter((f):f is OpenFile=>!!f);
  const activeFile=openFiles.find(file=>file.id===activeId);
  const activeToolDocument=toolDocuments.find(document=>document.id===activeId);
  const activeReviewFile=activeFile??activeToolDocument?.snapshotFile;
  const focusReviewChunk=useCallback((file:OpenFile,itemId:string)=>{
    setReviewFilter(current=>current==='all'||current===file.project.id?current:file.project.id);
    setReviewSelected(file.id);
    setReviewReveal(current=>({fileId:file.id,itemId,token:(current?.token??0)+1}));
  },[]);
  useEffect(()=>{
    if(!reviewVisible)return;
    for(const {projectId,path} of pins.requiredFiles){
      const project=projects.find(item=>item.id===projectId);
      if(project)void loadPinFile.current(project,path).catch(()=>{});
    }
  },[reviewVisible,projects,pins.requiredFiles]);
  useEffect(()=>{
    if(!reviewVisible||!reveal||!activeReviewFile||activeReviewFile.id!==reveal.id||lastCodeReview.current===reveal)return;
    const placements=pins.byFile.get(reveal.id);
    const placement=reveal.pinId?placements?.find(pin=>pin.id===reveal.pinId)
      :reveal.href?placements?.find(pin=>pin.reference.href===reveal.href):undefined;
    if(!placement)return;
    lastCodeReview.current=reveal;focusReviewChunk(activeReviewFile,placement.chunkId??placement.id);
  },[reviewVisible,reveal,activeReviewFile,pins.byFile,focusReviewChunk]);
  const fileEditorTabs:AppEditorTab[]=openFiles.map(file=>({kind:'file',file,id:file.id,name:file.name,
    title:file.project.name+'/'+file.path,projectName:file.project.name,groupId:file.project.id,dirty:file.dirty,preview:previews.includes(file.id)}));
  const toolEditorTabs:AppEditorTab[]=toolDocuments.map(toolDocument=>({kind:'tool',toolDocument,id:toolDocument.id,name:toolDocument.name,
    title:'Other/'+toolDocument.name,projectName:'Other',groupId:null,dirty:false}));
  const editorTabs:AppEditorTab[]=[...fileEditorTabs,...toolEditorTabs];
  const visibleEditorTabs=mixed?editorTabs:otherSelected?toolEditorTabs:fileEditorTabs.filter(tab=>tab.kind==='file'&&tab.file.project.id===projectId);
  const tabScope=mixed?'mixed':otherSelected?'other':projectId;
  useEffect(()=>{
    if(!projectId&&projects.length)setProjectId(projects[0].id);
  },[projects,projectId]);
  useEffect(()=>{
    const documentIds=new Set(documents.map(file=>file.id));const toolIds=new Set(toolDocuments.map(document=>document.id));
    if(tabs.every(id=>documentIds.has(id)))return;
    const activeIndex=activeId?tabs.indexOf(activeId):-1;
    const remaining=tabs.filter(id=>documentIds.has(id));
    dispatchTabs({type:'remove',ids:new Set(tabs.filter(id=>!documentIds.has(id)))});
    if(activeId&&!documentIds.has(activeId)&&!toolIds.has(activeId)){
      const nextId=remaining[Math.min(Math.max(activeIndex,0),remaining.length-1)]??null;
      const next=documents.find(file=>file.id===nextId);
      setActiveId(nextId);setProjectId(next?.project.id??null);setReveal(null);
    }
  },[documents,toolDocuments,tabs,activeId]);
  useEffect(()=>{
    if(mixed)return;
    setOtherSelected(!!activeToolDocument);
  },[mixed,activeToolDocument]);
  useEffect(()=>{
    document.documentElement.dataset.theme=dark?'dark':'light';
    document.documentElement.style.setProperty('--theme-bg',dark?darkThemeColor:lightThemeColor);
    defineRevuThemes(lightThemeColor,darkThemeColor);monaco.editor.setTheme(dark?'revu-dark':'revu-light');
    localStorage.setItem('revu-theme',dark?'dark':'light');
    localStorage.setItem('revu-light-theme-color',lightThemeColor);
    localStorage.setItem('revu-dark-theme-color',darkThemeColor);
  },[dark,lightThemeColor,darkThemeColor]);
  useEffect(()=>localStorage.setItem('revu-show-theme-switcher',String(showThemeSwitcher)),[showThemeSwitcher]);
  useEffect(()=>localStorage.setItem('revu-show-dock-button',String(showDockButton)),[showDockButton]);
  useEffect(()=>{
    localStorage.setItem('revu-sync-sidebar-widths',String(syncWidths));
    localStorage.setItem('revu-sidebar-width',String(widths.shared));
    localStorage.setItem('revu-file-sidebar-width',String(widths.files));
    localStorage.setItem('revu-review-sidebar-width',String(widths.review));
    localStorage.setItem('revu-settings-sidebar-width',String(widths.settings));
  },[syncWidths,widths]);
  useEffect(()=>localStorage.setItem('revu-editor-tab-mode',mixed?'mixed':'isolated'),[mixed]);
  useEffect(()=>localStorage.setItem('revu-file-open-mode',previewMode?'preview':'keep'),[previewMode]);
  useEffect(()=>{if(activeId)dispatchTabs({type:'activate',id:activeId});},[activeId]);
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
    lastFile.current.set(file.project.id,file.id);setOtherSelected(false);setProjectId(file.project.id);setActiveId(file.id);setReveal(null);
  }
  function selectProject(id:string){
    setOtherSelected(false);setProjectId(id);
    const remembered=lastFile.current.get(id);
    const file=openFiles.find(file=>file.id===remembered)??openFiles.find(file=>file.project.id===id);
    setActiveId(file?.id??null);setReveal(null);
  }
  function selectToolDocument(document:ToolDocument){
    lastToolDocument.current=document.id;setOtherSelected(!mixed);setActiveId(document.id);setReveal(null);
  }
  function selectOther(){
    const document=toolDocuments.find(item=>item.id===lastToolDocument.current)??toolDocuments[0];
    if(document)selectToolDocument(document);
  }
  function selectEditorTab(tab:EditorTabItem,fromEditor=false){
    const item=editorTabs.find(candidate=>candidate.id===tab.id);if(!item)return;
    if(item.kind==='file')selectFile(item.file);else selectToolDocument(item.toolDocument);
    if(fromEditor)revealEditorTarget(item.kind==='file'?item.file.project:undefined,item.kind==='file'?item.file.path:'');
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
  async function expandAllSubfolders(project:Project,path=''){
    const keys:string[]=path?[project.root+'\n'+path]:[];
    try{
      const entries=await api<Entry[]>('list',{projectId:project.id,path});
      for(const entry of entries){
        if(entry.kind!=='directory')continue;
        const child=path?path+'/'+entry.name:entry.name;
        keys.push(project.root+'\n'+child);
      }
      if(!path)setCollapsedProjects(current=>{const next=new Set(current);next.delete(project.root);return next;});
      setExpandedDirectories(current=>new Set([...current,...keys]));
    }catch(error){notifyError(errorMessage(error));}
  }
  function collapseAllSubfolders(project:Project,path=''){
    const key=project.root+'\n'+path;
    if(!path)setCollapsedProjects(current=>new Set([...current,project.root]));
    setExpandedDirectories(current=>new Set([...current].filter(candidate=>{
      if(candidate===key)return false;
      const childPrefix=key+(path?'/':'');
      if(!candidate.startsWith(childPrefix))return true;
      return candidate.slice(childPrefix.length).includes('/');
    })));
  }
  function toggleReviewPreview(id:string){
    setExpandedReviewRecords(current=>{
      const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next;
    });
  }
  async function addFolder(root?:string){
    if(picking)return;setPicking(true);
    try{
      const project=await workspace.addProject(root);if(!project)return;
      if(root||!mixed||!activeFile)selectProject(project.id);
      setPanel('files');
    }catch(error){notifyError(errorMessage(error));}finally{setPicking(false);}
  }
  const openToolDetail=useCallback((detail:ToolDetailRequest)=>{
    showEditor();
    setToolDocuments(current=>{
      const existing=current.find(document=>document.id===detail.id);
      if(existing){if(existing.model.getValue()!==detail.content)existing.model.setValue(detail.content);return current;}
      const uri=monaco.Uri.parse(`revu-tool-detail:///${encodeURIComponent(detail.sessionId)}/${encodeURIComponent(detail.toolCallId)}.json`);
      const model=monaco.editor.getModel(uri)??monaco.editor.createModel(detail.content,'json',uri);
      if(model.getValue()!==detail.content)model.setValue(detail.content);
      return [...current,{id:detail.id,projectId:detail.projectId,sessionId:detail.sessionId,
        toolCallId:detail.toolCallId,name:detail.fileName,model}];
    });
    lastToolDocument.current=detail.id;setActiveId(detail.id);setOtherSelected(!mixed);setReveal(null);
  },[mixed,showEditor]);
  const updateToolDetail=useCallback((detail:ToolDetailRequest)=>{
    setToolDocuments(current=>{
      const existing=current.find(document=>document.id===detail.id);if(!existing)return current;
      if(existing.model.getValue()!==detail.content)existing.model.setValue(detail.content);
      return current;
    });
  },[]);
  function showFile(file:OpenFile,mode:'select'|'keep'|'preview'='select'){
    dispatchTabs({type:'open',id:file.id,projectId:file.project.id,mixed,mode:file.dirty?'keep':mode});
    selectFile(file);
  }
  async function openFile(project:Project,path:string,line?:number,mode:'select'|'keep'|'preview'='select'){
    try{
      const file=await workspace.load(project,path);
      if(file.model.isDisposed())return;
      showFile(file,mode);if(line)setReveal({id:file.id,line});
    }catch(error){notifyError(errorMessage(error));}
  }
  function revealListedPin(file:OpenFile,pin:PinPlacement){
    showEditor();
    const snapshot=toolDocuments.find(document=>document.id===file.id&&document.snapshotFile);
    if(snapshot)selectToolDocument(snapshot);
    else{
      showFile(file);
    }
    setReveal({id:file.id,line:pin.line,pinId:pin.id});
  }
  function revealEditorTarget(project?:Project,path=''){
    if(!revealEditorSelection||panel!=='files')return;
    if(project&&path)expandTreePath(project,path);
    setTreeTarget({projectId:project?.id??null,path,token:performance.now(),fromEditor:true});
  }
  function expandTreePath(project:Project,path:string,directory=false){
    toggleProject(project.root,true);
    const parts=path.split('/').filter(Boolean);
    const folders=directory?parts:parts.slice(0,-1);
    if(folders.length)setExpandedDirectories(current=>{
      const next=new Set(current);
      for(let i=1;i<=folders.length;i++)next.add(project.root+'\n'+folders.slice(0,i).join('/'));
      return next;
    });
  }
  async function gotoReference(projectId:string,target:CiteTarget){
    const chat=projects.find(item=>item.id===projectId);if(!chat)return;
    const located=locateCitation(target.path,chat,projects),project=located.project;
    try{
      if(!project){await api('revealExternalCitation',{projectId,path:located.path,directory:!!target.directory});return;}
      focusWindow('main');
      const path=located.path.replace(/\/$/,'').replace(/^\.$/,'');
      await api('checkCitation',{projectId:project.id,path,directory:!!target.directory});
      setPanel('files');expandTreePath(project,path,target.directory);
      setTreeTarget({projectId:project.id,path,token:performance.now()});
      if(target.directory){selectProject(project.id);return;}
      const file=await workspace.load(project,path);if(file.model.isDisposed())return;showFile(file,'preview');if(target.line)setReveal({id:file.id,line:target.line,lastLine:target.lastLine??target.line});
    }catch(error){notifyError(errorMessage(error));}
  }
  async function openCode(target:PinTarget){
    const request=++codeRequest.current;
    const {source,reference}=target;
    const project=projects.find(item=>item.id===source.projectId);if(!project)return;
    const {path,hash,revision,startLine,href}=reference;
    const encoding=reference.encoding??'utf-8';
    try{
      const file=encoding==='utf-8'?await workspace.load(project,path).catch(()=>undefined):undefined;
      const placement=file?placementsFor(file,target):undefined;
      if(file&&placement!==undefined&&(placement.length||file.computing)){
        if(request!==codeRequest.current||!pins.selectReference(target))return;
        showEditor();
        if(!isDetached('review'))setPanel('review');
        showFile(file);
        setReveal({id:file.id,line:startLine,href});return;
      }
      const id=JSON.stringify(['code-snapshot',project.id,path,hash,encoding]);
      let document=toolDocuments.find(item=>item.id===id);
      const snapshot=document?.snapshotFile?.synced??await api<Snapshot>('codeSnapshot',{projectId:project.id,path,hash,revision,encoding});
      if(request!==codeRequest.current)return;
      if(reference.endLine>codeLineCount(snapshot.text)){
        notifyWarning(`Code reference is outside the source file: ${path}:${startLine}–${reference.endLine}.`);
        return;
      }
      if(!pins.selectReference(target))return;
      if(!document){
        const name=path.split('/').at(-1)!;
        const model=monaco.editor.createModel(snapshot.text,undefined,monaco.Uri.from({scheme:'revu-code-snapshot',path:`/${project.id}/${hash}/${encoding}/${path}`}));
        const snapshotFile:OpenFile={
          id,project,path,name,model,synced:snapshot,draftExists:true,baseline:'',baselineExists:false,dirty:false,version:1,
          reviewText:snapshot.text,chunks:[],records:[],computing:false,syncing:false,saving:false,diffError:'',notice:'',subscription:{dispose(){}},
        };
        const label=`${name} · ${revision?.slice(0,7)??'Snapshot'}${encoding==='gb18030'?' · GB18030':''}`;
        document={id,projectId:project.id,sessionId:source.sessionId,toolCallId:'',name:label,model,snapshotFile};
        const opened=document;setToolDocuments(current=>[...current,opened]);
      }
      showEditor();if(!isDetached('review'))setPanel('review');
      selectToolDocument(document);setReveal({id,line:startLine,href});
    }catch{if(request===codeRequest.current)notifyWarning(`Code reference expired: ${path}:${startLine}. The original version is unavailable.`);}
  }
  const openPinSource=({source}:PinTarget)=>{
    showChat();
    setAgentNavigation(current=>({projectId:source.projectId,sessionId:source.sessionId,messageId:source.messageId,token:(current?.token??0)+1}));
  };
  function closeEditorTabs(targets:AppEditorTab[]){
    if(!targets.length)return;
    const fileTargets=targets.flatMap(target=>target.kind==='file'?[target.file]:[]);
    if(fileTargets.some(file=>file.saving||file.syncing))return;
    const dirty=fileTargets.filter(file=>file.dirty);
    if(dirty.length&&!window.confirm(`${dirty.length} tab${dirty.length===1?' has':'s have'} unsaved changes. Discard the draft${dirty.length===1?'':'s'} and close?`))return;
    const closing=new Set(targets.map(file=>file.id));
    for(const file of dirty){
      file.records=[];file.chunks=[];file.draftExists=file.synced.exists;
      file.model.setValue(file.synced.text);file.dirty=false;
    }
    const remainingFiles=openFiles.filter(file=>!closing.has(file.id));
    for(const file of fileTargets){
      if(lastFile.current.get(file.project.id)!==file.id)continue;
      const sibling=remainingFiles.find(item=>item.project.id===file.project.id);
      if(sibling)lastFile.current.set(file.project.id,sibling.id);else lastFile.current.delete(file.project.id);
    }
    if(activeId&&closing.has(activeId)){
      const candidates=visibleEditorTabs.filter(tab=>!closing.has(tab.id));
      const index=Math.max(0,visibleEditorTabs.findIndex(tab=>tab.id===activeId));
      const next=candidates[Math.min(index,candidates.length-1)];
      if(next)selectEditorTab(next);
      else if(!mixed&&otherSelected){
        const fallback=remainingFiles.find(file=>file.project.id===projectId)??remainingFiles[0];
        if(fallback)selectFile(fallback);else{setOtherSelected(false);setActiveId(null);}
      }else setActiveId(null);
    }
    dispatchTabs({type:'remove',ids:closing});
    const closedTools=toolDocuments.filter(document=>closing.has(document.id));
    setToolDocuments(current=>current.filter(document=>!closing.has(document.id)));
    for(const document of closedTools)document.model.dispose();
    if(lastToolDocument.current&&closing.has(lastToolDocument.current))lastToolDocument.current=null;
  }
  const closeEditorTab=(tab:EditorTabItem)=>{
    const item=editorTabs.find(candidate=>candidate.id===tab.id);if(item)closeEditorTabs([item]);
  };
  const tabContext=(tab:EditorTabItem,action:TabContextAction)=>{
    const item=editorTabs.find(candidate=>candidate.id===tab.id);if(!item)return;
    closeEditorTabs(fileMenuTargets(editorTabs,item,action,mixed));
  };
  async function projectMenu(event:React.MouseEvent,project?:Project){
    event.preventDefault();
    const action=await api<string|null>('tabMenu',{scope:project?'project':'other'});
    if(action==='folder'&&project)void closeProject(project);
    if(action==='close')closeEditorTabs(editorTabs.filter(tab=>tab.groupId===(project?.id??null)));
    if(action==='closeAll')closeEditorTabs(editorTabs);
  }
  async function closeProject(project:Project){
    const affected=documents.filter(file=>file.project.id===project.id);
    const affectedTools=toolDocuments.filter(document=>document.projectId===project.id);
    if(affected.some(file=>file.saving||file.syncing)){notify('warning','Wait for active file operations before closing the folder.');return;}
    const dirty=affected.filter(file=>file.dirty);
    if(dirty.length&&!window.confirm(`${project.name} has ${dirty.length} unsaved file${dirty.length===1?'':'s'}. Discard the drafts and close the folder?`))return;
    const remaining=openFiles.filter(file=>file.project.id!==project.id);
    const remainingTools=toolDocuments.filter(document=>document.projectId!==project.id);
    try{
      await workspace.removeProject(project);
      dispatchTabs({type:'remove',ids:new Set(affected.map(file=>file.id))});lastFile.current.delete(project.id);
      setToolDocuments(current=>current.filter(document=>document.projectId!==project.id));
      for(const document of affectedTools)document.model.dispose();
      if(activeFile?.project.id===project.id||activeToolDocument?.projectId===project.id){
        const next=remaining[0];if(next)selectFile(next);else if(remainingTools[0])selectToolDocument(remainingTools[0]);else setActiveId(null);
      }
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
  const showProjectBar=!mixed&&(!hideSingleProjectTabs||projects.length>1||toolDocuments.length>0);
  return <div className={'app '+(agentOpen&&!windows.chat?'agent-open':'')}>
    <WindowControls onSave={()=>{if(activeFile)void workspace.save(activeFile);}}
      saveDisabled={!activeFile||!activeFile.dirty||!!(activeFile.saving||activeFile.syncing||activeFile.reason)}
      saving={!!activeFile?.saving}/>
    {windows.review&&<PanelWindowControls panel="review" maximized={reviewMaximized} targetWindow={windows.review}/>}
    {windows.chat&&<PanelWindowControls panel="chat" maximized={chatMaximized} targetWindow={windows.chat}/>}
    <Sidebar panel={panel} setPanel={setPanel} dark={dark} toggleTheme={()=>setDark(!dark)}
      showThemeSwitcher={showThemeSwitcher}
      showDock={showDockButton&&!!(windows.review||windows.chat)} onDockAll={dockAll}
      reviewDetached={!!windows.review} chatDetached={!!windows.chat}
      onFocusReview={()=>focusWindow('review')} onFocusChat={()=>focusWindow('chat')}
      agentOpen={agentOpen} toggleAgent={()=>setAgentOpen(open=>!open)}
      notificationCount={notifications.filter(item=>!item.read).length} notificationsOpen={notificationsOpen}
      toggleNotifications={()=>setNotificationsOpen(open=>!open)}/>
    <NotificationCenter notifications={notifications} open={notificationsOpen}
      onClose={()=>setNotificationsOpen(false)} onDismissToast={dismissToast}
      onDelete={deleteNotification} onActivate={activateNotification} onReadAll={readAllNotifications} onClear={clearNotifications}/>
    {panel==='files'&&<FileSidebar width={sidebarWidth} projects={projects} projectsLoaded={projectsLoaded}
      tabs={editorTabs} activeFile={activeFile} activeId={activeId} onCite={cite} target={treeTarget}
      mixed={mixed} picking={picking} collapsedProjects={collapsedProjects} expandedDirectories={expandedDirectories}
      onResize={resizeSidebar} onAddFolder={addFolder} onSelectTab={selectEditorTab} onKeep={keepTab}
      onOpenFile={(project,path,keep)=>{
        const mode=keep?'keep':previewMode?'preview':'select';
        treeOpens.current=treeOpens.current.then(()=>openFile(project,path,undefined,mode));
      }} onCloseProject={project=>void closeProject(project)}
      onExpandAllSubfolders={(project,path)=>void expandAllSubfolders(project,path)} onCollapseAllSubfolders={collapseAllSubfolders}
      onProjectToggle={toggleProject} onDirectoryToggle={toggleDirectory} onError={notifyError}/>}
    {reviewVisible&&<ReviewDashboard projects={projects} documents={documents} snapshots={snapshots} statuses={statuses}
      detachedWindow={windows.review} onToggleWindow={()=>toggleWindow('review')}
      filter={reviewFilter} selected={reviewSelected} onFilterChange={setReviewFilter} onSelectedChange={setReviewSelected}
      revealTarget={reviewReveal}
      expandedRecords={expandedReviewRecords} onToggleReviewPreview={(file,itemId,line)=>{
        void openFile(file.project,file.path,line);toggleReviewPreview(itemId);
      }}
      width={sidebarWidth} onResize={resizeSidebar} onOpen={openFile} onAction={workspace.act}
      onGoto={(project,path,line)=>{showEditor();void openFile(project,path,line);}}
      onOpenSnapshot={fileId=>{const document=toolDocuments.find(item=>item.id===fileId);if(document)selectToolDocument(document);}}
      onBulk={workspace.bulk} onFileBulk={workspace.bulkFile}
      pinsByFile={pins.byFile} keptIds={pins.keptIds} onPinAction={pins.updatePiece} onPinSource={openPinSource} onRevealPin={revealListedPin}
      split={reviewSplit} onSplitChange={setReviewSplit}
      chunkWidth={reviewChunkWidth} onChunkResize={setReviewChunkWidth} fileLabels={reviewFileLabels}/>}
    {panel==='settings'&&<SettingsSidebar width={sidebarWidth} onResize={resizeSidebar}
      category={settingsCategory} onCategoryChange={setSettingsCategory}/>}
    {panel==='settings'?<SettingsPage revealEditorSelection={revealEditorSelection} onRevealEditorSelectionChange={setRevealEditorSelection} chatToolbar={chatToolbar} category={settingsCategory} syncWidths={syncWidths} onChange={changeWidthSync}
      mixed={mixed} onModeChange={setMixed} hideSingleProjectTabs={hideSingleProjectTabs}
      onHideSingleProjectTabsChange={setHideSingleProjectTabs} fontSize={fontSize}
      previewMode={previewMode} onPreviewModeChange={setPreviewMode}
      onFontSizeChange={setFontSize} onResetEditor={()=>{
        setMixed(false);setHideSingleProjectTabs(false);setFileTabOverflow('scroll');setPreviewMode(false);setFontSize(14);
      }}
      fileTabOverflow={fileTabOverflow} onFileTabOverflowChange={setFileTabOverflow}
      reviewFileLabels={reviewFileLabels} onReviewFileLabelsChange={setReviewFileLabels}
      dark={dark} onThemeChange={setDark} showThemeSwitcher={showThemeSwitcher}
      showDockButton={showDockButton} onShowDockButtonChange={setShowDockButton}
      lightThemeColor={lightThemeColor} darkThemeColor={darkThemeColor}
      onLightThemeColorChange={setLightThemeColor} onDarkThemeColorChange={setDarkThemeColor}
      onResetThemeColors={()=>{setLightThemeColor('#FFFFFF');setDarkThemeColor('#191919');}}
      onShowThemeSwitcherChange={setShowThemeSwitcher}/>:<>
    <main className="main">
      {(projects.length>0||toolDocuments.length>0)&&<>
        {showProjectBar&&<div className="project-bar"><div className="project-tabs" aria-label="Project tabs">
          {projects.map(project=><button key={project.id} className={'project-tab '+(!otherSelected&&project.id===projectId?'active':'')}
            aria-pressed={!otherSelected&&project.id===projectId} onClick={()=>{selectProject(project.id);revealEditorTarget(project);}} onContextMenu={event=>void projectMenu(event,project)}>
            <Icon name="projectFolder" size={14}/><span>{project.name}</span>
            {documents.some(file=>file.project.id===project.id&&file.dirty)&&<span className="dirty-dot"/>}
          </button>)}
          {!!toolDocuments.length&&<button className={'project-tab '+(otherSelected?'active':'')} aria-pressed={otherSelected} onClick={()=>{selectOther();revealEditorTarget();}} onContextMenu={event=>void projectMenu(event)}>
            <Icon name="projectFolder" size={14}/><span>Other</span>
          </button>}
        </div></div>}
        <TabBar tabs={visibleEditorTabs} activeId={activeId} onSelect={tab=>selectEditorTab(tab,true)} onClose={closeEditorTab}
          onContextAction={tabContext} onKeep={keepTab}
          mixed={mixed} overflowMode={fileTabOverflow} expansion={fileTabExpansion}
          onExpansionChange={setFileTabExpansion}
          underWindowControls={!showProjectBar}/>
      </>}
      {activeFile?<>
        <div className="breadcrumb"><span>{activeFile.project.name}</span><span>/</span><span>{activeFile.path}</span></div>
        {(activeFile.reason||activeFile.diffError)&&<div className="review-warning">{activeFile.reason||activeFile.diffError}</div>}
        <div className="editor-container"><EditorArea file={activeFile} dark={dark} editorRef={editorRef} onCite={cite}
          tick={tick} onAction={workspace.act} onReviewReveal={itemId=>{
            showReview();
            focusReviewChunk(activeFile,itemId);
          }} expandedRecords={expandedReviewRecords} onToggleReviewPreview={toggleReviewPreview}
          reveal={reveal?.id===activeFile.id?reveal:undefined} pins={pins.byFile.get(activeFile.id)} keptIds={pins.keptIds}
          onPinAction={pins.updatePiece} onPinSource={openPinSource}
          fontSize={fontSize}/></div>
        <footer className="status-bar"><span>{activeFile.dirty?'Unsaved':'Saved'}
          {activeFile.computing?' · Updating diff…':''}</span>
          <span>{activeFile.model.getLanguageId()}<span className="status-divider">UTF-8{activeFile.synced.bom?' BOM':''}</span></span></footer>
      </>:activeToolDocument?<>
        <div className="breadcrumb"><span>{activeToolDocument.snapshotFile?.project.name??'Other'}</span><span>/</span><span>{activeToolDocument.snapshotFile?.path??activeToolDocument.name}</span></div>
        <div className="editor-container">{activeToolDocument.snapshotFile
          ?<EditorArea file={activeToolDocument.snapshotFile} dark={dark} editorRef={editorRef} fontSize={fontSize} tick={tick}
            onAction={workspace.act} onReviewReveal={itemId=>{
              if(activeToolDocument.snapshotFile){showReview();focusReviewChunk(activeToolDocument.snapshotFile,itemId);}
            }} expandedRecords={expandedReviewRecords} onToggleReviewPreview={toggleReviewPreview}
            readOnly reveal={reveal?.id===activeToolDocument.id?reveal:undefined} pins={pins.byFile.get(activeToolDocument.id)} keptIds={pins.keptIds}
            onPinAction={pins.updatePiece} onPinSource={openPinSource}/>
          :<ReadonlyEditor model={activeToolDocument.model} dark={dark} editorRef={editorRef} fontSize={fontSize}/>}</div>
        <footer className="status-bar"><span>Read-only</span><span>{activeToolDocument.snapshotFile?.model.getLanguageId()??'JSON'}<span className="status-divider">{(activeToolDocument.snapshotFile?.synced.encoding??'utf-8').toUpperCase()}</span></span></footer>
      </>:<div className="empty-state">
        {projects.length?<span className="empty-project-hint">Select a file from the sidebar</span>
          :<button className="open-folder-button" onClick={()=>void addFolder()} disabled={picking}><Icon name="openFolder" size={19}/>{picking?'Opening…':'Open Folder'}</button>}
        <div className="shortcut-hint"><kbd>Ctrl</kbd> + <kbd>S</kbd><span>Save</span><i/><kbd>Ctrl</kbd> + <kbd>F</kbd><span>Find</span></div>
      </div>}
    </main>
    </>}
    <AgentChat maximized={chatMaximized} detachedWindow={windows.chat} onToggleWindow={()=>toggleWindow('chat')}
      hiddenToolbarButtons={chatToolbar.hidden} citeRequest={citeRequest} onGoto={gotoReference} tokenizeSnapshot={tokenizeSnapshot}
      onOpenSettings={()=>{setSettingsCategory('chat');setPanel('settings');focusWindow('main');}} open={agentOpen} projects={projects} activeProjectId={projectId}
      dirtyProjectIds={new Set(documents.filter(file=>file.dirty).map(file=>file.project.id))}
      width={agentWidth} onResize={setAgentWidth}
      onResizeEnd={value=>localStorage.setItem('revu-agent-width',String(value))} notify={notify}
      navigationRequest={agentNavigation} onNotice={handleAgentNotice}
      onProjectAdded={workspace.adoptProject}
      onPinSession={pins.selectSession} onShowPins={pins.selectSource} onOpenCode={target=>void openCode(target)} visiblePinSource={pins.visiblePinSource}
      onOpenToolDetail={openToolDetail} onUpdateToolDetail={updateToolDetail}/>
  </div>;
}
