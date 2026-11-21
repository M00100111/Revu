import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import SubagentCard from '../src/SubagentCard';
import {subagentView} from '../src/subagentView';
import {updateEvent,withSnapshot} from '../src/AgentChat';
import type {PiSessionSnapshot} from '../shared/piTypes';

const tasks=['A','B'].map(task=>({agent:'worker',task}));
const message=(text:string)=>({role:'assistant',content:[{type:'text',text}]});
const child=(index:number,exitCode:number)=>({...tasks[index],exitCode,messages:[message(tasks[index].task+' done')],usage:{turns:1,input:521}});
const snapshot:PiSessionSnapshot={sessionId:'session',projectId:'project',status:'idle',name:'Test',messages:[],thinkingLevel:'off',
  availableThinkingLevels:['off'],autoCompactionEnabled:false,isCompacting:false};

test('parallel workers keep their dispatch order, activity and individual completion state',()=>{
  const result={details:{mode:'parallel',results:[{...child(0,-1),messages:[{role:'assistant',content:[
    {type:'text',text:'Waiting'},{type:'toolCall',name:'bash',arguments:{command:'sleep 30'}}]}]},child(1,0)]}};
  const view=subagentView({status:'running',args:{tasks},result});
  assert.deepEqual(view.tasks.map(task=>[task.task,task.status,task.preview]),[['A','running','$ sleep 30'],['B','done','B done']]);
  assert.equal(view.completed,1);assert.match(view.total,/2 turns/);
});

test('group progress counts successful tasks but only reports done after the parent finishes',()=>{
  const args={chain:tasks};
  const progress=(view:ReturnType<typeof subagentView>)=>[view.completed,view.tasks.length,view.status];
  assert.deepEqual(progress(subagentView({args,status:'running'})),[0,2,'running']);
  const result={details:{mode:'chain',results:[child(0,0),child(1,-1)]}};
  assert.deepEqual(progress(subagentView({args,status:'running',result})),[1,2,'running']);
  result.details.results[1]=child(1,0);
  assert.deepEqual(progress(subagentView({args,status:'done',result})),[2,2,'done']);
  result.details.results[1]=child(1,1);
  assert.deepEqual(progress(subagentView({args,status:'done',result})),[1,2,'failed']);
  assert.equal(subagentView({args,status:'error',result:{content:[{type:'text',text:'Operation aborted'}]}}).status,'cancelled');
});

test('parent result starts collapsed and displays the first text block verbatim, independently of worker outputs',()=>{
  const text='  ## Summary\n\n  **A** & <B>\n';
  const result={content:[{type:'text',text},{type:'text',text:'extra block'}],details:{mode:'parallel',results:[child(0,0),child(1,0)]}};
  const tool={id:'call',runKey:'run',name:'subagent',status:'done' as const,args:{tasks},result};
  assert.deepEqual(subagentView(tool).tasks.map(task=>task.output),['A done','B done']);
  const html=renderToStaticMarkup(createElement(SubagentCard,{tool,onOpenDetail:()=>{},onToggle:()=>{}}));
  assert.match(html,/<pre>  ## Summary\n\n  \*\*A\*\* &amp; &lt;B&gt;\n<\/pre><\/div><\/details><footer>2 turns[^<]*<\/footer><\/section>$/);
  assert.equal(subagentView({...tool,status:'running'}).resultText,undefined);
  assert.equal(subagentView({...tool,result:{content:[{type:'image'},...result.content]}}).resultText,undefined);
});

test('result always offers Open in Editor inside the collapsed disclosure, even without text',()=>{
  for(const state of [
    {status:'running',result:undefined},
    {status:'done',result:{content:[]}},
    {status:'done',result:{content:[{type:'text',text:''}]}},
    {status:'error',result:{content:[{type:'text'}]}},
  ] as const){
    const tool={id:'call',runKey:'run',name:'subagent',args:{tasks},...state};
    const html=renderToStaticMarkup(createElement(SubagentCard,{tool,onOpenDetail:()=>{},onToggle:()=>{}}));
    assert.equal(html.match(/title="Open in Editor"/g)?.length,1);
    assert.match(html,/<details class="subagent-result"><summary>.*?result<\/summary><div class="agent-tool-detail"><button[^>]*title="Open in Editor"/s);
  }
});

test('execution pairs tool returns by ID, preserving call order and separating final output',()=>{
  const call=(id:string)=>({type:'toolCall',name:'bash',id,arguments:{command:'echo '+id}});
  const returned=(id:string,text:string)=>({role:'toolResult',toolCallId:id,content:[{type:'text',text}]});
  const messages=[{role:'assistant',content:[{type:'text',text:'Checking'},call('first'),call('second')]},
    returned('second','B'),returned('first','A'),message('Final answer')];
  const {items,output}=subagentView({args:tasks[0],status:'done',result:{details:{results:[{...child(0,0),messages}]}}}).tasks[0];
  assert.deepEqual(items,[{kind:'text',text:'Checking'},{kind:'call',text:'$ echo first',result:'A',isError:false},
    {kind:'call',text:'$ echo second',result:'B',isError:false}]);
  assert.equal(output,'Final answer');
  const simple=subagentView({args:tasks[0],status:'done',result:{details:{results:[child(0,0)]}}}).tasks[0];
  assert.deepEqual(simple.items,[]);assert.equal(simple.output,'A done');
});

test('a stopped chain retains its diagnostic and marks the remaining step not run',()=>{
  const view=subagentView({status:'error',args:{chain:tasks},result:{details:{mode:'chain',results:[{...child(0,1),stderr:'No provider available'}]}}});
  assert.deepEqual(view.tasks.map(task=>task.status),['failed','not run']);assert.equal(view.tasks[0].preview,'No provider available');
  assert.equal(subagentView({status:'done',args:{tasks},result:{content:[{type:'text',text:'Too many parallel tasks'}],details:{results:[]}}}).notice,'Too many parallel tasks');
});

test('single worker streams into the same card restored from a parent toolResult',()=>{
  const args=tasks[0],result={details:{mode:'single',results:[child(0,0)]}};
  let state=updateEvent(withSnapshot(snapshot),{type:'tool_execution_start',toolCallId:'call',toolName:'subagent',args});
  assert.equal(subagentView(state.tools[0]).tasks.length,1);
  state=updateEvent(state,{type:'tool_execution_update',toolCallId:'call',partialResult:result});
  assert.equal(subagentView(state.tools[0]).tasks[0].status,'running');
  state=updateEvent(state,{type:'tool_execution_end',toolCallId:'call',result});
  const restored=withSnapshot({...snapshot,messages:[{role:'assistant',content:[{type:'toolCall',name:'subagent',arguments:args,id:'call'}]},
    {role:'toolResult',toolName:'subagent',toolCallId:'call',...result}]});
  assert.deepEqual(subagentView(state.tools[0]),subagentView(restored.tools[0]));assert.equal(subagentView(restored.tools[0]).completed,1);
});
