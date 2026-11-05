import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countTabRows, defaultTabExpansion, nextTabExpansion } from '../src/tabLayout';

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
