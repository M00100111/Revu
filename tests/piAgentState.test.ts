import assert from 'node:assert/strict';
import test from 'node:test';
import { appendInputHistory, buildRuns, directBashCommand, editDiffRows, formatAgentTokens, formatContextPercent, formatToolDuration, normalizeInputHistory, retryCancelOperation, shouldShowAssistantActions, toggleDirectBashInput, toolPresentation, updateAutoRetryState, updateEvent, withSnapshot } from '../src/AgentChat';
import type { ToolState } from '../src/AgentChat';
import { askUserPresentation } from '../src/AskUserCard';
import type { PiSessionSnapshot } from '../shared/piTypes';
import { calculatePiCacheHitPercent, countPiSessionRuns } from '../shared/piSession';
import { acceptPiQueueHead, emptyPiQueue, mergePiQueues, updatePiQueueItem } from '../shared/piQueue';
import { renderMarkdown } from '../src/MarkdownContent';

const snapshot:PiSessionSnapshot={
  sessionId:'session-a',projectId:'project-a',status:'idle',name:'Test',messages:[],
  thinkingLevel:'medium',availableThinkingLevels:['off','medium','high'],autoCompactionEnabled:true,isCompacting:false,
};

test('Pi chat state builds streaming text and accepts the authoritative final message',()=>{
  let state=withSnapshot(snapshot);
  state=updateEvent(state,{type:'message_start',message:{role:'user',content:'Hello',timestamp:1}});
  state=updateEvent(state,{type:'message_start',message:{role:'assistant',content:[],timestamp:2}});
  state=updateEvent(state,{type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'Hel'}});
  state=updateEvent(state,{type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'lo'}});
  assert.equal(state.streamText,'Hello');
  state=updateEvent(state,{type:'message_end',message:{role:'assistant',content:[{type:'text',text:'Hello!'}],timestamp:2}});
  assert.equal(state.streamText,'');
  assert.equal(state.messages.length,2);
  assert.deepEqual(state.messages[1],{role:'assistant',content:[{type:'text',text:'Hello!'}],timestamp:2});
});

test('Pi chat state tracks tool execution by tool call id',()=>{
  let state=withSnapshot(snapshot);
  state=updateEvent(state,{type:'tool_execution_start',toolCallId:'tool-1',toolName:'read',args:{path:'README.md'}});
  assert.equal(typeof state.tools[0].startedAt,'number');
  state=updateEvent(state,{type:'tool_execution_update',toolCallId:'tool-1',partialResult:{content:'partial'}});
  state=updateEvent(state,{type:'tool_execution_end',toolCallId:'tool-1',result:{content:'done'},isError:false,durationMs:1250});
  assert.deepEqual(state.tools,[{id:'tool-1',runKey:'run-0',name:'read',status:'done',args:{path:'README.md'},result:{content:'done'},
    startedAt:state.tools[0].startedAt,durationMs:1250}]);
});

test('Pi chat state keeps thinking separate and restores tools in their run',()=>{
  let state=withSnapshot(snapshot);
  state=updateEvent(state,{type:'message_start',message:{role:'user',content:'Inspect this',timestamp:1}});
  state=updateEvent(state,{type:'message_start',message:{role:'assistant',content:[],timestamp:2}});
  state=updateEvent(state,{type:'message_update',assistantMessageEvent:{type:'thinking_delta',delta:'Checking files'}});
  assert.equal(state.streamThinking,'Checking files');
  assert.equal(state.streamText,'');

  const restored=withSnapshot({...snapshot,messages:[
    {role:'user',content:'Inspect this',timestamp:1},
    {role:'assistant',content:[{type:'thinking',thinking:'Checking files'},{type:'toolCall',id:'tool-1',name:'read',arguments:{path:'README.md'}}],timestamp:2},
    {role:'toolResult',toolCallId:'tool-1',toolName:'read',content:[{type:'text',text:'done'}],isError:false,timestamp:3,durationMs:820},
  ]});
  assert.equal(restored.streamThinking,'');
  assert.deepEqual(restored.tools,[{
    id:'tool-1',runKey:'run-0',name:'read',status:'done',args:{path:'README.md'},
    result:{role:'toolResult',toolCallId:'tool-1',toolName:'read',content:[{type:'text',text:'done'}],isError:false,timestamp:3,durationMs:820},durationMs:820,
  }]);
});

