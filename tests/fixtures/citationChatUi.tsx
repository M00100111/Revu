import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import AgentChat,{type AgentNavigationRequest} from '../../src/AgentChat';
import FileSidebar from '../../src/FileSidebar';
import ContextMenuHost from '../../src/ContextMenu';
import type {CiteRequest} from '../../shared/citations';

const projects=['Test1','Test2'].map(id=>({id,name:id,root:'D:/work/'+id,git:false,base:null}));
const fileTabs=projects.map(project=>({id:project.id,name:'a.ts',title:project.id+'/some dir/a.ts',projectName:project.name,
  groupId:project.id,dirty:false,preview:true,file:{project,path:'some dir/a.ts'}}));
const toolTab={id:'tool',name:'Tool output',title:'Other/Tool output',projectName:'Other',groupId:null,dirty:false};
const noop=()=>{};
function Fixture(){
  const [cite,setCite]=useState<CiteRequest>(),[navigation,go]=useState<AgentNavigationRequest|null>(null);
  return <><button id="other-chat" onClick={()=>go({projectId:'Test2',sessionId:'other',token:1})}>Other chat</button>
    {projects.map(project=><button key={project.id} id={'cite-'+project.id} onClick={()=>setCite({projectId:project.id,path:'some dir/a.ts'})}>Cite {project.id}</button>)}
    <AgentChat open projects={projects} activeProjectId="Test1" width={460} dirtyProjectIds={new Set()} navigationRequest={navigation} citeRequest={cite}
      onOpenSettings={noop} onResize={noop} onResizeEnd={noop} notify={(_level,message)=>console.error(message)} onNotice={noop} onProjectAdded={project=>project}
      onOpenToolDetail={noop} onUpdateToolDetail={noop} onPinSession={noop} onShowPins={noop} onOpenCode={noop} onGoto={noop}/>
    <div style={{position:'absolute',right:0,top:0}}>
      <FileSidebar width={250} projects={projects} projectsLoaded tabs={[...fileTabs,toolTab]} activeId="Test1" mixed={false}
        picking={false} collapsedProjects={new Set(projects.map(project=>project.root))} expandedDirectories={new Set()}
        onSelectTab={()=>console.error('Cite selected an editor')} onKeep={()=>console.error('Cite kept a preview')}
        onResize={noop} onAddFolder={noop} onOpenFile={noop} onCloseProject={noop} onExpandAllSubfolders={noop}
        onCollapseAllSubfolders={noop} onProjectToggle={noop} onDirectoryToggle={noop} onError={noop} onCite={setCite}/>
    </div><ContextMenuHost/></>;
}
createRoot(document.querySelector('main')!).render(<Fixture/>);
