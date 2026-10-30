import { useEffect, useMemo, useState } from 'react';
import type { ChangeFile, ProjectStatus, ReviewBulkAction } from '../shared/types';
import type { OpenFile, Project } from './editor';
import { reviewItems, ReviewActions, type ActionHandler } from './ReviewActions';
import ResizeHandle from './ResizeHandle';
import ProjectDropdown from './ProjectDropdown';

interface ReviewFileRow {project:Project;status?:ChangeFile;file?:OpenFile;path:string}

export default function ReviewDashboard({projects,documents,statuses,width,onResize,onOpen,onAction,onBulk,onRefreshBase}:{
  projects:Project[];documents:OpenFile[];statuses:Record<string,ProjectStatus>;
  width:number;onResize:(width:number)=>void;onOpen:(project:Project,path:string,line?:number)=>void;
  onAction:ActionHandler;onBulk:(projectIds:string[],action:ReviewBulkAction)=>void;onRefreshBase:(project:Project)=>void;
}){
  const [filter,setFilter]=useState('all');
  const [selected,setSelected]=useState('');
  useEffect(()=>{if(filter!=='all'&&!projects.some(project=>project.id===filter))setFilter('all');},[filter,projects]);
  const scoped=projects.filter(project=>filter==='all'||project.id===filter);
  const rows=useMemo(()=>scoped.flatMap(project=>{
    const status=statuses[project.id];
    const paths=new Set([...(status?.files.map(file=>file.path)??[]),...documents.filter(file=>file.project.id===project.id&&
      (file.chunks.length||file.records.length||file.dirty||file.conflict)).map(file=>file.path)]);
    return [...paths].sort().map(path=>({project,path,status:status?.files.find(file=>file.path===path),
      file:documents.find(file=>file.project.id===project.id&&file.path===path)}));
  }),[scoped,statuses,documents]);
  useEffect(()=>{if(selected&&!rows.some(row=>row.project.id+'/'+row.path===selected))setSelected('');},[rows,selected]);
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
    return <button key={key} className={'review-file-row '+(selected===key?'active':'')}
      onClick={()=>{setSelected(key);if(!(row.status?.reason&&!row.file))onOpen(row.project,row.path);}}>
      <span className="review-file-main"><strong title={row.path}>{row.path}</strong>
        <small>{file?.chunks.length??0} pending · {file?.records.length??0} reviewed</small></span>
      <span className={'review-file-status status-'+status.toLowerCase()}>{status}</span>
    </button>;
  };
  return <aside className="explorer review-dashboard" style={{width}}>
    <header className="explorer-header"><span>Review</span></header>
    {!projects.length?<p className="sidebar-empty">Open a project to begin</p>:<>
      <section className="review-detail">
        {!current?<p className="sidebar-empty">Select a changed file</p>:<>
          <div className="review-detail-heading"><strong title={current.path}>{current.path}</strong>
            <span>{currentItems.length} chunk{currentItems.length===1?'':'s'}</span></div>
          {statuses[current.project.id]?.changedHead&&<div className="review-warning">HEAD changed.
            <button onClick={()=>onRefreshBase(current.project)}>Refresh base</button></div>}
          {(current.status?.reason||current.file?.reason)&&
            <p className="review-warning">{current.status?.reason||current.file?.reason}</p>}
          {current.file?.conflict&&<p className="review-warning">External conflict. Open the file to resolve it.</p>}
          {current.file?.computing&&<p className="tree-note">Updating diff…</p>}
          {current.file?.diffError&&<p className="review-warning">{current.file.diffError}</p>}
          {current.file&&currentItems.map(item=><div className="dashboard-chunk" key={item.id}>
            <ReviewActions file={current.file!} item={item} onAction={onAction}/>
            <button className="chunk-preview" title="Go to code"
              onClick={()=>onOpen(current.project,current.path,item.line)}>
              <span className="removed">{item.oldText?'- '+item.oldText.split(/\r?\n/)[0]:''}</span>
              <span className="added">{item.newText?'+ '+item.newText.split(/\r?\n/)[0]:''}</span>
            </button>
          </div>)}
        </>}
      </section>
      <section className="review-changes" aria-label="Changed files">
        <header className="review-changes-header">
          {projects.length===1?<strong className="review-project-name" title={projects[0].name}>{projects[0].name}</strong>:
            <ProjectDropdown projects={projects} value={filter} onChange={setFilter}/>}
          <span className="review-branch" title={branch}>{branch}</span>
          <div className="review-bulk-actions">
            <button title="Accept all pending changes" aria-label="Accept all pending changes"
              disabled={!pending} onClick={()=>bulk('accept')}>✓</button>
            <button title="Reject all pending changes" aria-label="Reject all pending changes"
              disabled={!pending} onClick={()=>bulk('reject')}>×</button>
            <button title="Undo all reviewed changes" aria-label="Undo all reviewed changes"
              disabled={!reviewed} onClick={()=>bulk('undo')}>↶</button>
          </div>
        </header>
        <div className="review-file-list">
          {grouped?scoped.map(project=>{
            const projectRows=rows.filter(row=>row.project.id===project.id);
            if(!projectRows.length)return null;
            return <div className="review-file-group" key={project.id}>
              <div className="review-file-group-heading"><strong>{project.name}</strong>
                <span>{statuses[project.id]?.branch}</span></div>
              {projectRows.map(fileRow)}
            </div>;
          }):rows.map(fileRow)}
        </div>
      </section>
    </>}
    <ResizeHandle width={width} onResize={onResize}/>
  </aside>;
}