test('Pi usage values use compact tokens and fixed context precision',()=>{
  assert.equal(formatAgentTokens(12_400),'12.4k');
  assert.equal(formatAgentTokens(40_000),'40k');
  assert.equal(formatAgentTokens(2_100_000),'2.1m');
  assert.equal(formatContextPercent(undefined),'0.00%');
  assert.equal(formatContextPercent(8.126),'8.13%');
  assert.equal(formatToolDuration(1250),'1.3s');
  assert.equal(formatToolDuration(90_000),'1m 30s');
  assert.equal(calculatePiCacheHitPercent(10,40,0),80);
  assert.equal(calculatePiCacheHitPercent(0,0,0),0);
});

test('assistant Markdown renders formatting without allowing raw HTML or unsafe links',()=>{
  const html=renderMarkdown('**Bold** <script>alert(1)</script> [safe](https://example.com) [unsafe](javascript:alert(1))');
  assert.match(html,/<strong>Bold<\/strong>/);
  assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html,/href="https:\/\/example.com"/);
  assert.doesNotMatch(html,/href="javascript:/);
});

test('assistant actions are hidden only while the latest run is starting or running',()=>{
  assert.equal(shouldShowAssistantActions(true,'starting'),false);
  assert.equal(shouldShowAssistantActions(true,'running'),false);
  assert.equal(shouldShowAssistantActions(true,'stopping'),true);
  assert.equal(shouldShowAssistantActions(true,'idle'),true);
  assert.equal(shouldShowAssistantActions(true,'error'),true);
  assert.equal(shouldShowAssistantActions(false,'running'),true);
});

test('Pi session Runs count user messages on the active branch only',()=>{
  assert.equal(countPiSessionRuns([
    {type:'message',message:{role:'user'}},{type:'message',message:{role:'assistant'}},
    {type:'message',message:{role:'toolResult'}},{type:'custom'},{type:'message',message:{role:'user'}},
  ]),2);
});

test('reloading a snapshot preserves in-flight tool cards but clears stale stream text',()=>{
  let state=withSnapshot(snapshot);
  state=updateEvent(state,{type:'tool_execution_start',toolCallId:'tool-1',toolName:'bash',args:{command:'npm test'}});
  state={...state,streamText:'partial'};
  const restored=withSnapshot({...snapshot,messages:[{role:'user',content:'Run tests',timestamp:3}]},state);
  assert.equal(restored.streamText,'');
  assert.equal(restored.tools.length,1);
  assert.equal(restored.messages.length,1);
});

test('Pi run statistics combine assistant and model-backed tool usage',()=>{
  const state=withSnapshot({...snapshot,messages:[
    {role:'user',content:'Inspect',timestamp:1000},
    {role:'assistant',content:[{type:'toolCall',id:'tool-1',name:'classify',arguments:{}}],timestamp:1100,durationMs:500,stopReason:'toolUse',
      usage:{input:70,output:10,cacheRead:20,cacheWrite:0,totalTokens:100,cost:{total:.01}}},
    {role:'toolResult',toolCallId:'tool-1',toolName:'classify',content:[],isError:false,timestamp:2000,durationMs:300,
      usage:{input:12,output:3,cacheRead:5,cacheWrite:0,totalTokens:20,cost:{total:.002}}},
    {role:'assistant',content:[{type:'text',text:'Done'}],timestamp:2100,durationMs:400,stopReason:'stop',
      usage:{input:35,output:10,cacheRead:5,cacheWrite:0,totalTokens:50,cost:{total:.005}}},
  ]});
  const run=buildRuns(state)[0];
  assert.equal(run.stats.elapsedMs,1500);
  assert.equal(run.stats.modelTimeMs,900);
  assert.equal(run.stats.toolTimeMs,300);
  assert.equal(run.stats.assistantUsage.totalTokens,150);
  assert.equal(run.stats.toolUsage.totalTokens,20);
  assert.equal(run.stats.calls.length,3);
  assert.equal(run.stopReason,'stop');
  assert.equal(run.items.find(item=>item.type==='tool')?.tool?.usage?.totalTokens,20);
});

