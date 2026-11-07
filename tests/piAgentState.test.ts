import assert from 'node:assert/strict';
import test from 'node:test';
import { formatAgentTokens, formatContextPercent, formatToolDuration, updateEvent, withSnapshot } from '../src/AgentChat';
import type { PiSessionSnapshot } from '../shared/piTypes';
import { calculatePiCacheHitPercent, countPiSessionRuns } from '../shared/piSession';

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
