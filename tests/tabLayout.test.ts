import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countTabRows, defaultTabExpansion, nextTabExpansion } from '../src/tabLayout';
import { fileMenuTargets, updateFileTabs, type FileTabs } from '../src/editorTabs';

test('layout switches preserve previews and the next open replaces only the most recent in scope',()=>{
  let tabs:FileTabs={ids:[],previews:[]};
  const open=(projectId:string,name:string,mixed:boolean)=>{
    tabs=updateFileTabs(tabs,{type:'open',id:projectId+'/'+name,projectId,mode:'preview',mixed});
  };
  open('a','one',false);open('b','two',false);
  tabs=updateFileTabs(tabs,{type:'activate',id:'a/one'});
  open('b','three',true);
  assert.deepEqual(tabs.ids,['b/three','b/two']);
  open('a','four',false);
  assert.deepEqual(tabs.previews,['a/four','b/three','b/two']);
  open('b','five',false);
  assert.deepEqual(tabs.ids,['b/five','b/two','a/four']);
  tabs=updateFileTabs(tabs,{type:'keep',id:'b/five'});
  open('b','six',false);
  assert.deepEqual(tabs.ids,['b/five','b/six','a/four']);
});

test('file menu scope follows the clicked group including Other',()=>{
  const tabs=[{id:'1',groupId:'a'},{id:'2',groupId:'b'},{id:'3',groupId:null},{id:'4',groupId:null}];
  assert.deepEqual(fileMenuTargets(tabs,tabs[1],'closeAll',false),[tabs[1]]);
  assert.deepEqual(fileMenuTargets(tabs,tabs[2],'closeOthers',false),[tabs[3]]);
  assert.deepEqual(fileMenuTargets(tabs,tabs[2],'closeAll',true),tabs);
});

test('file tab rows are calculated from actual item widths',()=>{
  assert.equal(countTabRows([100,100,100],300),1);
  assert.equal(countTabRows([100,100,100],250),2);
  assert.equal(countTabRows([500,100],250),2);
});

test('scroll overflow cycles through one row, four rows and all rows',()=>{
  assert.equal(defaultTabExpansion('scroll'),'single');
  assert.equal(nextTabExpansion('scroll','single',6),'limited');
  assert.equal(nextTabExpansion('scroll','limited',6),'all');
  assert.equal(nextTabExpansion('scroll','all',6),'single');
  assert.equal(nextTabExpansion('scroll','limited',3),'single');
});

test('automatic wrapping stays capped until all rows are requested',()=>{
  assert.equal(defaultTabExpansion('wrap'),'limited');
  assert.equal(nextTabExpansion('wrap','limited',6),'all');
  assert.equal(nextTabExpansion('wrap','all',6),'limited');
});
