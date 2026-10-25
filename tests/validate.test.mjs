import assert from 'node:assert/strict';
import { formatIssues, validateLayout } from '../src/validate.js';

let n = 0;
function check(name, fn) {
  fn();
  n += 1;
  console.log(`  ok ${name}`);
}

const BASE = {
  schema: 'dshui/1',
  title: 'T',
  grid: { cols: 4, rows: 2 },
  cells: [
    { id: 'a', kind: 'text', text: 'hi', area: [0, 0, 2, 1] },
    { id: 'b', kind: 'button', label: '加', area: [2, 0, 2, 1], onClick: { kind: 'add', var: '金币', by: 1 } },
  ],
};

function paths(list) {
  return list.map((x) => x.path);
}

console.log('validate.test');

check('合法布局：ok，不带错误', () => {
  const res = validateLayout(BASE, { vars: { 金币: 3 } });
  assert.equal(res.ok, true);
  assert.deepEqual(res.errors, []);
  assert.equal(res.layout.cells.length, 2);
});

check('别名写法：widgets / type / bind / action 都认', () => {
  const res = validateLayout({
    schema: 'dshui/1',
    title: 'T',
    grid: { cols: 2, rows: 1 },
    widgets: [
      {
        type: 'stat',
        bind: '金币',
        area: [0, 0, 1, 1],
        action: { kind: 'add', var: '金币', by: 1 },
      },
    ],
  });
  assert.equal(res.ok, true);
  assert.equal(res.layout.cells[0].kind, 'stat');
  assert.equal(res.layout.cells[0].var, '金币');
  assert.equal(res.layout.cells[0].onClick.kind, 'add');
});

check('根不是对象', () => {
  const res = validateLayout([]);
  assert.equal(res.ok, false);
  assert.ok(res.errors[0].message.includes('JSON 对象'));
});

check('title 为空 / 缺网格 / 网格越界', () => {
  const a = validateLayout({ ...BASE, title: '  ' });
  assert.equal(a.ok, false);
  assert.ok(paths(a.errors).includes('title'));

  const b = validateLayout({ ...BASE, grid: { cols: 0, rows: 2 } });
  assert.ok(paths(b.errors).includes('grid.cols'));

  const c = validateLayout({ ...BASE, grid: { cols: 99, rows: 2 } });
  assert.ok(paths(c.errors).includes('grid.cols'));

  const d = validateLayout({ ...BASE, grid: { cols: 4, rows: 2.5 } });
  assert.ok(paths(d.errors).includes('grid.rows'));
});

check('area 负数 / 越界 / 缺省', () => {
  const neg = validateLayout({ ...BASE, cells: [{ id: 'a', kind: 'text', text: 'x', area: [-1, 0, 1, 1] }] });
  assert.ok(neg.errors.some((e) => e.message.includes('不能是负数')));

  const over = validateLayout({ ...BASE, cells: [{ id: 'a', kind: 'text', text: 'x', area: [3, 0, 2, 1] }] });
  assert.ok(over.errors.some((e) => e.message.includes('横向越界')));

  const none = validateLayout({ ...BASE, cells: [{ id: 'a', kind: 'text', text: 'x' }] });
  assert.ok(none.errors.some((e) => e.message.includes('area 必须')));
});

check('控件 id 重复', () => {
  const res = validateLayout({
    ...BASE,
    cells: [
      { id: 'same', kind: 'text', text: 'a', area: [0, 0, 1, 1] },
      { id: 'same', kind: 'text', text: 'b', area: [1, 0, 1, 1] },
    ],
  });
  assert.ok(res.errors.some((e) => e.message.includes('重复')));
});

check('未知控件只 warning', () => {
  const res = validateLayout({
    ...BASE,
    cells: [{ id: 'a', kind: 'slider', var: 'x', area: [0, 0, 2, 1] }],
  });
  assert.equal(res.ok, true);
  assert.ok(res.warnings.some((w) => w.message.includes('会降级')));
});

check('stat / number / bar / toggle 缺绑定变量', () => {
  const res = validateLayout({
    ...BASE,
    cells: [{ id: 'a', kind: 'bar', area: [0, 0, 2, 1] }],
  });
  assert.ok(res.errors.some((e) => e.path.endsWith('.var') && e.message.includes('bar')));
});

check('list 的项缺 label、项动作非法', () => {
  const res = validateLayout({
    ...BASE,
    cells: [
      {
        id: 'l',
        kind: 'list',
        area: [0, 0, 4, 1],
        items: [{ label: '' }, { label: 'x', action: { kind: 'explode' } }],
      },
    ],
  });
  assert.ok(res.errors.some((e) => e.path.includes('items[0].label')));
  assert.ok(res.errors.some((e) => e.path.includes('items[1].action')));
});

check('call：缺 logic、args 不是对象', () => {
  const res = validateLayout({
    ...BASE,
    cells: [
      { id: 'b', kind: 'button', label: 'x', area: [0, 0, 2, 1], onClick: { kind: 'call', args: [1] } },
    ],
  });
  assert.ok(res.errors.some((e) => e.message.includes('call 必须写 logic')));
  assert.ok(res.errors.some((e) => e.message.includes('args 必须是对象')));
});

