import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {ExtensionAPI,ExtensionToolContext} from '@earendil-works/pi-coding-agent';
import {compile,type JsonSchema} from '@earendil-works/pi-schema';
import pinCode from '../pi-extensions/pin-code';
import {advancePins,changePin,showPins,codeReferences,pinPiece,type CodeReference,type PinSource} from '../shared/codePins';
import {locatePins} from '../shared/pinLayout';
import {parsePatch} from '../shared/review';
import {git} from '../server/git';
import {buildRuns,updateEvent,withSnapshot} from '../src/AgentChat';
import {renderMarkdown} from '../src/MarkdownContent';
import {placementsFor} from '../src/useCodePins';
import type {OpenFile} from '../src/editor';
import {dashboardChunks} from '../src/ReviewDashboard';

const reference:CodeReference={href:'revu-code:sample-0',path:'src/file.ts',startLine:1,endLine:5,hash:'a'.repeat(64),note:'Note'};
const source:PinSource={sessionId:'chat',projectId:'project',messageId:'assistant:3',references:[reference]};
const userMessage=(timestamp:number)=>({role:'user',timestamp,content:'Explain this file'});
const answerMessage=(timestamp:number,text:string)=>({role:'assistant',timestamp,content:[{type:'text',text}]});
const callMessage=(timestamp:number,...ids:string[])=>({role:'assistant',timestamp,content:ids.map(id=>({type:'toolCall',name:'pin_code',id}))});
const pinResult=(timestamp:number,id:string,references:CodeReference[],isError=false)=>({role:'toolResult',timestamp,toolName:'pin_code',toolCallId:id,details:{references},isError});
const chat=(messages:unknown[])=>withSnapshot({
  projectId:'project',sessionId:'chat',status:'idle',name:'Chat',thinkingLevel:'off',availableThinkingLevels:[],
  autoCompactionEnabled:false,isCompacting:false,messages,
});
const answersFrom=(state:ReturnType<typeof chat>)=>buildRuns(state).flatMap(run=>run.items).filter(item=>item.type==='answer');
function pinToolFixture(){
  let definition!: {
    name:string;parameters:JsonSchema;prepareArguments:(input:unknown)=>{references:unknown[]};
    execute:(id:string,params:unknown,signal:undefined,update:undefined,ctx:ExtensionToolContext)=>Promise<{
      isError:boolean;content:{text:string}[];details:{references:CodeReference[];results:unknown[];summary:unknown};
    }>;
  };
  pinCode({registerTool:(tool:unknown)=>{definition=tool as typeof definition;}} as unknown as ExtensionAPI);
  const validator=compile(definition.parameters,{coerce:true,unresolvedRefs:'reject'});
  const prepare=(input:unknown)=>{
    const result=validator.parse(structuredClone(definition.prepareArguments(input)));
    if(!result.ok)throw new Error(JSON.stringify(result.errors));
    return result.value;
  };
  return {name:definition.name,prepare,execute:(cwd:string,input:unknown)=>
    definition.execute('call',prepare(input),undefined,undefined,{cwd} as ExtensionToolContext)};
}

