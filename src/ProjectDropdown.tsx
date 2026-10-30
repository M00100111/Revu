import { useEffect, useRef, useState } from 'react';
import type { Project } from './editor';
import Icon from './Icon';

export default function ProjectDropdown({projects,value,onChange}:{
  projects:Project[];value:string;onChange:(value:string)=>void;
}){
  const [open,setOpen]=useState(false);
  const root=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!open)return;
    const close=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false);};
    window.addEventListener('pointerdown',close);window.addEventListener('keydown',escape);
    return()=>{window.removeEventListener('pointerdown',close);window.removeEventListener('keydown',escape);};
  },[open]);
  const label=value==='all'?'All Projects':projects.find(project=>project.id===value)?.name??'All Projects';
  const choose=(next:string)=>{onChange(next);setOpen(false);};
  return <div className="project-dropdown" ref={root}>
    <button className="project-dropdown-trigger" aria-haspopup="listbox" aria-expanded={open} onClick={()=>setOpen(!open)}>
      <span>{label}</span><Icon name="chevron" size={11}/>
    </button>
    {open&&<div className="project-dropdown-menu" role="listbox" aria-label="Review project">
      <button className={value==='all'?'selected':''} role="option" aria-selected={value==='all'} onClick={()=>choose('all')}>All Projects</button>
      {projects.map(project=><button key={project.id} className={value===project.id?'selected':''}
        role="option" aria-selected={value===project.id} onClick={()=>choose(project.id)}>{project.name}</button>)}
    </div>}
  </div>;
}
