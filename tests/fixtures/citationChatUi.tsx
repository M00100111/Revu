import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import AgentChat,{type AgentNavigationRequest} from '../../src/AgentChat';
import type {CiteRequest} from '../../shared/citations';

const projects=['Test1','Test2'].map(id=>({id,name:id,root:'D:/work/'+id,git:false,base:null}));
const noop=()=>{};
function Fixture(){
  const [cite,setCite]=useState<CiteRequest>(),[navigation,go]=useState<AgentNavigationRequest|null>(null);
  return <><button id="other-chat" onClick={()=>go({projectId:'Test2',sessionId:'other',token:1})}>Other chat</button>
    {projects.map(project=><button key={project.id} id={'cite-'+project.id} onClick={()=>setCite({projectId:project.id,path:'some dir/a.ts'})}>Cite {project.id}</button>)}
    <AgentChat open projects={projects} activeProjectId="Test1" width={460} dirtyProjectIds={new Set()} navigationRequest={navigation} citeRequest={cite}
      onOpenSettings={noop} onResize={noop} onResizeEnd={noop} notify={(_level,message)=>console.error(message)} onNotice={noop} onProjectAdded={project=>project}
      onOpenToolDetail={noop} onUpdateToolDetail={noop} onPinSession={noop} onShowPins={noop} onOpenCode={noop} onGoto={noop}/></>;
}
createRoot(document.querySelector('main')!).render(<Fixture/>);
