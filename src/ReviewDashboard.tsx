import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeFile, ProjectStatus, ReviewBulkAction } from '../shared/types';
import type { OpenFile, Project } from './editor';
import { reviewItems, ReviewActions, type ActionHandler } from './ReviewActions';
import ResizeHandle from './ResizeHandle';
import ProjectDropdown from './ProjectDropdown';
import Icon from './Icon';

interface ReviewFileRow {project:Project;status?:ChangeFile;file?:OpenFile;path:string}
const MIN_DETAIL_HEIGHT=120;
const MIN_CHANGES_HEIGHT=160;
const REVIEW_HEADER_HEIGHT=54;
const REVIEW_RESIZE_HEIGHT=6;
const firstPreviewLine=(text:string)=>text.split(/\r?\n/).find(line=>line.trim().length>0)??'';

const savedChangesHeight=()=>{
  const value=Number(localStorage.getItem('revu-review-changes-height'));
  return Number.isFinite(value)&&value>=MIN_CHANGES_HEIGHT?value:null;
};

export default function ReviewDashboard({projects,documents,statuses,filter,selected,revealTarget,expandedRecords,onToggleReviewPreview,width,onResize,onOpen,onAction,onBulk,onFileBulk,onFilterChange,onSelectedChange,split,onSplitChange,chunkWidth,onChunkResize}:{
  projects:Project[];documents:OpenFile[];statuses:Record<string,ProjectStatus>;
  filter:string;selected:string;
  revealTarget:{fileId:string;itemId:string;token:number}|null;
  expandedRecords:ReadonlySet<string>;onToggleReviewPreview:(file:OpenFile,itemId:string,line:number)=>void;
  width:number;onResize:(width:number)=>void;onOpen:(project:Project,path:string,line?:number)=>void;
  onAction:ActionHandler;onBulk:(projectIds:string[],action:ReviewBulkAction)=>void;
  onFileBulk:(file:OpenFile,action:ReviewBulkAction)=>void;
  onFilterChange:(filter:string)=>void;onSelectedChange:(selected:string)=>void;
  split:boolean;onSplitChange:(split:boolean)=>void;chunkWidth:number;onChunkResize:(width:number)=>void;
}){
  const [changesHeight,setChangesHeight]=useState<number|null>(savedChangesHeight);
  const dashboardRef=useRef<HTMLElement|null>(null);
  const changesRef=useRef<HTMLElement|null>(null);
  const chunkRefs=useRef(new Map<string,HTMLDivElement>());
  const dragRef=useRef<{y:number;height:number}|null>(null);
  const clampChangesHeight=useCallback((height:number)=>{
    const available=(dashboardRef.current?.clientHeight??window.innerHeight)-REVIEW_HEADER_HEIGHT-REVIEW_RESIZE_HEIGHT;
    const maximum=Math.max(MIN_CHANGES_HEIGHT,available-MIN_DETAIL_HEIGHT);
    return Math.max(MIN_CHANGES_HEIGHT,Math.min(Math.round(height),maximum));
  },[]);
  useEffect(()=>{
    if(changesHeight!==null)localStorage.setItem('revu-review-changes-height',String(changesHeight));
  },[changesHeight]);
  useEffect(()=>{
    const dashboard=dashboardRef.current;
    if(!dashboard)return;
    const observer=new ResizeObserver(()=>setChangesHeight(current=>current===null?null:clampChangesHeight(current)));
    observer.observe(dashboard);return()=>observer.disconnect();
  },[clampChangesHeight]);
  useEffect(()=>{if(filter!=='all'&&!projects.some(project=>project.id===filter))onFilterChange('all');},[filter,projects,onFilterChange]);
  const scoped=projects.filter(project=>filter==='all'||project.id===filter);
  const rows=useMemo(()=>scoped.flatMap(project=>{
    const status=statuses[project.id];
    const paths=new Set([...(status?.files.map(file=>file.path)??[]),...documents.filter(file=>file.project.id===project.id&&
      (file.chunks.length||file.records.length||file.dirty)).map(file=>file.path)]);
    return [...paths].sort().map(path=>({project,path,status:status?.files.find(file=>file.path===path),
      file:documents.find(file=>file.project.id===project.id&&file.path===path)}));
  }),[scoped,statuses,documents]);
  useEffect(()=>{if(selected&&!rows.some(row=>row.project.id+'/'+row.path===selected))onSelectedChange('');},[rows,selected,onSelectedChange]);
  useEffect(()=>{
    if(!revealTarget||revealTarget.fileId!==selected)return;
    const frame=requestAnimationFrame(()=>chunkRefs.current.get(revealTarget.itemId)
      ?.scrollIntoView({block:'center',inline:'nearest',behavior:'smooth'}));
    return()=>cancelAnimationFrame(frame);
  },[revealTarget?.token,selected]);
  const current=rows.find(row=>row.project.id+'/'+row.path===selected);
  const currentItems=current?.file?reviewItems(current.file):[];
  const pending=rows.reduce((sum,row)=>sum+(row.file?.chunks.length??0),0);
  const reviewed=rows.reduce((sum,row)=>sum+(row.file?.records.length??0),0);
  const activeProject=projects.length===1?projects[0]:projects.find(project=>project.id===filter);
  const branch=activeProject?statuses[activeProject.id]?.branch??'':'';
  const grouped=projects.length>1&&filter==='all';
  const bulk=(action:ReviewBulkAction)=>onBulk(scoped.map(project=>project.id),action);
  const fileRow=(row:ReviewFileRow)=>{
    const key=row.project.id+'/'+row.path,file=row.file;
    const status=(row.status?.status??'M')[0].toUpperCase();
    const reviewedOnly=!!file&&!file.chunks.length&&!!file.records.length;
    const nameClass=reviewedOnly?'review-complete':'status-'+status.toLowerCase();
    const unavailable=!file||file.computing||file.syncing||file.saving||!!(file.syncError||file.diffError||file.reason);
    const open=()=>{onSelectedChange(key);if(!(row.status?.reason&&!row.file))onOpen(row.project,row.path);};
    return <div key={key} className={'review-file-row '+(selected===key?'active':'')}>
      <button className={'review-file-name '+nameClass} title={row.path} onClick={open}>{row.path}</button>
      <div className="review-file-actions">
        <button className="action-accept" disabled={unavailable||!file?.chunks.length}
          onClick={()=>file&&onFileBulk(file,'accept')}>Accept</button>
        <button className="action-reject" disabled={unavailable||!file?.chunks.length}
          onClick={()=>file&&onFileBulk(file,'reject')}>Reject</button>
        <button disabled={unavailable||!file?.records.length}
          onClick={()=>file&&onFileBulk(file,'undo')}>Undo</button>
      </div>
      <button className="review-file-summary" onClick={open}>
        {file?.chunks.length??0} pending · {file?.records.length??0} reviewed
      </button>
      <span className={'review-file-status status-'+status.toLowerCase()}>{status}</span>
    </div>;
  };
  const detail=<section className="review-detail">
        {!current?<p className="sidebar-empty">Select a changed file</p>:<>
          <div className="review-detail-heading"><strong title={current.path}>{current.path}</strong>
            <span>{currentItems.length} chunk{currentItems.length===1?'':'s'}</span></div>
          {(current.status?.reason||current.file?.reason)&&
            <p className="review-warning">{current.status?.reason||current.file?.reason}</p>}
          {current.file?.computing&&<p className="tree-note">Updating diff…</p>}
          {current.file?.diffError&&<p className="review-warning">{current.file.diffError}</p>}
          {current.file&&currentItems.map(item=>{
            const record='decision' in item;
            const expanded=record&&expandedRecords.has(item.id);
            const active=revealTarget?.fileId===selected&&revealTarget.itemId===item.id;
            return <div className={'dashboard-chunk '+(active?'active':'')} key={item.id}
              ref={node=>{if(node)chunkRefs.current.set(item.id,node);else chunkRefs.current.delete(item.id);}}>
              <ReviewActions file={current.file!} item={item} onAction={onAction}
                detailsExpanded={expanded} onToggleDetails={record?()=>onToggleReviewPreview(current.file!,item.id,item.line):undefined}
                onReveal={()=>onOpen(current.project,current.path,item.line)}/>
              <button className="chunk-preview" title="Go to code"
                onClick={()=>onOpen(current.project,current.path,item.line)}>
                <span className="removed">{firstPreviewLine(item.oldText)?'- '+firstPreviewLine(item.oldText):''}</span>
                <span className="added">{firstPreviewLine(item.newText)?'+ '+firstPreviewLine(item.newText):''}</span>
              </button>
            </div>;
          })}
        </>}
      </section>;
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
          const height=changesHeight??changesRef.current?.getBoundingClientRect().height??MIN_CHANGES_HEIGHT;
          setChangesHeight(clampChangesHeight(height+(event.key==='ArrowUp'?12:-12)));
        }}/>;
  const changes=<section ref={changesRef} className={'review-changes '+(split?'split':'')} aria-label="Changed files"
        style={split||changesHeight===null?undefined:{flexBasis:changesHeight}}>
        <header className="review-changes-header">
          {projects.length===1?<strong className="review-project-name" title={projects[0].name}>{projects[0].name}</strong>:
            <ProjectDropdown projects={projects} value={filter} onChange={onFilterChange}/>}
          <span className="review-branch" title={branch}>{branch}</span>
          <div className="review-bulk-actions">
            <button title="Accept all pending changes" aria-label="Accept all pending changes"
              className="action-accept" disabled={!pending} onClick={()=>bulk('accept')}>Accept</button>
            <button title="Reject all pending changes" aria-label="Reject all pending changes"
              className="action-reject" disabled={!pending} onClick={()=>bulk('reject')}>Reject</button>
            <button title="Undo all reviewed changes" aria-label="Undo all reviewed changes"
              disabled={!reviewed} onClick={()=>bulk('undo')}>Undo</button>
          </div>
        </header>
        <div className="review-file-list">
          {grouped?scoped.map(project=>{
            const projectRows=rows.filter(row=>row.project.id===project.id);
            if(!projectRows.length)return null;
            const projectPending=projectRows.reduce((sum,row)=>sum+(row.file?.chunks.length??0),0);
            const projectReviewed=projectRows.reduce((sum,row)=>sum+(row.file?.records.length??0),0);
            return <div className="review-file-group" key={project.id}>
              <div className="review-file-group-heading"><strong>{project.name}</strong>
                <span>{statuses[project.id]?.branch}</span>
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
        </div>
      </section>;
  return <>
    <aside ref={dashboardRef} className="explorer review-dashboard" style={{width}}>
      <header className="explorer-header"><span>Review</span>
        <button className="icon-button" title={split?'Merge review panes':'Split review panes'}
          aria-label={split?'Merge review panes':'Split review panes'} onClick={()=>onSplitChange(!split)}>
          <Icon name={split?'merge':'split'} size={17}/>
        </button>
      </header>
      {!projects.length?<p className="sidebar-empty">Open a project to begin</p>:
        split?changes:<>{detail}{heightHandle}{changes}</>}
      <ResizeHandle width={width} onResize={onResize}/>
    </aside>
    {split&&projects.length>0&&<section className="review-chunk-pane" style={{width:chunkWidth}}>
      <header className="explorer-header"><span>Chunks</span></header>
      {detail}
      <ResizeHandle width={chunkWidth} onResize={onChunkResize} label="Resize chunk pane"/>
    </section>}
  </>;
}