test('only registered code references become editor links, independent of external links',()=>{
  const text='[file.ts:1-5](revu-code:sample-0) [unknown](revu-code:other-0) [web](https://example.com/file.ts#L1-L5) [relative](src/file.ts#L1-L5)';
  const html=renderMarkdown(text,[reference]);
  assert.match(html,/class="agent-code-reference" href="revu-code:sample-0"/);
  assert.match(html,/href="https:\/\/example\.com\/file\.ts#L1-L5".*target="_blank"/);
  assert.doesNotMatch(html,/href="(?:revu-code:other-0|src\/file\.ts)/);
  assert.match(html,/<span>unknown \(Invalid code reference\)<\/span>/);
  assert.doesNotMatch(renderMarkdown(text),/Invalid code reference/);
});

test('only successful matching tool calls authorize citations, and only after the result arrives',()=>{
  const link='[file.ts:1-5](revu-code:sample-0)';
  const answers=answersFrom(chat([
    userMessage(1),callMessage(2,'failed','valid'),
    pinResult(3,'unmatched',[reference]),pinResult(3,'failed',[reference],true),
    answerMessage(4,link),
    pinResult(5,'valid',[reference]),
    answerMessage(6,link+' and `[file.ts:1-5](revu-code:sample-0)`'),
    answerMessage(7,'```md\n'+link+'\n```'),
  ]));
  assert.deepEqual(answers.map(item=>item.pinSource?.references.length),[0,1,0]);
  assert.equal(answers[1].pinSource?.messageId,'assistant:6');
});

test('a later user turn cannot reuse old IDs or results from delayed calls, but history stays valid',()=>{
  const link='[file.ts:1-5](revu-code:sample-0)';
  const answers=answersFrom(chat([
    userMessage(1),callMessage(2,'old','delayed'),pinResult(3,'old',[reference]),answerMessage(4,link),
    userMessage(5),pinResult(6,'delayed',[reference]),answerMessage(7,link),
  ]));
  assert.deepEqual(answers.map(item=>item.pinSource?.references),[[reference],[]]);
  assert.match(renderMarkdown(answers[0].text!,answers[0].pinSource?.references),/agent-code-reference/);
  const reused=renderMarkdown(answers[1].text!,answers[1].pinSource?.references);
  assert.match(reused,/Invalid code reference/);
  assert.doesNotMatch(reused,/<a\b/);
});

test('same-turn IDs reject mismatched filenames and ranges even when a valid link shares the ID',()=>{
  const other={...reference,href:'revu-code:sample-1',path:'src/other.ts'};
  const later={...reference,href:'revu-code:sample-2',startLine:10,endLine:12};
  const [answer]=answersFrom(chat([
    userMessage(1),callMessage(2,'batch'),pinResult(3,'batch',[reference,other,later]),
    answerMessage(4,'[file.ts:1-5](revu-code:sample-1) [file.ts:1-5](revu-code:sample-2) [file.ts:1-4](revu-code:sample-0) [`file.ts:1-5`](revu-code:sample-0)'),
  ]));
  assert.deepEqual(answer.pinSource?.references,[reference]);
  const html=renderMarkdown(answer.text!,answer.pinSource?.references);
  assert.equal(html.match(/class="agent-code-reference"/g)?.length,1);
  assert.equal(html.match(/Invalid code reference/g)?.length,3);
  assert.doesNotMatch(html,/href="revu-code:sample-[12]"/);
});

test('parallel tool results with the same timestamp each authorize their own link',()=>{
  const other={...reference,href:'revu-code:second-0',path:'src/other.ts'};
  let state=chat([userMessage(1),callMessage(2,'first','second')]);
  for(const message of [
    pinResult(3,'first',[reference]),pinResult(3,'second',[other]),
    answerMessage(4,'[file.ts:1-5](revu-code:sample-0) [other.ts:1-5](revu-code:second-0)'),
  ])state=updateEvent(state,{type:'message_end',message});
  assert.deepEqual(answersFrom(state)[0].pinSource?.references,[reference,other]);
});

test('working-side ranges split around multiple changes and never attach to a deletion',()=>{
  const before='one\nold\nthree\ndeleted\nfive\n';
  const after='one\nnew\nthree\nfive\nadded\n';
  const chunks=parsePatch('@@ -2 +2 @@\n@@ -4 +3,0 @@\n@@ -5,0 +5 @@',before,after);
  const placements=locatePins({source,reference},after,after,chunks,false);
  assert.deepEqual(placements.map(pin=>[pin.startLine,pin.endLine,pin.chunkId]),[[1,1,undefined],[2,2,'0'],[3,4,undefined],[5,5,'2']]);
  assert.deepEqual(locatePins({source,reference:{...reference,startLine:2,endLine:2}},after,after,chunks,false).map(pin=>pin.chunkId),['0']);
});

test('the Chunks list merges independent pins with review items and deduplicates attached notes',()=>{
  const before='one\nold\nthree\n',after='one\nnew\nthree\n';
  const chunks=parsePatch('@@ -2 +2 @@',before,after);
  const file={chunks,records:[]};
  const target={source,reference:{...reference,endLine:3}};
  const placements=locatePins(target,after,after,chunks,false);
  const result=dashboardChunks(file,[...placements,placements[1]]);
  assert.deepEqual(result.items.map(item=>[item.line,'reference' in item?'pin':item.kind]),[[1,'pin'],[2,'modify'],[3,'pin']]);
  assert.deepEqual([...result.notes.get(chunks[0].id)??[]],['Note']);
  assert.equal(file.chunks.length,1);
  assert.deepEqual(dashboardChunks(file,[]),{items:chunks,notes:new Map()});
  assert.equal(dashboardChunks({...file,chunks:[]},[placements[0]]).items.length,1);
});

test('base-side citations attach to deleted code and map unchanged ranges around inserted rows',()=>{
  const before='one\nold\nthree\ndeleted\nfive\n';
  const after='one\nnew\ninserted\nthree\nfive\n';
  const chunks=parsePatch('@@ -2 +2,2 @@\n@@ -4 +4,0 @@',before,after);
  const placements=locatePins({source,reference},before,after,chunks,true);
  assert.deepEqual(placements.map(pin=>[pin.startLine,pin.line,pin.chunkId]),[
    [1,1,undefined],[2,2,'0'],[3,4,undefined],[4,5,'1'],[5,5,undefined],
  ]);
  const insertion=parsePatch('@@ -1,0 +2 @@','one\ntwo','one\nadded\ntwo');
  assert.deepEqual(locatePins({source,reference:{...reference,endLine:2}},'one\ntwo','one\nadded\ntwo',insertion,true).map(pin=>[pin.startLine,pin.line]),[[1,1],[2,3]]);
});

test('showing history, advancing and hiding clear transient annotations but not kept pieces',()=>{
  const piece=pinPiece({source,reference},1,2);
  const initial=advancePins(undefined,source);
  const kept=changePin(initial,piece,'keep');
  assert.equal(kept.hidden.has(piece.id),true);
  const next={...source,messageId:'assistant:4',references:[]};
  const advanced=advancePins(kept,next);
  assert.deepEqual(advanced.source?.references,[]);
  const history=showPins(advanced,source);
  assert.equal(advancePins(history,next),history);
  const hidden=showPins(history);
  assert.deepEqual(hidden.kept,[piece]);
  assert.deepEqual(advancePins(undefined,{...source,sessionId:'other'}).kept,[]);
  const closed=changePin(hidden,piece,'close');
  assert.deepEqual(closed.kept,[]);
  assert.equal(showPins(closed,source).hidden.size,0);
});

test('the editor does not attach a citation to a mismatched snapshot or unsaved buffer',()=>{
  const exact={...reference,endLine:1};
  const target={source,reference:exact};
  const file={
    project:{id:'project'},path:reference.path,model:{getValue:()=>'modified\n'},
    synced:{hash:reference.hash,text:'original\n'},draftExists:true,chunks:[],records:[],
  } as unknown as OpenFile;
  assert.equal(placementsFor(file,target),undefined);
  file.model.getValue=()=>file.synced.text;
  assert.equal(placementsFor(file,target)?.[0].preview,'original');
  const oldTarget={source,reference:{...exact,revision:'b'.repeat(40)}};
  assert.equal(placementsFor(file,oldTarget),undefined);
  assert.equal(placementsFor(file,oldTarget,true)?.[0].preview,'original');
  file.computing=true;
  assert.deepEqual(placementsFor(file,target),[]);
  const phantom={source,reference:{...exact,startLine:2,endLine:2}};
  assert.equal(placementsFor(file,phantom),undefined);
  file.computing=false;
  assert.deepEqual(placementsFor(file,phantom),[]);

  const gbTarget={source,reference:{...exact,encoding:'gb18030' as const}};
  assert.equal(placementsFor(file,gbTarget),undefined);
  assert.equal(placementsFor(file,gbTarget,true),undefined);
  file.synced={...file.synced,encoding:'gb18030',text:'中文\n'};
  assert.equal(placementsFor(file,gbTarget,true)?.[0].preview,'中文');
  assert.equal(placementsFor(file,target,true),undefined);
});

test('pin_code fingerprints both working files and exact Git revisions and validates line ranges',async context=>{
  const root=await mkdtemp(join(tmpdir(),'revu-pins-'));
  context.after(()=>rm(root,{recursive:true,force:true}));
  const cwd=join(root,'project');await mkdir(cwd);
  const path='file [test] & refs_.ts';
  const oldText='old first\nold second\r\n',currentText='current\n';
  await writeFile(join(cwd,path),oldText);
  await mkdir(join(cwd,'src'));
  await writeFile(join(cwd,'src','source.ts'),'const value = 1;');
  await writeFile(join(cwd,'src','too-large.txt'),Buffer.alloc(8*1024*1024+1,'x'));
  await git(root,['init','-q']);
  await git(root,['-c','core.autocrlf=false','add','--','project']);
  await git(root,['-c','user.name=Test','-c','user.email=test@example.test','commit','-qm','Fixture']);
  const revision=(await git(root,['rev-parse','HEAD'])).toString().trim();
  await writeFile(join(cwd,path),currentText);
  const tool=pinToolFixture();
  const result=await tool.execute(cwd,{references:[
    {path,startLine:1,endLine:1,note:'  Remark  '},
    {path,startLine:10,endLine:11},
    {path,startLine:1,endLine:2,revision},
    {path:'../project/'+path,startLine:1,endLine:1},
  ]});
  const valid=codeReferences(result.details);
  assert.equal(tool.name,'pin_code');
  assert.equal(result.isError,false);
  assert.deepEqual(valid.map(ref=>ref.hash),[currentText,oldText].map(text=>createHash('sha256').update(text).digest('hex')));
  assert.deepEqual(valid.map(ref=>ref.revision),[undefined,revision]);
  assert.equal(valid[0].note,'Remark');
  assert.match(valid[0].href,/^revu-code:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}-\d+$/);
  assert.deepEqual(result.details.results,[
    {index:0,ok:true,href:valid[0].href},
    {index:1,ok:false,field:'startLine',path,error:'expected a line number from 1 to 1.'},
    {index:2,ok:true,href:valid[1].href},
    {index:3,ok:false,field:'path',error:'expected a project-relative file path.'},
  ]);
  assert.deepEqual(result.details.summary,{total:4,succeeded:2,failed:2});
  const lines=result.content[0].text.split('\n');
  assert.match(lines[0],/^#1 \[/);
  assert.equal(lines[1],`#2 startLine (${path}): expected a line number from 1 to 1.`);
  assert.match(lines[2],/^#3 \[/);
  assert.equal(lines[3],'#4 path: expected a project-relative file path.');
  assert.equal(lines[4],'2/4 references created, 2 failed');
  const links=renderMarkdown(result.content[0].text,valid);
  assert.equal(links.match(/class="agent-code-reference"/g)?.length,2);

  const missingRevision='f'.repeat(revision.length);
  const badPaths=await tool.execute(cwd,{references:[
    {path:'src',startLine:1,endLine:1,revision},
    {path:'missing.ts',startLine:1,endLine:1,revision},
    {path,startLine:1,endLine:1,revision:missingRevision},
    {path:'src\\too-large.txt',startLine:1,endLine:1},
    {path:'src/too-large.txt',startLine:1,endLine:1,revision},
    {path,startLine:1,endLine:1,revision},
  ]});
  assert.deepEqual(badPaths.details.results,[
    {index:0,ok:false,field:'path',path:'src',error:'Path is a directory at that revision.'},
    {index:1,ok:false,field:'path',path:'missing.ts',error:'File does not exist at that revision.'},
    {index:2,ok:false,field:'revision',path,error:'Commit not found in this repository.'},
    {index:3,ok:false,field:'path',path:'src/too-large.txt',error:'File exceeds the 8 MiB limit.'},
    {index:4,ok:false,field:'path',path:'src/too-large.txt',error:'File exceeds the 8 MiB limit.'},
    {index:5,ok:true,href:badPaths.details.references[0].href},
  ]);
  assert.equal(badPaths.isError,false);
  const errors=badPaths.content[0].text;
  assert.deepEqual(errors.split('\n').slice(0,5),[
    '#1 src: Path is a directory at that revision.',
    '#2 missing.ts: File does not exist at that revision.',
    `#3 revision (${path}): Commit not found in this repository.`,
    '#4 src/too-large.txt: File exceeds the 8 MiB limit.',
    '#5 src/too-large.txt: File exceeds the 8 MiB limit.',
  ]);
  assert.doesNotMatch(errors,/fatal:|Command failed|Not a valid object name/);
  assert.ok(!errors.includes(missingRevision));
});

test('pin_code does not count a phantom EOF line and accepts mixed LF and CRLF without changing the hash',async context=>{
  const cwd=await mkdtemp(join(tmpdir(),'revu-pin-lines-'));
  context.after(()=>rm(cwd,{recursive:true,force:true}));
  const cases=[
    {path:'lf.txt',contents:'a\nb\nc\n',lastLine:3},
    {path:'crlf.txt',contents:'a\r\nb\r\n',lastLine:2},
    {path:'mixed.txt',contents:'a\nb\r\nc\n',lastLine:3},
    {path:'blank.txt',contents:'a\n\n',lastLine:2},
    {path:'unterminated.txt',contents:'a\nb',lastLine:2},
    {path:'empty.txt',contents:'',lastLine:1},
  ];
  const invalid=[
    {path:'bare-cr.txt',contents:'a\nb\rc\r\n',field:'path',error:'Unsupported line endings: bare CR.'},
    {path:'binary.txt',contents:'a\0b',field:'path',error:'Binary file. Code references require text.'},
    {path:'bad-utf8.txt',contents:Buffer.from([255]),field:'encoding',error:'Invalid UTF-8 text. For GBK/GB18030 source, set encoding to gb18030.'},
  ];
  for(const {path,contents} of [...cases,...invalid])await writeFile(join(cwd,path),contents);
  const result=await pinToolFixture().execute(cwd,{references:[
    ...cases.flatMap(({path,lastLine})=>[
      {path,startLine:lastLine,endLine:lastLine},{path,startLine:lastLine,endLine:lastLine+1},
    ]),
    ...invalid.map(({path})=>({path,startLine:1,endLine:1})),
  ]});
  const references=codeReferences(result.details);
  assert.deepEqual(references.map(({path,startLine,endLine,hash})=>[path,startLine,endLine,hash]),cases.map(({path,contents,lastLine})=>
    [path,lastLine,lastLine,createHash('sha256').update(contents).digest('hex')]));
  assert.deepEqual(result.details.results.slice(0,cases.length*2).filter((_entry,index)=>index%2===1),cases.map(({path,lastLine},index)=>({
    index:index*2+1,ok:false,field:'endLine',path,error:`expected a line number from 1 to ${lastLine}.`,
  })));
  assert.equal(result.content[0].text.split('\n')[1],'#2 endLine (lf.txt): expected a line number from 1 to 3.');
  assert.deepEqual(result.details.results.slice(cases.length*2),invalid.map(({path,field,error},index)=>({
    index:cases.length*2+index,ok:false,field,path,error,
  })));
  assert.deepEqual(result.content[0].text.split('\n').slice(cases.length*2,-1),invalid.map(({path,field,error},index)=>
    `#${cases.length*2+index+1} ${field==='path'?path:`${field} (${path})`}: ${error}`));
});

test('GB18030 needs explicit opt-in and ./ normalization does not relax the project boundary',async context=>{
  const cwd=await mkdtemp(join(tmpdir(),'revu-pin-gb18030-'));
  context.after(()=>rm(cwd,{recursive:true,force:true}));
  const raw=Buffer.concat([Buffer.from([0xd6,0xd0,0xce,0xc4]),Buffer.from('\r\nsecond\n')]);
  await writeFile(join(cwd,'gbk.txt'),raw);
  await writeFile(join(cwd,'known.PYC'),raw);
  await writeFile(join(cwd,'invalid.txt'),Buffer.from([0x81]));
  const range={path:'./gbk.txt',startLine:1,endLine:2};
  const result=await pinToolFixture().execute(cwd,{references:[
    range,{...range,encoding:'gb18030'},{...range,encoding:'unsupported-encoding'},
    {...range,path:'invalid.txt',endLine:1,encoding:'gb18030'},
    {...range,path:'known.PYC',encoding:'gb18030'},
    ...['./../outside.txt','./.git/config','./C:\\private.txt','/absolute.txt'].map(path=>({...range,path,encoding:'gb18030'})),
  ]});
  const valid=codeReferences(result.details);
  assert.equal(valid.length,1);
  assert.equal(valid[0].path,'gbk.txt');
  assert.equal(valid[0].encoding,'gb18030');
  assert.equal(valid[0].hash,createHash('sha256').update(raw).digest('hex'));
  assert.deepEqual(codeReferences({references:[{...valid[0],encoding:'utf-16le'}]}),[]);
  assert.deepEqual(result.details.results,[
    {index:0,ok:false,field:'encoding',path:'gbk.txt',error:'Invalid UTF-8 text. For GBK/GB18030 source, set encoding to gb18030.'},
    {index:1,ok:true,href:valid[0].href},
    {index:2,ok:false,field:'encoding',path:'gbk.txt',error:'expected utf-8 or gb18030.'},
    {index:3,ok:false,field:'encoding',path:'invalid.txt',error:'Invalid GB18030 text.'},
    {index:4,ok:false,field:'path',path:'known.PYC',error:'Binary file. Code references require text.'},
    ...[5,6,7,8].map(index=>({index,ok:false,field:'path',error:'expected a project-relative file path.'})),
  ]);
  const output=result.content[0].text;
  assert.match(output,/#2 \[gbk\.txt:1-2\]\(revu-code:[^)]+\) \(GB18030\)/);
  assert.match(renderMarkdown(output,valid),/class="agent-code-reference"/);
  assert.doesNotMatch(output,/unsupported-encoding|outside\.txt|\.git\/config|private\.txt|absolute\.txt/);
});

test('invalid entries report the validated path but do not echo invalid parameter values',async context=>{
  const cwd=await mkdtemp(join(tmpdir(),'revu-pin-input-'));
  context.after(()=>rm(cwd,{recursive:true,force:true}));
  const valid={path:'test.ts',startLine:1,endLine:1};
  await writeFile(join(cwd,valid.path),'const test = true;');
  await mkdir(join(cwd,'src'));
  const tool=pinToolFixture();
  const note='not echoed '.repeat(55);
  const references=[
    {...valid,revision:'abcdef1'},
    valid,
    {...valid,note},
    {...valid,startLine:'1'},
    null,
    {path:valid.path,startLine:1},
    {...valid,path:join(cwd,valid.path)},
    {...valid,path:'missing.ts'},
    {...valid,path:'src'},
    valid,
    {...valid,startLine:2,endLine:1},
  ];
  assert.deepEqual(tool.prepare({references}),{references});
  const result=await tool.execute(cwd,{references});
  assert.equal(result.isError,false);
  assert.equal(result.details.references.length,2);
  assert.deepEqual(result.details.results.map(entry=>{
    const {index,ok,field,path}=entry as {index:number;ok:boolean;field?:string;path?:string};
    return [index,ok,field,path];
  }),[
    [0,false,'revision','test.ts'],[1,true,undefined,undefined],[2,false,'note','test.ts'],[3,false,'startLine','test.ts'],
    [4,false,'reference',undefined],[5,false,'endLine','test.ts'],[6,false,'path',undefined],
    [7,false,'path','missing.ts'],[8,false,'path','src'],[9,true,undefined,undefined],[10,false,'endLine','test.ts'],
  ]);
  const lines=result.content[0].text.split('\n');
  assert.deepEqual(lines.map(line=>line.split(' ',1)[0]),['#1','#2','#3','#4','#5','#6','#7','#8','#9','#10','#11','2/11']);
  assert.equal(lines[0],'#1 revision (test.ts): expected a full 40- or 64-character Git commit ID.');
  assert.equal(lines[2],'#3 note (test.ts): expected a string of at most 500 characters.');
  assert.equal(lines[6],'#7 path: expected a project-relative file path.');
  assert.equal(lines[7],'#8 missing.ts: File does not exist (ENOENT).');
  assert.equal(lines[8],'#9 src: Path is a directory.');
  assert.equal(lines[10],'#11 endLine (test.ts): expected an integer at least startLine.');
  assert.doesNotMatch(result.content[0].text,/not echoed|abcdef1|Received arguments|revu-pin-input/);
});

test('a Git lookup failure outside a repository is not reported as a missing commit',async context=>{
  const cwd=await mkdtemp(join(tmpdir(),'revu-pin-no-git-'));
  context.after(()=>rm(cwd,{recursive:true,force:true}));
  const result=await pinToolFixture().execute(cwd,{references:[
    {path:'source.ts',startLine:1,endLine:1,revision:'f'.repeat(40)},
  ]});
  assert.deepEqual(result.details.results,[
    {index:0,ok:false,field:'revision',path:'source.ts',error:'Could not verify the commit in this repository.'},
  ]);
  assert.doesNotMatch(result.content[0].text,/fatal:|not a git repository/);
});

test('invalid batch shape fails before Pi can echo arguments; all failed entries still have results',async()=>{
  const tool=pinToolFixture();
  for(const input of [
    {references:Array.from({length:33},()=>({path:'not echoed'}))},
    {references:[]},
    {references:'not echoed'},
    null,
  ])assert.throws(()=>tool.prepare(input),{message:'references: expected an array of 1–32 entries.'});
  const failed=await tool.execute('',{references:[null]});
  assert.equal(failed.isError,true);
  assert.deepEqual(failed.details,{
    references:[],results:[{index:0,ok:false,field:'reference',error:'expected an object.'}],
    summary:{total:1,succeeded:0,failed:1},
  });
  assert.equal(failed.content[0].text,'#1 reference: expected an object.\n0/1 references created, 1 failed');
});