check('open：缺 page/tab、tab 不认识', () => {
  const res = validateLayout({
    ...BASE,
    cells: [
      { id: 'b', kind: 'button', label: 'x', area: [0, 0, 2, 1], onClick: { kind: 'open' } },
      { id: 'c', kind: 'button', label: 'y', area: [2, 0, 2, 1], onClick: { kind: 'open', tab: 'nope' } },
    ],
  });
  assert.ok(res.errors.some((e) => e.message.includes('page（本布局里的页面 id）') || e.message.includes('tab（ILB 面板）')));
  assert.ok(res.errors.some((e) => e.message.includes('没有这个 tab')));
});

check('pages：多页面、页面 id 重复、页内 area 按本页网格算', () => {
  const ok = validateLayout({
    title: '两页',
    grid: { cols: 4, rows: 2 },
    pages: [
      { id: 'a', title: 'A', cells: [{ id: 'a1', kind: 'text', text: 'a', area: [0, 0, 4, 1] }] },
      {
        id: 'b',
        title: 'B',
        grid: { cols: 2, rows: 2 },
        cells: [{ id: 'b1', kind: 'text', text: 'b', area: [0, 0, 2, 1] }],
      },
    ],
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.layout.pages.length, 2);
  assert.equal(ok.layout.pages[1].grid.cols, 2);

  const dup = validateLayout({
    title: 'x',
    pages: [
      { id: 'same', cells: [] },
      { id: 'same', cells: [] },
    ],
  });
  assert.ok(dup.errors.some((e) => e.message.includes('重复')));

  const over = validateLayout({
    title: 'x',
    grid: { cols: 4, rows: 2 },
    pages: [{ id: 'p', grid: { cols: 2, rows: 2 }, cells: [{ id: 'a', kind: 'text', text: 'x', area: [1, 0, 2, 1] }] }],
  });
  assert.ok(over.errors.some((e) => e.message.includes('横向越界')));
});

check('pages：open page 必须存在', () => {
  const res = validateLayout({
    title: 'x',
    pages: [
      {
        id: 'main',
        cells: [{ id: 'b', kind: 'button', label: '去', area: [0, 0, 2, 1], onClick: { kind: 'open', page: 'nope' } }],
      },
    ],
  });
  assert.ok(res.errors.some((e) => e.message.includes('没有这个页面')));
});

check('when：未知比较符 / 缺 value', () => {
  const res = validateLayout({
    ...BASE,
    cells: [
      {
        id: 'a',
        kind: 'text',
        text: 'x',
        area: [0, 0, 2, 1],
        when: [{ var: 'n', op: '~' }, { var: 'n', op: '>' }],
      },
    ],
  });
  assert.ok(res.errors.some((e) => e.message.includes('不认识的比较符')));
  assert.ok(res.errors.some((e) => e.message.includes('需要 value')));
});

check('bar 的 max 必须是正数', () => {
  const res = validateLayout({
    ...BASE,
    cells: [{ id: 'b', kind: 'bar', var: 'hp', max: 0, area: [0, 0, 2, 1] }],
  });
  assert.ok(res.errors.some((e) => e.path.endsWith('.max')));
});

check('空 cells 只警告（页面允许先空着）', () => {
  const res = validateLayout({ ...BASE, cells: [] });
  assert.equal(res.ok, true);
  assert.ok(res.warnings.some((e) => e.message.includes('空的')));
});

check('变量不存在：给 warning，不拦保存', () => {
  const res = validateLayout(
    {
      ...BASE,
      cells: [{ id: 'a', kind: 'stat', var: '没有', area: [0, 0, 2, 1] }],
    },
    { vars: { 金币: 3 } },
  );
  assert.equal(res.ok, true);
  assert.ok(res.warnings.some((w) => w.message.includes('变量「没有」')));
});

check('重叠：只在重叠的后一个上 warning', () => {
  const res = validateLayout({
    ...BASE,
    cells: [
      { id: 'a', kind: 'text', text: 'a', area: [0, 0, 2, 1] },
      { id: 'b', kind: 'text', text: 'b', area: [1, 0, 2, 1] },
    ],
  });
  assert.equal(res.ok, true);
  assert.ok(res.warnings.some((w) => w.message.includes('重叠')));
});

check('add 的 by 必须是数字', () => {
  const res = validateLayout({
    ...BASE,
    cells: [
      { id: 'b', kind: 'button', label: 'x', area: [0, 0, 2, 1], onClick: { kind: 'add', var: '金币', by: 'x' } },
    ],
  });
  assert.ok(res.errors.some((e) => e.message.includes('by 必须是数字')));
});

check('formatIssues 打成人话', () => {
  assert.equal(formatIssues([{ path: 'a.b', message: '坏了' }]), '[a.b] 坏了');
});

console.log(`validate.test: ${n} passed`);
