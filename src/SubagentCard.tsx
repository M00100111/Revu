import {useMemo,useState} from 'react';
import type {ToolState} from './AgentChat';
import Icon from './Icon';
import MarkdownContent from './MarkdownContent';
import {subagentView} from './subagentView';

type Task=ReturnType<typeof subagentView>['tasks'][number];
function TaskRow({task,step,onToggle}:{task:Task;step?:number;onToggle:()=>void}){
  const [open,setOpen]=useState(false);
  return <details className="subagent-task" onToggle={event=>{setOpen(event.currentTarget.open);onToggle();}}>
    <summary><Icon name="right" size={12}/><span className="subagent-name">{step&&`${step}. `}{task.agent}</span><span className="subagent-preview" title={task.task}>{task.task}</span>
      {task.preview&&<span className="subagent-preview" title={task.preview}>{task.preview}</span>}<span className="execution-status" data-status={task.status}>{task.status}</span></summary>
    {open&&<div className="subagent-process">
      <section><strong>Task</strong><p>{task.task}</p></section>
      {task.items.length>0&&<section><strong>Execution</strong>
        {task.items.map((item,index)=>item.kind==='text'?<MarkdownContent key={index} text={item.text}/>:<div className="subagent-call" key={index}>
          <pre>{item.text}</pre>{item.result!==undefined&&<pre className={item.isError?'subagent-error':undefined}>↳ {item.result}</pre>}</div>)}
      </section>}
      {(task.output||task.diagnostic)&&<section><strong>Output</strong>{task.output&&<MarkdownContent text={task.output}/>}
        {task.diagnostic&&task.diagnostic!==task.output&&<pre className="subagent-error">{task.diagnostic}</pre>}</section>}
      {task.usage&&<footer>{task.usage}</footer>}</div>}
  </details>;
}

export default function SubagentCard({tool,onOpenDetail,onToggle}:{tool:ToolState;onOpenDetail:()=>void;onToggle:()=>void}){
  const view=useMemo(()=>subagentView(tool),[tool]);
  return <section className={`agent-tool subagent-card ${view.status==='failed'?'error':view.status}`}>
    <header><span className="agent-tool-head"><span>{tool.name}</span><span className="agent-tool-command" title={view.mode}>{view.mode}</span></span>
      <span className="subagent-count">{view.completed}/{view.tasks.length}</span>
      <span className="execution-status" data-status={view.status}>{view.status}</span></header>
    {view.tasks.map((task,index)=><TaskRow key={index} task={task} step={view.mode==='chain'?index+1:undefined} onToggle={onToggle}/>)}
    {view.notice&&<pre>{view.notice}</pre>}
    <details className="subagent-result" onToggle={onToggle}>
      <summary><Icon name="right" size={12}/>result</summary>
      <div className="agent-tool-detail">
        <button type="button" className="agent-tool-expand" title="Open in Editor" aria-label="Open subagent details in editor" onClick={onOpenDetail}><Icon name="expand" size={13}/></button>
        {view.resultText!==undefined&&<pre>{view.resultText}</pre>}
      </div>
    </details>
    {view.total&&<footer>{view.total}</footer>}
  </section>;
}
