import { useEffect, useRef, useState } from 'react';
import type { Project } from './editor';
import Icon from './Icon';
import { usePanelWindow } from './PanelPortal';

export default function ProjectDropdown({projects,value,onChange}:{
  projects:Project[];value:string;onChange:(value:string)=>void;
}){
  const [open,setOpen]=useState(false);
  const root=useRef<HTMLDivElement>(null);
  const view=usePanelWindow();
  useEffect(()=>{
    if(!open)return;
    const close=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false);};
    view.addEventListener('pointerdown',close);view.addEventListener('keydown',escape);
    return()=>{view.removeEventListener('pointerdown',close);view.removeEventListener('keydown',escape);};
  },[open,view]);
  const label=value==='all'?'All Projects':projects.find(project=>project.id===value)?.name??'All Projects';
  const choose=(next:string)=>{onChange(next);setOpen(false);};
  return <div className="project-dropdown" ref={root}>
    <button className="project-dropdown-trigger" aria-haspopup="listbox" aria-expanded={open} onClick={()=>setOpen(!open)}>
      <span>{label}</span><Icon name="down" size={11}/>
    </button>
    {open&&<div className="project-dropdown-menu" role="listbox" aria-label="Review project">
      <button className={value==='all'?'selected':''} role="option" aria-selected={value==='all'} onClick={()=>choose('all')}>All Projects</button>
      {projects.map(project=><button key={project.id} className={value===project.id?'selected':''}
        role="option" aria-selected={value===project.id} onClick={()=>choose(project.id)}>{project.name}</button>)}
    </div>}
  </div>;
}
