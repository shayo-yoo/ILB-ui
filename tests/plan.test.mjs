import assert from 'node:assert/strict';
import { buildPlan, evalCond, evalWhen, formatValue, ratioOf } from '../src/plan.js';

let n = 0;
function check(name, fn) {
  fn();
  n += 1;
  console.log(`  ok ${name}`);
}

console.log('plan.test');

check('formatValue：数字去多余小数、带前后缀', () => {
  assert.equal(formatValue(12), '12');
  assert.equal(formatValue(1.234), '1.23');
  assert.equal(formatValue(1.5, { decimals: 2 }), '1.50');
  assert.equal(formatValue(3, { prefix: '$', suffix: ' G' }), '$3 G');
});

check('formatValue：字符串、布尔、空值', () => {
  assert.equal(formatValue('平静'), '平静');
  assert.equal(formatValue(''), '（空）');
  assert.equal(formatValue(true), '是');
  assert.equal(formatValue(undefined), '—');
  assert.equal(formatValue(null), '—');
  assert.equal(formatValue(NaN), '—');
});

check('evalCond：数字字符串比较', () => {
  assert.equal(evalCond({ var: 'x', op: '=', value: 3 }, { x: '3' }), true);
  assert.equal(evalCond({ var: 'x', op: '>', value: 3 }, { x: 4 }), true);
  assert.equal(evalCond({ var: 'x', op: '<=', value: 3 }, { x: 4 }), false);
});

check('evalCond：文本精确比较', () => {
  assert.equal(evalCond({ var: 'x', op: '=', value: '平静' }, { x: '平静' }), true);
  assert.equal(evalCond({ var: 'x', op: '!=', value: '平静' }, { x: '平静' }), false);
});

check('evalCond：变量不存在时只有 empty/falsy 为真', () => {
  assert.equal(evalCond({ var: 'x', op: 'empty' }, {}), true);
  assert.equal(evalCond({ var: 'x', op: 'falsy' }, {}), true);
  assert.equal(evalCond({ var: 'x', op: 'truthy' }, {}), false);
  assert.equal(evalCond({ var: 'x', op: '>' }, {}), false);
});

check('evalWhen：AND 语义', () => {
  assert.equal(evalWhen(null, {}), true);
  assert.equal(
    evalWhen(
      [
        { var: 'a', op: '>', value: 1 },
        { var: 'b', op: '=', value: 'x' },
      ],
      { a: 2, b: 'x' },
    ),
    true,
  );
  assert.equal(evalWhen([{ var: 'a', op: '>', value: 1 }], { a: 0 }), false);
});

check('ratioOf：夹在 0..1，默认 max 100', () => {
  assert.equal(ratioOf(50), 0.5);
  assert.equal(ratioOf(150), 1);
  assert.equal(ratioOf(0), 0);
  assert.equal(ratioOf(5, { max: 10 }), 0.5);
  assert.equal(ratioOf('x'), 0);
});

check('buildPlan：when 不满足就不出计划项', () => {
  const plan = buildPlan(
    {
      title: 'T',
      grid: { cols: 4, rows: 2 },
      cells: [
        { id: 'a', kind: 'text', text: '常驻', area: [0, 0, 2, 1] },
        { id: 'b', kind: 'text', text: '隐藏', area: [2, 0, 2, 1], when: [{ var: 'n', op: '>', value: 5 }] },
      ],
    },
    { n: 1 },
  );
  assert.equal(plan.cells.length, 1);
  assert.equal(plan.cells[0].id, 'a');
});

check('buildPlan：bar 的比例与语气', () => {
  const layout = { title: 'T', grid: { cols: 2, rows: 1 }, cells: [{ id: 'b', kind: 'bar', var: 'hp', max: 10, area: [0, 0, 2, 1] }] };
  assert.equal(buildPlan(layout, { hp: 5 }).cells[0].ratio, 0.5);
  assert.equal(buildPlan(layout, { hp: 5 }).cells[0].tone, 'ok');
  assert.equal(buildPlan(layout, { hp: 1 }).cells[0].tone, 'bad');
  assert.equal(buildPlan(layout, {}).cells[0].tone, 'muted');
  assert.equal(buildPlan(layout, {}).cells[0].text, '—');
});

check('buildPlan：toggle 的三种状态', () => {
  const layout = { title: 'T', grid: { cols: 2, rows: 1 }, cells: [{ id: 't', kind: 'toggle', var: '灯', area: [0, 0, 2, 1] }] };
  const on = buildPlan(layout, { 灯: true }).cells[0];
  assert.equal(on.state, 'on');
  assert.equal(on.text, '开');
  assert.equal(on.clickable, true);
  const off = buildPlan(layout, { 灯: false }).cells[0];
  assert.equal(off.state, 'off');
  assert.equal(off.text, '关');
  const missing = buildPlan(layout, {}).cells[0];
  assert.equal(missing.state, 'missing');
  assert.equal(missing.clickable, false);
});

check('buildPlan：list 生成项，过滤空项', () => {
  const layout = {
    title: 'T',
    grid: { cols: 2, rows: 1 },
    cells: [
      {
        id: 'l',
        kind: 'list',
        area: [0, 0, 2, 1],
        items: ['甲', null, { label: '乙', action: { kind: 'set', var: 'x', value: 1 } }],
      },
    ],
  };
  const cell = buildPlan(layout, {}).cells[0];
  assert.equal(cell.items.length, 2);
  assert.equal(cell.items[0].label, '甲');
  assert.equal(cell.items[1].action.kind, 'set');
});

check('buildPlan：未知控件降级成 stat 样子', () => {
  const layout = { title: 'T', grid: { cols: 2, rows: 1 }, cells: [{ id: 'x', kind: 'slider', var: 'n', area: [0, 0, 2, 1] }] };
  const cell = buildPlan(layout, { n: 1 }).cells[0];
  assert.equal(cell.kind, 'stat');
  assert.equal(cell.degraded, true);
});

console.log(`plan.test: ${n} passed`);
