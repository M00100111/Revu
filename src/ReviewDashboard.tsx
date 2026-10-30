import { useState } from 'react';
import type { ProjectStatus } from '../shared/types';
import type { OpenFile, Project } from './editor';
import { reviewItems, ReviewActions, type ActionHandler } from './ReviewActions';
import ResizeHandle from './ResizeHandle';
import ProjectDropdown from './ProjectDropdown';
export default function ReviewDashboard({projects,documents,statuses,width,onResize,onOpen,onAction,onRefreshBase,onRefresh}:{
  projects:Project[]; documents:OpenFile[]; statuses:Record<string,ProjectStatus>;
  width:number;onResize:(width:number)=>void;
  onOpen:(project:Project,path:string,line?:number)=>void;onAction:ActionHandler;
  onRefreshBase:(project:Project)=>void;onRefresh:(project:Project)=>void;
}){
  const [filter,setFilter]=useState('all');
  return <aside className="explorer review-dashboard" style={{width}}>
    <header className="explorer-header"><span>Review</span>
      <ProjectDropdown projects={projects} value={filter} onChange={setFilter}/>
    </header>
    {!projects.length&&<p className="sidebar-empty">Open a project to begin</p>}
    <div className="review-scroll">
      {projects.filter(p=>filter==='all'||filter===p.id).map(project=>{
        const status=statuses[project.id];
        const paths=new Set([...(status?.files.map(f=>f.path)??[]),
          ...documents.filter(f=>f.project.id===project.id&&(f.chunks.length||f.records.length||f.dirty||f.conflict)).map(f=>f.path)]);
        return <section className="review-project" key={project.id}>
          <div className="review-project-heading"><strong>{project.name}</strong>
            <button onClick={()=>onRefresh(project)} title="Refresh changes">Refresh</button></div>
          {!project.git?<p className="tree-note">Not a Git repository</p>:<>
            <div className="review-base">Base {status?.base?.slice(0,8)??'empty repository'}</div>
            {status?.changedHead&&<div className="review-warning">HEAD changed. The current review still uses the previous base.
              <button onClick={()=>onRefreshBase(project)}>Refresh base</button></div>}
            {!status&&<p className="tree-note">Detecting…</p>}
            {status&&!paths.size&&<p className="tree-note">No changes</p>}
            {[...paths].map(path=>{
              const file=documents.find(f=>f.project.id===project.id&&f.path===path);
              const reason=status?.files.find(f=>f.path===path)?.reason??file?.reason;
              return <div className="review-file" key={path}>
                <button className="review-file-name" disabled={!!reason&&!file}
                  onClick={()=>onOpen(project,path)} title={path}>{path}</button>
                {reason&&<p className="review-warning">{reason}</p>}
                {file?.conflict&&<p className="review-warning">External conflict. Open the file to resolve it.</p>}
                {file?.computing&&<p className="tree-note">Updating diff…</p>}
                {file?.diffError&&<p role="alert" className="review-warning">{file.diffError}</p>}
                {file&&reviewItems(file).map(item=><div className="dashboard-chunk" key={item.id}>
                  <ReviewActions file={file} item={item} onAction={onAction}/>
                  <button className="chunk-preview" title="Go to code" onClick={()=>onOpen(project,path,item.line)}>
                    <span className="removed">{item.oldText?'- '+item.oldText.split(/\r?\n/)[0]:''}</span>
                    <span className="added">{item.newText?'+ '+item.newText.split(/\r?\n/)[0]:''}</span>
                  </button>
                </div>)}
              </div>;
            })}
          </>}
        </section>;
      })}
    </div>
    <ResizeHandle width={width} onResize={onResize}/>
  </aside>;
}
