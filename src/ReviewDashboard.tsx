import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeFile, Chunk, ProjectStatus, ReviewBulkAction } from '../shared/types';
import DiffPreview from './DiffPreview';
import {api,errorMessage} from './files';
import type { OpenFile, Project } from './editor';
import { reviewItems, ReviewActions, PinActions, type ActionHandler, type PinActionHandler } from './ReviewActions';
import type {PinPlacement} from '../shared/pinLayout';
import ResizeHandle from './ResizeHandle';
import ScrollbarScope from './ScrollbarScope';
import ProjectDropdown from './ProjectDropdown';
import Icon from './Icon';
import type { ReviewFileLabels } from './SettingsPage';
import { PanelPortal } from './PanelPortal';

interface ReviewFileRow {id:string;project:Project;status?:ChangeFile;file?:OpenFile;path:string;snapshot?:boolean}
const MIN_DETAIL_HEIGHT=120;
function MixedPreview({projectId,path,previewKey}:{projectId:string;path:string;previewKey:string}){
  const [result,setResult]=useState<Chunk[]|string|null>(null);
  useEffect(()=>{
    let active=true;
    api<Chunk[]>('mixedPreview',{projectId,path,key:previewKey}).then(chunks=>{if(active)setResult(chunks);},
      error=>{if(active)setResult(errorMessage(error));});
    return ()=>{active=false;};
  },[projectId,path,previewKey]);
  if(typeof result==='string')return <p className="review-warning">{result}</p>;
  if(!result?.length)return <p className="tree-note">{result?'No text changes after normalizing line endings.':'Loading diff…'}</p>;
  return <>{result.map(chunk=><div key={chunk.id} className="dashboard-chunk"><strong>Line {chunk.line}</strong>
    <DiffPreview oldText={chunk.oldText} newText={chunk.newText}/></div>)}</>;
}
const MIN_CHANGES_HEIGHT=160;
const REVIEW_HEADER_HEIGHT=54;
const REVIEW_RESIZE_HEIGHT=6;
const firstPreviewLine=(text:string)=>text.split(/\r?\n/).find(line=>line.trim().length>0)??'';
const displayPath=(path:string,labels:ReviewFileLabels)=>labels==='name'?path.split(/[\\/]/).pop()??path:path;
export function dashboardChunks(file:Pick<OpenFile,'chunks'|'records'>,pins:readonly PinPlacement[]){
  const notes=new Map<string,Set<string>>();
  const standalone:PinPlacement[]=[];
  for(const pin of pins){
    if(pin.chunkId===undefined)standalone.push(pin);
    else if(pin.reference.note){
      const existing=notes.get(pin.chunkId)??new Set<string>();
      existing.add(pin.reference.note);notes.set(pin.chunkId,existing);
    }
  }
  const items=[...reviewItems(file),...standalone].sort((first,second)=>first.line-second.line);
  return {items,notes};
}

const savedChangesHeight=()=>{
  const value=Number(localStorage.getItem('revu-review-changes-height'));
  return Number.isFinite(value)&&value>=MIN_CHANGES_HEIGHT?value:null;
};

function fitReviewBranch(slot:HTMLSpanElement|null){
  const label=slot?.firstElementChild;
  if(!slot||!label)return;
  const update=()=>slot.toggleAttribute('data-clipped',label.getBoundingClientRect().width>slot.getBoundingClientRect().width);
  update();
  const observer=new ResizeObserver(update);
  observer.observe(slot);
  observer.observe(label);
  return ()=>observer.disconnect();
}

function alignReviewActions(list:HTMLDivElement|null){
  if(!list)return;
  const section=list.closest<HTMLElement>('.review-changes');
  if(!section)return;
  const align=()=>section.style.setProperty('--review-scrollbar-width',(list.offsetWidth-list.clientWidth)+'px');
  align();
  const observer=new ResizeObserver(align);
  observer.observe(list);
  return ()=>observer.disconnect();
}