test('Pi chat Run keeps the latest Assistant stop reason',()=>{
  const state=withSnapshot({...snapshot,messages:[
    {role:'user',content:'Inspect this',timestamp:1},
    {role:'assistant',content:[{type:'toolCall',id:'tool-1',name:'read',arguments:{}}],timestamp:2,stopReason:'toolUse'},
    {role:'toolResult',toolCallId:'tool-1',toolName:'read',content:[],isError:false,timestamp:3},
    {role:'assistant',content:[{type:'text',text:'Stopped'}],timestamp:4,stopReason:'aborted'},
  ]});
  assert.equal(buildRuns(state)[0].stopReason,'aborted');
});

test('Pi chat renders an inspectable fallback for an unknown extension message role',()=>{
  const state=withSnapshot({...snapshot,messages:[
    {role:'user',content:'Hello',timestamp:1},
    {role:'extensionDemo',content:[{type:'text',text:'Injected extension context'}],details:{example:true},timestamp:2},
  ]});
  const item=buildRuns(state)[0].items[0];
  assert.equal(item.type,'fallback');
  assert.equal(item.label,'extensionDemo');
  assert.equal(item.text,'Injected extension context');
  assert.deepEqual(item.raw,{role:'extensionDemo',content:[{type:'text',text:'Injected extension context'}],details:{example:true},timestamp:2});
});

test('Direct Bash parsing distinguishes context inclusion and keeps pure prefixes as prompts',()=>{
  assert.deepEqual(directBashCommand('!git status'),{command:'git status',excludeFromContext:false});
  assert.deepEqual(directBashCommand('!! git status'),{command:'git status',excludeFromContext:true});
  assert.equal(directBashCommand('!'),null);
  assert.equal(directBashCommand('!!   '),null);
  assert.equal(directBashCommand('say !hello'),null);
  assert.equal(toggleDirectBashInput('draft'),'!');
  assert.equal(toggleDirectBashInput('!git status'),'!!git status');
  assert.equal(toggleDirectBashInput('!!git status'),'!git status');
});

test('global input history ignores legacy structures, removes consecutive duplicates, and keeps 50 entries',()=>{
  assert.deepEqual(normalizeInputHistory({projectA:['old project entry']}),[]);
  let history:string[]=[];
  for(let index=0;index<52;index+=1)history=appendInputHistory(history,`entry-${index}`);
  assert.equal(history.length,50);
  assert.equal(history[0],'entry-2');
  assert.deepEqual(appendInputHistory(history,'entry-51'),history);
});

test('Pi chat orders Direct Bash and summary messages and honors Custom display',()=>{
  const state=withSnapshot({...snapshot,messages:[
    {role:'user',content:'Inspect',timestamp:1},
    {role:'assistant',content:[{type:'text',text:'Answer'}],timestamp:2,stopReason:'stop'},
    {role:'bashExecution',command:'git status',output:'clean',exitCode:0,timestamp:3},
    {role:'custom',customType:'visible-extension',content:'Visible context',display:true,timestamp:4},
    {role:'custom',customType:'hidden-extension',content:'Hidden context',display:false,timestamp:5},
    {role:'branchSummary',summary:'Previous branch work',timestamp:6},
    {role:'compactionSummary',summary:'Earlier context',tokensBefore:12_400,timestamp:7},
  ]});
  const items=buildRuns(state)[0].items;
  assert.deepEqual(items.map(item=>item.type),['answer','bash','custom','branchSummary','compactionSummary']);
  assert.equal(items[2].label,'visible-extension');
  assert.equal(items[4].meta,'12.4k tokens before');
});

