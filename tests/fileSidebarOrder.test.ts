import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveFileSidebarItem, OPEN_EDITORS_KEY, reconcileFileSidebarOrder } from '../src/fileSidebarOrder';

test('file sidebar order starts with Open Editors and appends projects',()=>{
  assert.deepEqual(reconcileFileSidebarOrder([],['C:/one','C:/two']),
    [OPEN_EDITORS_KEY,'C:/one','C:/two']);
});

test('file sidebar order preserves custom positions by project root',()=>{
  const saved=['C:/two',OPEN_EDITORS_KEY,'C:/one'];
  assert.deepEqual(reconcileFileSidebarOrder(saved,['C:/one','C:/two']),saved);
});

test('file sidebar order drops closed projects and appends new projects',()=>{
  const saved=['C:/two',OPEN_EDITORS_KEY,'C:/closed'];
  assert.deepEqual(reconcileFileSidebarOrder(saved,['C:/two','C:/new']),
    ['C:/two',OPEN_EDITORS_KEY,'C:/new']);
});

test('file sidebar items move before and after another top-level item',()=>{
  const order=[OPEN_EDITORS_KEY,'C:/one','C:/two'];
  assert.deepEqual(moveFileSidebarItem(order,'C:/two',OPEN_EDITORS_KEY,false),
    ['C:/two',OPEN_EDITORS_KEY,'C:/one']);
  assert.deepEqual(moveFileSidebarItem(order,OPEN_EDITORS_KEY,'C:/two',true),
    ['C:/one','C:/two',OPEN_EDITORS_KEY]);
});
