import assert from 'node:assert/strict';
import { HANDLE, avoidTaken, clampHandleY, handleLeft, maxHandleTop } from '../src/placement.js';

let failed = 0;
let passed = 0;
const check = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`  ok ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${name}`);
    console.error(err);
  }
};

check('clampHandleY：没传位置时落在中段，有位置时夹进范围', () => {
  assert.equal(clampHandleY(undefined, { top: 8, maxTop: 400, height: 88 }), 204);
  assert.equal(clampHandleY(-50, { top: 8, maxTop: 400 }), 8);
  assert.equal(clampHandleY(999, { top: 8, maxTop: 400 }), 400);
  assert.equal(clampHandleY(123.6, { top: 8, maxTop: 400 }), 124);
});

check('maxHandleTop：按输入栏顶边收，没输入栏时退回视口底部', () => {
  assert.equal(maxHandleTop({ viewportHeight: 800, sendFormTop: 700, height: 88, gap: 8 }), 604);
  assert.equal(maxHandleTop({ viewportHeight: 800, height: 88 }), 632);
  // 输入栏太矮（异常值）时不采用它
  assert.equal(maxHandleTop({ viewportHeight: 800, sendFormTop: 20, height: 88 }), 632);
});

check('avoidTaken：撞上别的球就往上让，上方没地方就往下', () => {
  const taken = [{ top: 300, bottom: 352 }];
  assert.equal(avoidTaken(320, taken, { height: 88, gap: 8, min: 0, max: 600 }), 204);
  assert.equal(avoidTaken(320, taken, { height: 88, gap: 8, min: 400, max: 600 }), 360);
  // 不重叠就不动
  assert.equal(avoidTaken(100, taken, { height: 88, gap: 8, min: 0, max: 600 }), 100);
});

check('handleLeft：展开时贴在面板左缘，只露 peek 宽', () => {
  assert.equal(handleLeft({ panelLeft: 900, width: 22, peek: 12 }), 890);
  assert.equal(handleLeft({ panelLeft: 4, width: 22, peek: 12 }), 0);
  assert.equal(HANDLE.width - HANDLE.peek, 10);
});

console.log(`\nplacement.test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