test('Auto Retry selects retry cancellation before the deadline and Agent abort after it',()=>{
  const retry=updateAutoRetryState(undefined,{type:'auto_retry_start',attempt:1,maxAttempts:3,errorMessage:'529 overloaded',delayMs:2000},1000)!;
  assert.deepEqual(retry,{attempt:1,maxAttempts:3,errorMessage:'529 overloaded',deadline:3000});
  assert.equal(retryCancelOperation(retry,2999),'abortRetry');
  assert.equal(retryCancelOperation(retry,3000),'abortAgent');
  assert.equal(updateAutoRetryState(retry,{type:'auto_retry_end'},3000),undefined);
});

test('retained queues merge captures, support edits and clear only accepted replay items',()=>{
  let queue=mergePiQueues({steering:['saved'],followUp:[]},{steering:['captured'],followUp:['later']});
  assert.deepEqual(queue,{steering:['saved','captured'],followUp:['later']});
  queue=updatePiQueueItem(queue,'steering',1,'edited');
  assert.deepEqual(queue.steering,['saved','edited']);
  queue=updatePiQueueItem(queue,'steering',0);
  assert.deepEqual(queue.steering,['edited']);
  queue=acceptPiQueueHead(queue,'followUp');
  assert.deepEqual(queue,{steering:['edited'],followUp:[]});
  assert.deepEqual(emptyPiQueue(),{steering:[],followUp:[]});
});

const toolState=(name:string,args:unknown,result?:unknown):ToolState=>({id:'call_1',runKey:'run-0',name,status:'done',args,result,durationMs:4});

test('tool cards show the command or path and the readable result instead of JSON',()=>{
  const bash=toolState('bash',{command:'git status'},{role:'toolResult',toolName:'bash',content:[{type:'text',text:'On branch main'}]});
  assert.deepEqual(toolPresentation(bash),{label:'bash',detail:'git status',body:'On branch main'});

  const write=toolState('write',{path:'src/a.ts',content:'export const a = 1;'},{role:'toolResult',toolName:'write',content:[{type:'text',text:'Successfully wrote to src/a.ts'}]});
  assert.equal(toolPresentation(write).label,'write');
  assert.equal(toolPresentation(write).detail,'src/a.ts');
  assert.equal(toolPresentation(write).body,'export const a = 1;');

  const edit=toolState('edit',{path:'src/a.ts',edits:[]},{role:'toolResult',toolName:'edit',content:[{type:'text',text:'Successfully replaced 1 block(s)'}],details:{diff:'-old\n+new'}});
  assert.equal(toolPresentation(edit).detail,'src/a.ts');
  assert.equal(toolPresentation(edit).body,'-old\n+new');

  const unknown=toolState('grep',{pattern:'x'},{role:'toolResult',toolName:'grep',content:[{type:'text',text:'match'}]});
  assert.deepEqual(toolPresentation(unknown),{label:'grep',detail:''});
});

test('read tool titles use the requested line range from the call arguments',()=>{
  const result={role:'toolResult',toolName:'read',content:[{type:'text',text:'line'}]};
  assert.equal(toolPresentation(toolState('read',{path:'src/a.ts',offset:6,limit:40},result)).detail,'src/a.ts  6-45');
  assert.equal(toolPresentation(toolState('read',{path:'src/a.ts',offset:6},result)).detail,'src/a.ts  from 6');
  assert.equal(toolPresentation(toolState('read',{path:'src/a.ts',limit:40},result)).detail,'src/a.ts  1-40');
  assert.equal(toolPresentation(toolState('read',{path:'src/a.ts'},result)).detail,'src/a.ts');
});

