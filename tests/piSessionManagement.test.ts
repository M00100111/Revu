import assert from 'node:assert/strict';
import test from 'node:test';
import { derivedPiSessionName, threadPiSessions } from '../shared/piSession';
import { searchPiSessions, type PiSessionSearchDocument } from '../shared/piSessionSearch';

const document=(id:string,name:string,firstMessage:string,allMessagesText:string,modifiedAt:number):PiSessionSearchDocument=>({
  summary:{id,projectId:'project-a',name,firstMessage,createdAt:modifiedAt-100,modifiedAt,runCount:1,status:'idle'},
  allMessagesText,
});

test('fork and clone names use unique parenthesized suffixes',()=>{
  assert.equal(derivedPiSessionName('Review API','Fork',[]),'Review API (Fork)');
  assert.equal(derivedPiSessionName('Review API (Fork)','Fork',['Review API (Fork)']),'Review API (Fork 2)');
  assert.equal(derivedPiSessionName('Review API','Clone',['Review API (Clone)','Review API (Clone 2)']),'Review API (Clone 3)');
});

test('relevant conversation search ranks title, content, then fuzzy title matches',()=>{
  const documents=[
    document('content','Notes','General notes','Discuss authentication flow',30),
    document('fuzzy','Authentication Design','','',40),
    document('title','Auth','Exact title','Unrelated',20),
  ];
  assert.deepEqual(searchPiSessions(documents,'auth','relevance').map(item=>item.id),['title','content','fuzzy']);
  assert.match(searchPiSessions(documents,'authentication flow','relevance')[0].matchSnippet??'',/authentication flow/i);
});

test('recent conversation search keeps matches ordered by modification time',()=>{
  const documents=[document('old','Alpha','','shared term',10),document('new','Beta','','shared term',20)];
  assert.deepEqual(searchPiSessions(documents,'shared','recent').map(item=>item.id),['new','old']);
});

test('threaded conversations keep descendants together and sort by subtree activity',()=>{
  const sessions=[
    {...document('root-a','Root A','','',10).summary,modifiedAt:10},
    {...document('child-a','Child A','','',40).summary,parentSessionId:'root-a',modifiedAt:40},
    {...document('root-b','Root B','','',30).summary,modifiedAt:30},
    {...document('orphan','Orphan','','',20).summary,parentSessionId:'missing',modifiedAt:20},
  ];
  const threaded=threadPiSessions(sessions);
  assert.deepEqual(threaded.map(item=>[item.session.id,item.depth]),[['root-a',0],['child-a',1],['root-b',0],['orphan',0]]);
  assert.deepEqual(threaded.find(item=>item.session.id==='child-a')?.ancestorContinues,[]);
});
