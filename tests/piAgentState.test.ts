import assert from 'node:assert/strict';
import test from 'node:test';
import { updateEvent, withSnapshot } from '../src/AgentChat';
import type { PiSessionSnapshot } from '../shared/piTypes';

const snapshot:PiSessionSnapshot={
  sessionId:'session-a',projectId:'project-a',status:'idle',name:'Test',messages:[],
  thinkingLevel:'medium',availableThinkingLevels:['off','medium','high'],
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
  state=updateEvent(state,{type:'tool_execution_update',toolCallId:'tool-1',partialResult:{content:'partial'}});
  state=updateEvent(state,{type:'tool_execution_end',toolCallId:'tool-1',result:{content:'done',isError:false}});
  assert.deepEqual(state.tools,[{id:'tool-1',turnKey:'turn-0',name:'read',status:'done',args:{path:'README.md'},result:{content:'done',isError:false}}]);
});

test('Pi chat state keeps thinking separate and restores tools in their user turn',()=>{
  let state=withSnapshot(snapshot);
  state=updateEvent(state,{type:'message_start',message:{role:'user',content:'Inspect this',timestamp:1}});
  state=updateEvent(state,{type:'message_start',message:{role:'assistant',content:[],timestamp:2}});
  state=updateEvent(state,{type:'message_update',assistantMessageEvent:{type:'thinking_delta',delta:'Checking files'}});
  assert.equal(state.streamThinking,'Checking files');
  assert.equal(state.streamText,'');

  const restored=withSnapshot({...snapshot,messages:[
    {role:'user',content:'Inspect this',timestamp:1},
    {role:'assistant',content:[{type:'thinking',thinking:'Checking files'},{type:'toolCall',id:'tool-1',name:'read',arguments:{path:'README.md'}}],timestamp:2},
    {role:'toolResult',toolCallId:'tool-1',toolName:'read',content:[{type:'text',text:'done'}],isError:false,timestamp:3},
  ]});
  assert.equal(restored.streamThinking,'');
  assert.deepEqual(restored.tools,[{
    id:'tool-1',turnKey:'turn-0',name:'read',status:'done',args:{path:'README.md'},
    result:{role:'toolResult',toolCallId:'tool-1',toolName:'read',content:[{type:'text',text:'done'}],isError:false,timestamp:3},
  }]);
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