test('edit diff rows pair removed and added lines for character highlights',()=>{
  const rows=editDiffRows(' 11 keep();\n-12 const b = 2;\n+12 const b = 3;\n 13 }');
  assert.equal(rows.length,4);
  assert.equal(rows[1].marker,'-');
  assert.equal(rows[1].prefix,'-12 ');
  assert.equal(rows[2].marker,'+');
  assert.equal(rows[2].prefix,'+12 ');
  assert.deepEqual(rows[1].segments.filter(segment=>segment.changed).map(segment=>segment.text),['2']);
  assert.deepEqual(rows[2].segments.filter(segment=>segment.changed).map(segment=>segment.text),['3']);
  assert.equal(rows[0].segments.map(segment=>segment.text).join(''),'keep();');
  const elided=editDiffRows('     ...\n-1 old\n+1 new');
  assert.equal(elided[0].segments.map(segment=>segment.text).join(''),'...');
});

test('snapshot refresh drops bash history once its message is recorded',()=>{
  const recorded={command:'git status',output:'ok',status:'done' as const,excludeFromContext:false,startedAt:100,exitCode:0};
  const pending={command:'git branch',output:'main',status:'done' as const,excludeFromContext:false,startedAt:200,exitCode:0};
  const previous={...withSnapshot({...snapshot,status:'running'}),bashHistory:[recorded,pending]};
  const refreshed=withSnapshot({...snapshot,messages:[
    {role:'bashExecution',command:'git status',output:'ok',exitCode:0,cancelled:false,truncated:false,excludeFromContext:false,timestamp:150},
  ]},previous);
  assert.deepEqual(refreshed.bashHistory?.map(item=>item.command),['git branch']);
});

test('snapshot refresh keeps a running tool start time',()=>{
  const messages=[{role:'assistant',content:[{type:'toolCall',id:'call_1',name:'bash',arguments:{command:'sleep 10'}}]}];
  const first=withSnapshot({...snapshot,messages});
  const running={...first,tools:first.tools.map(tool=>({...tool,startedAt:1000}))};
  const refreshed=withSnapshot({...snapshot,messages},running);
  assert.equal(refreshed.tools.length,1);
  assert.equal(refreshed.tools[0].startedAt,1000);
  assert.equal(refreshed.tools[0].durationMs,undefined);
});

test('ask_user cards retain submitted answers and distinguish interruption from a negative answer',()=>{
  const questions=[
    {id:'tool',prompt:'Package manager?',options:[{label:'PNPM',value:'pnpm'}]},
    {id:'review',type:'confirm',prompt:'Review?'},
    {id:'notes',type:'editor',prompt:'Notes'},
  ];
  const answers=[{id:'tool',value:'pnpm',label:'PNPM'},{id:'review',value:false,label:'No'}];
  const tool:ToolState={id:'qa',runKey:'run',name:'ask_user',status:'done',args:{questions}};
  for(const [reason,status] of [['timeout','timed out'],['cancelled','cancelled']]){
    const view=askUserPresentation({...tool,result:{details:{answers,reason,cancelled:true,interruptedQuestionId:'notes'}}});
    assert.equal(view.detail,'select: Package manager? user: PNPM');
    assert.equal(view.status,status);
    assert.deepEqual(view.questions[1].choices.map(choice=>choice.selected),[false,true]);
    assert.equal(view.questions[2].interruption,status);
  }
  const input=askUserPresentation({...tool,args:{questions:[questions[2]]},result:{details:{answers:[{id:'notes',value:'First\n  second'}]}}});
  assert.equal(input.detail,'editor: Notes user: First…');
  assert.deepEqual(input.questions[0].written,['First\n  second']);
});

test('a recorded bash keeps its start time across refreshes when a user message arrives during execution',()=>{
  const command='git status';
  const previous={...withSnapshot(snapshot),bashHistory:[{command,output:'',startedAt:10,status:'done' as const,excludeFromContext:false}]};
  const history={...snapshot,messages:[{role:'user',content:'Next',timestamp:15},{role:'bashExecution',command,exitCode:0,timestamp:20}]};
  const refreshed=withSnapshot(history,previous);
  const run=buildRuns(withSnapshot(history,refreshed))[0];
  assert.equal(run.userTimestamp,15);
  assert.equal(run.items[0].bash?.startedAt,10);
});