export default function ReviewDashboard({projects,documents,snapshots,statuses,filter,selected,revealTarget,expandedRecords,onToggleReviewPreview,width,onResize,onOpen,onGoto=onOpen,onOpenSnapshot,onAction,onBulk,onFileBulk,onFilterChange,onSelectedChange,split,onSplitChange,chunkWidth,onChunkResize,fileLabels,pinsByFile,keptIds,onPinAction,onPinSource,onRevealPin,detachedWindow,onToggleWindow}:{
  projects:Project[];documents:OpenFile[];statuses:Record<string,ProjectStatus>;
  snapshots:OpenFile[];
  filter:string;selected:string;
  revealTarget:{fileId:string;itemId:string;token:number}|null;
  expandedRecords:ReadonlySet<string>;onToggleReviewPreview:(file:OpenFile,itemId:string,line:number)=>void;
  width:number;onResize:(width:number)=>void;onOpen:(project:Project,path:string,line?:number)=>void;
  onGoto?:(project:Project,path:string,line?:number)=>void;detachedWindow?:Window|null;onToggleWindow?:()=>void;
  onOpenSnapshot:(fileId:string)=>void;
  onAction:ActionHandler;onBulk:(projectIds:string[],action:ReviewBulkAction)=>void;
  onFileBulk:(file:OpenFile,action:ReviewBulkAction)=>void;
  onFilterChange:(filter:string)=>void;onSelectedChange:(selected:string)=>void;
  split:boolean;onSplitChange:(split:boolean)=>void;chunkWidth:number;onChunkResize:(width:number)=>void;
  fileLabels:ReviewFileLabels;
  pinsByFile:ReadonlyMap<string,PinPlacement[]>;keptIds:ReadonlySet<string>;
  onPinAction:PinActionHandler;onPinSource:(pin:PinPlacement)=>void;onRevealPin:(file:OpenFile,pin:PinPlacement)=>void;
}){
  const [changesHeight,setChangesHeight]=useState<number|null>(savedChangesHeight);
  const [detachedListWidth,setDetachedListWidth]=useState<number>();
  const dashboardRef=useRef<HTMLElement|null>(null);
  const changesRef=useRef<HTMLElement|null>(null);
  const chunkRefs=useRef(new Map<string,HTMLDivElement>());
  const dragRef=useRef<{y:number;height:number}|null>(null);
  const clampChangesHeight=(height:number)=>{
    const available=(dashboardRef.current?.clientHeight??window.innerHeight)-REVIEW_HEADER_HEIGHT-REVIEW_RESIZE_HEIGHT;
    const maximum=Math.max(MIN_CHANGES_HEIGHT,available-MIN_DETAIL_HEIGHT);
    return Math.max(MIN_CHANGES_HEIGHT,Math.min(Math.round(height),maximum));
  };
  useEffect(()=>{
    if(changesHeight!==null)localStorage.setItem('revu-review-changes-height',String(changesHeight));
  },[changesHeight]);
  useEffect(()=>{if(filter!=='all'&&!projects.some(project=>project.id===filter))onFilterChange('all');},[filter,projects,onFilterChange]);
  const scoped=useMemo(()=>projects.filter(project=>filter==='all'||project.id===filter),[filter,projects]);
  const rows=useMemo(()=>scoped.flatMap(project=>{
    const status=statuses[project.id];
    const paths=new Set([...(status?.files.map(file=>file.path)??[]),...documents.filter(file=>file.project.id===project.id&&
      (file.chunks.length||file.records.length||file.dirty||pinsByFile.has(file.id))).map(file=>file.path)]);
    const fileRows:ReviewFileRow[]=[...paths].sort().map(path=>{
      const change=status?.files.find(file=>file.path===path);
      return {id:project.id+'/'+path,project,path,status:change,
        file:change?.previewKey?undefined:documents.find(file=>file.project.id===project.id&&file.path===path)};
    });
    return [...fileRows,...snapshots.filter(file=>file.project.id===project.id&&pinsByFile.has(file.id))
      .map<ReviewFileRow>(file=>({id:file.id,project,path:file.path,file,snapshot:true}))];
  }),[scoped,statuses,documents,snapshots,pinsByFile]);
  useEffect(()=>{if(selected&&!rows.some(row=>row.id===selected))onSelectedChange('');},[rows,selected,onSelectedChange]);
  useEffect(()=>{
    if(!revealTarget||revealTarget.fileId!==selected)return;
    const view=dashboardRef.current?.ownerDocument.defaultView??window;
    const frame=view.requestAnimationFrame(()=>chunkRefs.current.get(revealTarget.itemId)
      ?.scrollIntoView({block:'center',inline:'nearest',behavior:'smooth'}));
    return()=>view.cancelAnimationFrame(frame);
  },[revealTarget?.token,selected]);
  const current=rows.find(row=>row.id===selected);
  const currentFile=current?.file;
  const currentChunks=currentFile?dashboardChunks(currentFile,pinsByFile.get(currentFile.id)??[]):undefined;
  const currentItems=currentChunks?.items??[];
  const pending=rows.reduce((sum,row)=>sum+(row.file?.chunks.length??0),0);
  const reviewed=rows.reduce((sum,row)=>sum+(row.file?.records.length??0),0);
  const activeProject=projects.length===1?projects[0]:projects.find(project=>project.id===filter);
  const branch=activeProject?statuses[activeProject.id]?.branch??'':'';
  const grouped=projects.length>1&&filter==='all';
  const bulk=(action:ReviewBulkAction)=>onBulk(scoped.map(project=>project.id),action);
  const fileRow=(row:ReviewFileRow)=>{
    const {id:key,file}=row;
    const pinCount=(pinsByFile.get(key)??[]).filter(pin=>pin.chunkId===undefined).length;
    const pinOnly=!row.status&&!!pinCount&&!file?.chunks.length&&!file?.records.length&&!file?.dirty;
    const status=(row.status?.status??(pinOnly?'P':'M'))[0].toUpperCase();
    const reviewedOnly=!!file&&!file.chunks.length&&!!file.records.length;
    const nameClass=reviewedOnly?'review-complete':'status-'+status.toLowerCase();
    const unavailable=!file||file.computing||file.syncing||file.saving||!!(file.syncError||file.diffError||file.reason);
    const open=()=>{
      onSelectedChange(key);
      if(row.snapshot)onOpenSnapshot(key);
      else if(!(row.status?.reason&&!file))onOpen(row.project,row.path);
    };
    return <div key={key} data-panel-anchor={key} className={'review-file-row '+(selected===key?'active':'')}>
      <button className={'review-file-name '+nameClass} title={row.path} onClick={open}>{displayPath(row.path,fileLabels)}{row.snapshot?' · Snapshot':''}</button>
      <div className="review-file-actions">
        <button className="action-accept" disabled={unavailable||!file?.chunks.length}
          onClick={()=>file&&onFileBulk(file,'accept')}>Accept</button>
        <button className="action-reject" disabled={unavailable||!file?.chunks.length}
          onClick={()=>file&&onFileBulk(file,'reject')}>Reject</button>
        <button disabled={unavailable||!file?.records.length}
          onClick={()=>file&&onFileBulk(file,'undo')}>Undo</button>
      </div>
      <button className="review-file-summary" onClick={open}>
        {row.status?.previewKey?'Read-only preview':pinOnly?`${pinCount} pinned`:`${file?.chunks.length??0} pending · ${file?.records.length??0} reviewed${pinCount?` · ${pinCount} pinned`:''}`}
      </button>
      <span className={'review-file-status status-'+status.toLowerCase()}>{status}</span>
    </div>;
  };
  const detail=<ScrollbarScope><section className="review-detail" data-panel-scroll>
        {!current?<p className="sidebar-empty">Select a file to view chunks</p>:<>
          <div className="review-detail-heading"><strong title={current.path}>{displayPath(current.path,fileLabels)}</strong>
            <span>{current.status?.previewKey?'Read-only':`${currentItems.length} chunk${currentItems.length===1?'':'s'}`}</span></div>
          {(current.status?.reason||current.file?.reason)&&
            <p className="review-warning">{current.status?.reason||current.file?.reason}</p>}
          {current.file?.computing&&<p className="tree-note">Updating diff…</p>}
          {current.status?.previewKey&&<MixedPreview key={current.id+current.status.previewKey} projectId={current.project.id} path={current.path} previewKey={current.status.previewKey}/>}
          {current.file?.diffError&&<p className="review-warning">{current.file.diffError}</p>}
          {currentFile&&currentItems.map(item=>{
            const active=revealTarget?.fileId===selected&&revealTarget.itemId===item.id;
            const setRef=(node:HTMLDivElement|null)=>{if(node)chunkRefs.current.set(item.id,node);else chunkRefs.current.delete(item.id);};
            if('reference' in item){
              const reveal=()=>onRevealPin(currentFile,item);
              return <div className="dashboard-chunk" data-panel-anchor={item.id} aria-current={active||undefined} key={item.id} ref={setRef}>
                <PinActions pin={item} kept={keptIds.has(item.id)} onAction={onPinAction} onSource={onPinSource} onReveal={reveal}/>
                <button className="chunk-preview" title="Go to code" onClick={reveal}><span>{item.preview.trimStart()||'\u00a0'}</span></button>
                {item.reference.note&&<div className="code-pin-notes">{item.reference.note}</div>}
              </div>;
            }
            const record='decision' in item;
            const expanded=record&&expandedRecords.has(item.id);
            const notes=currentChunks?.notes.get(item.id);
            return <div className={'dashboard-chunk '+(active?'active':'')} data-panel-anchor={item.id} key={item.id} ref={setRef}>
              <ReviewActions file={currentFile} item={item} onAction={onAction}
                detailsExpanded={expanded} onToggleDetails={record?()=>onToggleReviewPreview(currentFile,item.id,item.line):undefined}
                onReveal={()=>onGoto(current.project,current.path,item.line)}/>
              <button className="chunk-preview" title="Go to code"
                onClick={()=>onGoto(current.project,current.path,item.line)}>
                <span className="removed">{firstPreviewLine(item.oldText)?'- '+firstPreviewLine(item.oldText):''}</span>
                <span className="added">{firstPreviewLine(item.newText)?'+ '+firstPreviewLine(item.newText):''}</span>
              </button>
              {!!notes?.size&&<div className="code-pin-notes">{[...notes].map(note=><div key={note}>{note}</div>)}</div>}
            </div>;
          })}
        </>}
      </section></ScrollbarScope>;
  const heightHandle=<div className="review-height-handle" role="separator" aria-label="Resize changed files"
        aria-orientation="horizontal" tabIndex={0} aria-valuenow={changesHeight??undefined}
        onPointerDown={event=>{
          const height=changesRef.current?.getBoundingClientRect().height??MIN_CHANGES_HEIGHT;
          dragRef.current={y:event.clientY,height};event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event=>{
          const drag=dragRef.current;if(!drag)return;
          setChangesHeight(clampChangesHeight(drag.height+drag.y-event.clientY));
        }}
        onPointerUp={event=>{
          dragRef.current=null;
          if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={()=>{dragRef.current=null;}}
        onKeyDown={event=>{
          if(event.key!=='ArrowUp'&&event.key!=='ArrowDown')return;
          event.preventDefault();
          const height=changesRef.current?.getBoundingClientRect().height??MIN_CHANGES_HEIGHT;
          setChangesHeight(clampChangesHeight(height+(event.key==='ArrowUp'?12:-12)));
        }}/>;
  const changes=<section ref={changesRef} className={'review-changes '+(split?'split':'')} aria-label="Review files"
        style={split||changesHeight===null?undefined:{flexBasis:changesHeight,maxHeight:`calc(100% - ${REVIEW_HEADER_HEIGHT+REVIEW_RESIZE_HEIGHT+MIN_DETAIL_HEIGHT}px)`}}>
        <header className="review-changes-header">
          <div className="review-project-labels">
            {projects.length===1?<strong className="review-project-name" title={projects[0].name}>{projects[0].name}</strong>:
              <ProjectDropdown projects={projects} value={filter} onChange={onFilterChange}/>}
            {branch&&<span className="review-branch" ref={fitReviewBranch}><span title={branch}>{branch}</span></span>}
          </div>
          <div className="review-bulk-actions">
            <button title="Accept all pending changes" aria-label="Accept all pending changes"
              className="action-accept" disabled={!pending} onClick={()=>bulk('accept')}>Accept</button>
            <button title="Reject all pending changes" aria-label="Reject all pending changes"
              className="action-reject" disabled={!pending} onClick={()=>bulk('reject')}>Reject</button>
            <button title="Undo all reviewed changes" aria-label="Undo all reviewed changes"
              disabled={!reviewed} onClick={()=>bulk('undo')}>Undo</button>
          </div>
        </header>
        <ScrollbarScope><div className="review-file-list" ref={alignReviewActions} data-panel-scroll>
          {grouped?scoped.map(project=>{
            const projectRows=rows.filter(row=>row.project.id===project.id);
            if(!projectRows.length)return null;
            const projectPending=projectRows.reduce((sum,row)=>sum+(row.file?.chunks.length??0),0);
            const projectReviewed=projectRows.reduce((sum,row)=>sum+(row.file?.records.length??0),0);
            return <div className="review-file-group" key={project.id}>
              <div className="review-file-group-heading">
                <div className="review-project-labels">
                  <strong>{project.name}</strong>
                  <span title={statuses[project.id]?.branch??undefined}>{statuses[project.id]?.branch}</span>
                </div>
                <div className="review-file-group-actions">
                  <button className="action-accept" disabled={!projectPending}
                    onClick={()=>onBulk([project.id],'accept')}>Accept</button>
                  <button className="action-reject" disabled={!projectPending}
                    onClick={()=>onBulk([project.id],'reject')}>Reject</button>
                  <button disabled={!projectReviewed} onClick={()=>onBulk([project.id],'undo')}>Undo</button>
                </div>
              </div>
              {projectRows.map(fileRow)}
            </div>;
          }):rows.map(fileRow)}
        </div></ScrollbarScope>
      </section>;
  const splitWindow=!!detachedWindow&&split&&projects.length>0;
  return <PanelPortal targetWindow={detachedWindow}>
    <aside ref={dashboardRef} className={'explorer review-dashboard'+(splitWindow?' detached-split':'')}
      style={{width:detachedWindow?(splitWindow?(detachedListWidth??'50%'):'100%'):width}}>
      <header className="explorer-header"><span>Review</span><div className="review-header-actions">
        <button className="icon-button" title={split?'Merge review panes':'Split review panes'}
          aria-label={split?'Merge review panes':'Split review panes'} onClick={()=>onSplitChange(!split)}>
          <Icon name={split?'merge':'split'} size={17}/>
        </button>
        {!detachedWindow&&onToggleWindow&&<button className="icon-button" title="Separate Review window" aria-label="Separate Review window" onClick={onToggleWindow}>
          <Icon name="panelSeparate" size={17}/>
        </button>}
        </div>
      </header>
      {!projects.length?<p className="sidebar-empty">Open a project to begin</p>:
        split?changes:<>{detail}{heightHandle}{changes}</>}
      {detachedWindow
        ?splitWindow&&<ResizeHandle onResize={setDetachedListWidth} label="Resize review panes"/>
        :<ResizeHandle width={width} onResize={onResize}/>}
    </aside>
    {split&&projects.length>0&&<section className="review-chunk-pane" style={detachedWindow?undefined:{width:chunkWidth}}>
      <header className="explorer-header"><span>Chunks</span></header>
      {detail}
      {!detachedWindow&&<ResizeHandle width={chunkWidth} onResize={onChunkResize} label="Resize chunk pane"/>}
    </section>}
  </PanelPortal>;
}
