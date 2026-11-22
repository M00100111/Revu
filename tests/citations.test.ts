import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {CitationBubble} from '../src/CitationView';
import {snapshotLines} from '../src/CitationCode';
import {buildRuns,withSnapshot} from '../src/AgentChat';
import {citePath,copyReference,inputText,locateCitation,packInput,referenceText,references,shiftSelections,unpackInput} from '../shared/citations';

const selected={path:'some dir/price.ts',language:'typescript',text:'price',startLine:12,startColumn:8,endLine:13,endColumn:1,offset:0};
const token=referenceText(selected.path,selected);
test('snapshot display dedents only known complete lines and retains the original text and line endings',()=>{
  const text='\t  if (ok) {\r\n\t    run();\r\n\r\n\t  }';
  const selection={...selected,text,startColumn:1,endColumn:5,wholeLines:true};
  const {lines,indent}=snapshotLines(selection);
  assert.equal(indent,'\t  ');assert.equal(lines.length,4);
  assert.equal(lines.map(line=>line.text+line.eol).join(''),text);
  assert.equal(snapshotLines({...selection,wholeLines:false}).indent,'');
  assert.equal(snapshotLines({...selection,wholeLines:undefined}).indent,'');
  const legacy=snapshotLines({...selection,wholeLines:undefined,text:text+'\r\n',endColumn:1});
  assert.equal(legacy.indent,indent);assert.equal(legacy.lines.length,4);
  assert.equal(snapshotLines({...selection,wholeLines:undefined,startColumn:2,endColumn:1}).indent,'');
});
test('half-open selections preserve partial lines, escaped paths and duplicate token edits',()=>{
  assert.equal(token,'@"some dir/price.ts"#L12');assert.equal(references(referenceText('quote".ts'))[0].path,'quote".ts');
  const second={...selected,text:'later',offset:token.length+1};const both=token+' '+token;
  assert.deepEqual(shiftSelections(both,token,[selected,second],0),[{...second,offset:0}]);
  assert.deepEqual(shiftSelections(both,token,[selected,second],token.length),[selected]);
  assert.equal(shiftSelections(token,'hello '+token,[selected],6)[0].offset,6);
  assert.deepEqual(shiftSelections(token,'plain text',[selected]),[]);
});
test('queued snapshots have distinct delivery IDs even for identical text; plain input has no attachment',()=>{
  const first=packInput(token,[selected]),second=packInput(token,[{...selected,text:'new version'}]);
  assert.notEqual(unpackInput(first)?.deliveryId,unpackInput(second)?.deliveryId);assert.equal(inputText(first),token);
  assert.equal(packInput(token,[]),token);assert.equal(inputText(packInput(first,[])),first);
});
test('history joins cite records by ID, not equal message text or adjacency',()=>{
  const user=(id:string)=>({role:'user',content:token,revuDeliveryId:id,timestamp:1});
  const cite=(id:string,text:string)=>({role:'custom',customType:'cite',display:false,details:{deliveryId:id,selections:[{...selected,contentIndex:1}]},content:[{type:'text',text:'Selection:'},{type:'text',text}]});
  const state=withSnapshot({projectId:'p',sessionId:'s',name:'s',status:'idle',thinkingLevel:'medium',availableThinkingLevels:[],autoCompactionEnabled:false,isCompacting:false,messages:[user('first'),user('second'),cite('second','b'),cite('first','a')]});
  assert.deepEqual(buildRuns(state).map(run=>[run.user,run.selections?.[0].text,run.items.length]),[[token,'a',0],[token,'b',0]]);
});
test('collapsed user bubble shows references and skill name, never the hidden content or a bottom collapse button',()=>{
  const prefix='<skill name="example" location="/SKILL.md">\nprivate body\n</skill>\n\nExplain ';
  const html=renderToStaticMarkup(createElement(CitationBubble,{text:prefix+token,epoch:'s',selections:[{...selected,offset:prefix.length}],onCopy:()=>{},onGoto:()=>{}}));
  assert.match(html,/\/example/);assert.match(html,/Explain/);assert.match(html,/price.ts:12/);assert.match(html,/Copy reference/);assert.match(html,/View snapshot/);assert.doesNotMatch(html,/private body|Collapse Input|Edit reference|Delete reference/);
});
test('cross-project Cite stays absolute and Go to follows the longest open root, not the chat',()=>{
  const chat={root:'C:\\Work\\Test1'},other={root:'D:\\Test2'},nested={root:'D:\\Test2\\nested'};
  const request={projectId:'other',path:'src/price.ts'};
  assert.equal(citePath(chat.root,chat.root,request),'src/price.ts');
  const path=citePath(other.root,chat.root,request);
  assert.equal(path,'D:/Test2/src/price.ts');
  assert.deepEqual(locateCitation(path,chat,[chat,other]),{project:other,path:'src/price.ts'});
  assert.deepEqual(locateCitation(path,chat,[chat]),{project:undefined,path});
  assert.equal(locateCitation('d:/test2/NESTED/name',chat,[chat,other,nested]).project,nested);
  assert.equal(locateCitation('d:/test20/name',chat,[other]).project,undefined);
  assert.equal(citePath(other.root,chat.root,{...request,path:'.',directory:true}),'D:/Test2/');
  assert.equal(locateCitation('src/price.ts',chat,[other]).project,chat);
});
test('reference copy round trips curly and straight quotes without inventing snapshots',()=>{
  for(const text of ['@“some dir/price.ts”#L12-L14','@"some dir/price.ts"#L12-L14','@“docs/”','@“D:\\work\\a.txt”']){
    const [original]=references(text),wire=copyReference(original),[restored]=references(wire);
    assert.deepEqual({...restored,raw:text},original);assert.equal(packInput(wire,[]),wire);
  }
});
