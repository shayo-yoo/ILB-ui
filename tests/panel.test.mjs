import assert from 'node:assert/strict';
import {
  createDocument,
  findByClass,
  findAll,
  findAllByClass,
  findButtonByText,
  memoryStorage,
} from './dom-stub.mjs';
import { makeFakeIlb } from './fake-ilb.mjs';
import SAMPLE from '../ui/sample-layout.js';

let n = 0;
function check(name, fn) {
  fn();
  n += 1;
  console.log(`  ok ${name}`);
}

function makeEnv(options = {}) {
  const doc = createDocument();
  const storage = memoryStorage(options.storage ?? {});
  const fake = makeFakeIlb({
    vars: { 金币: 3, 生命: 10, 心情: '平静', 灯: false },
    ...(options.ilb ?? {}),
  });
  if (options.noIlb) delete globalThis.ILB;
  else globalThis.ILB = { api: fake.api };
  return { doc, storage, fake };
}

const LAYOUT = {
  schema: 'dshui/1',
  title: '测试布局',
  grid: { cols: 4, rows: 2 },
  cells: [
    { id: 'g', kind: 'stat', label: '甲', var: '金币', area: [0, 0, 2, 1] },
    {
      id: 'b',
      kind: 'button',
      label: '加一',
      area: [2, 0, 2, 1],
      onClick: { kind: 'add', var: '金币', by: 1 },
    },
  ],
};

function buttonByExactText(doc, text) {
  return findAll(doc.body, (node) => node.tagName === 'button' && node.textContent.trim() === text)[0] ?? null;
}

function cellsByLabel(doc, label) {
  return findAll(
    doc.body,
    (node) => node.classList.contains('dshui-cell') && node.textContent.includes(label),
  );
}

function initPanel(doc, storage, extra = {}) {
  const { init } = globalThis.__panel;
  return init({ document: doc, storage, getAvatar: () => '', ...extra });
}

async function loadPanel() {
  const mod = await import('../src/panel.js');
  globalThis.__panel = mod;
  return mod;
}

await loadPanel();

console.log('panel.test');

check('初始化：浮窗在、抽屉收起', () => {
  const { doc, storage } = makeEnv();
  const ui = initPanel(doc, storage);
  assert.ok(globalThis.DSHUI === ui);
  const fab = findByClass(doc.body, 'dshui-fab');
  assert.ok(fab);
  assert.ok(fab.textContent.includes('▦'));
  const panel = findByClass(doc.body, 'dshui-panel');
  assert.equal(panel.hidden, true);
  assert.ok(findByClass(doc.body, 'dshui-status').textContent.includes('接口 v1.1'));
  ui.destroy();
  assert.equal(globalThis.DSHUI, undefined);
});

check('点浮窗：打开抽屉、浮窗隐藏、状态写进 storage', () => {
  const { doc, storage } = makeEnv();
  const ui = initPanel(doc, storage);
  findByClass(doc.body, 'dshui-fab').click();
  const panel = findByClass(doc.body, 'dshui-panel');
  assert.equal(panel.hidden, false);
  assert.ok(findByClass(doc.body, 'dshui-fab').classList.contains('is-open'));
  assert.deepEqual(JSON.parse(storage.getItem('dshui.ui.v1')), { open: true });
  ui.close();
  assert.equal(panel.hidden, true);
  ui.destroy();
});

check('变量板：数字 +1，文本不可点', () => {
  const { doc, storage, fake } = makeEnv();
  const ui = initPanel(doc, storage);
  const chips = findAllByClass(doc.body, 'dshui-chip');
  assert.equal(chips.length, 4);
  const gold = chips.find((c) => c.textContent.includes('金币'));
  assert.equal(gold.tagName, 'button');
  gold.click();
  assert.equal(fake.vars['金币'], 4);
  const mood = chips.find((c) => c.textContent.includes('心情'));
  assert.equal(mood.tagName, 'div');
  ui.destroy();
});

check('网格：示例布局的 stat 显示带后缀', () => {
  const { doc, storage } = makeEnv();
  const ui = initPanel(doc, storage);
  const stats = findAllByClass(doc.body, 'dshui-kind-stat');
  const gold = stats.find((node) => node.textContent.includes('3 G'));
  assert.ok(gold, `stat 单元格里应有一个显示 “3 G”，实际：${stats.map((n) => n.textContent).join(' | ')}`);
  ui.destroy();
});

check('网格：bar 有进度条与百分比', () => {
  const { doc, storage } = makeEnv();
  const ui = initPanel(doc, storage);
  const bar = findByClass(doc.body, 'dshui-kind-bar');
  assert.ok(bar);
  const fill = findByClass(bar, 'dshui-bar-fill');
  assert.equal(fill.style.width, '100%');
  assert.ok(bar.textContent.includes('生命'));
  ui.destroy();
});

check('网格：toggle 点击读写布尔', () => {
  const { doc, storage, fake } = makeEnv();
  const ui = initPanel(doc, storage);
  const toggle = findByClass(doc.body, 'dshui-kind-toggle');
  assert.equal(toggle.getAttribute('aria-pressed'), 'false');
  assert.ok(toggle.textContent.includes('关'));
  toggle.click();
  assert.equal(fake.vars['灯'], true);
  // 重画后节点是新造的，要重新取
  const after = findByClass(doc.body, 'dshui-kind-toggle');
  assert.equal(after.getAttribute('aria-pressed'), 'true');
  assert.ok(after.textContent.includes('开'));
  ui.destroy();
});

check('网格：list 的每一项都是按钮，点了执行动作', () => {
  const { doc, storage, fake } = makeEnv();
  const ui = initPanel(doc, storage);
  const list = findByClass(doc.body, 'dshui-kind-list');
  const items = findAll(list, (node) => node.classList.contains('dshui-list-item'));
  assert.equal(items.length, 4);
  const plusGold = items.find((node) => node.textContent.includes('金币 +1'));
  plusGold.click();
  assert.equal(fake.vars['金币'], 4);
  ui.destroy();
});

check('网格：when 不满足的控件不画', () => {
  const { doc, storage } = makeEnv();
  const sample = {
    ...LAYOUT,
    cells: [
      { id: 'a', kind: 'text', text: '一直在', area: [0, 0, 2, 1] },
      { id: 'b', kind: 'text', text: '只在金币 > 10 时', area: [2, 0, 2, 1], when: [{ var: '金币', op: '>', value: 10 }] },
    ],
  };
  const ui = initPanel(doc, storage, { sample });
  assert.ok(cellsByLabel(doc, '一直在').length === 1);
  assert.equal(cellsByLabel(doc, '只在金币').length, 0);
  ui.destroy();
});

check('动作：open tab 调 ILB 的 ui.openPanel', () => {
  const { doc, storage, fake } = makeEnv();
  const sample = {
    ...LAYOUT,
    cells: [
      {
        id: 'c',
        kind: 'button',
        label: '打开逻辑页',
        area: [0, 0, 4, 1],
        onClick: { kind: 'open', tab: 'logic' },
      },
    ],
  };
  const ui = initPanel(doc, storage, { sample });
  findButtonByText(doc.body, '打开逻辑页').click();
  assert.deepEqual(fake.state.panels, ['logic']);
  ui.destroy();
});

check('动作：open page 切到本布局的另一个页面', () => {
  const { doc, storage } = makeEnv();
  const sample = {
    title: '两页',
    grid: { cols: 2, rows: 1 },
    pages: [
      {
        id: 'one',
        title: '第一页',
        cells: [
          { id: 'a', kind: 'text', text: '我在第一页', area: [0, 0, 2, 1] },
          { id: 'go', kind: 'button', label: '去第二页', area: [0, 0, 2, 1], onClick: { kind: 'open', page: 'two' } },
        ],
      },
      {
        id: 'two',
        title: '第二页',
        cells: [{ id: 'b', kind: 'text', text: '我在第二页', area: [0, 0, 2, 1] }],
      },
    ],
  };
  // 两页的控件挤在同一格：第一页只看得到按钮，正好
  const ui = initPanel(doc, storage, { sample });
  const tabs = findAllByClass(doc.body, 'dshui-page-tab');
  assert.equal(tabs.length, 2);
  findButtonByText(doc.body, '去第二页').click();
  assert.ok(cellsByLabel(doc, '我在第二页').length === 1);
  const active = findAllByClass(doc.body, 'dshui-page-tab').find((t) => t.classList.contains('is-active'));
  assert.ok(active.textContent.includes('第二页'));
  ui.destroy();
});

check('动作：call 的 blocked 用 warn 语气显示', () => {
  const { doc, storage } = makeEnv();
  const sample = {
    ...LAYOUT,
    cells: [
      {
        id: 'c',
        kind: 'button',
        label: '调用',
        area: [0, 0, 4, 1],
        onClick: { kind: 'call', logic: '次数不够' },
      },
    ],
  };
  const ui = initPanel(doc, storage, { sample });
  findButtonByText(doc.body, '调用').click();
  const foot = findByClass(doc.body, 'dshui-foot');
  assert.ok(foot.classList.contains('is-warn'));
  assert.ok(foot.textContent.includes('次数不够'));
  ui.destroy();
});

check('动作：call 成功后显示 extra', () => {
  const { doc, storage } = makeEnv();
  const sample = {
    ...LAYOUT,
    cells: [
      {
        id: 'c',
        kind: 'button',
        label: '抽卡',
        area: [0, 0, 4, 1],
        onClick: { kind: 'call', logic: '抽卡' },
      },
    ],
  };
  const ui = initPanel(doc, storage, { sample });
  findButtonByText(doc.body, '抽卡').click();
  const foot = findByClass(doc.body, 'dshui-foot');
  assert.ok(foot.classList.contains('is-ok'));
  assert.ok(foot.textContent.includes('SSR'));
  ui.destroy();
});

check('编辑器：打开 → 填入 → 校验通过 → 应用预览', () => {
  const { doc, storage } = makeEnv();
  const ui = initPanel(doc, storage);
  buttonByExactText(doc, '编辑').click();
  buttonByExactText(doc, 'JSON').click();
  const textarea = findByClass(doc.body, 'dshui-editor-text');
  assert.ok(textarea.value.includes('dshui/1'));

  textarea.value = JSON.stringify(LAYOUT);
  buttonByExactText(doc, '校验').click();
  assert.ok(findByClass(doc.body, 'dshui-issue').textContent.includes('校验通过'));

  buttonByExactText(doc, '应用').click();
  assert.ok(findByClass(doc.body, 'dshui-note').textContent.includes('布局：测试布局'));
  assert.ok(findByClass(doc.body, 'dshui-layout-select').value === '__draft__');
  assert.ok(cellsByLabel(doc, '甲').length === 1);
  assert.equal(storage.getItem('dshui.layouts.v2'), null);
  ui.destroy();
});

check('编辑器：保存（全局）进布局库并选中', () => {
  const { doc, storage } = makeEnv();
  const ui = initPanel(doc, storage);
  buttonByExactText(doc, '编辑').click();
  buttonByExactText(doc, 'JSON').click();
  findByClass(doc.body, 'dshui-editor-text').value = JSON.stringify(LAYOUT);
  buttonByExactText(doc, '保存（全局）').click();

  const lib = JSON.parse(storage.getItem('dshui.layouts.v2'));
  assert.equal(lib.length, 1);
  assert.equal(lib[0].title, '测试布局');
  assert.equal(lib[0].scope, 'global');
  const selected = JSON.parse(storage.getItem('dshui.selected.v2'));
  assert.equal(selected.global, lib[0].id);
  assert.ok(findByClass(doc.body, 'dshui-note').textContent.includes('布局：测试布局'));
  ui.destroy();
});

check('编辑器：保存（角色卡）绑定当前角色', () => {
  const { doc, storage } = makeEnv();
  const ui = initPanel(doc, storage, { getAvatar: () => 'Alice.png' });
  buttonByExactText(doc, '编辑').click();
  buttonByExactText(doc, 'JSON').click();
  findByClass(doc.body, 'dshui-editor-text').value = JSON.stringify(LAYOUT);
  buttonByExactText(doc, '保存（角色卡）').click();

  const lib = JSON.parse(storage.getItem('dshui.layouts.v2'));
  assert.equal(lib[0].scope, 'character');
  assert.equal(lib[0].avatar, 'Alice.png');
  assert.ok(JSON.parse(storage.getItem('dshui.selected.v2'))['char:Alice.png']);
  ui.destroy();
});

check('编辑器：坏的 JSON 只报错，不覆盖仓库', () => {
  const { doc, storage } = makeEnv();
  const ui = initPanel(doc, storage);
  buttonByExactText(doc, '编辑').click();
  buttonByExactText(doc, 'JSON').click();
  findByClass(doc.body, 'dshui-editor-text').value = '{ 坏';
  buttonByExactText(doc, '保存（全局）').click();
  assert.ok(doc.body.textContent.includes('JSON 解析失败'));
  assert.equal(storage.getItem('dshui.layouts.v2'), null);
  ui.destroy();
});

check('编辑器：填入示例把示例布局塞进 textarea', () => {
  const { doc, storage } = makeEnv();
  const ui = initPanel(doc, storage);
  buttonByExactText(doc, '编辑').click();
  buttonByExactText(doc, 'JSON').click();
  findByClass(doc.body, 'dshui-editor-text').value = '{}';
  buttonByExactText(doc, '填入示例').click();
  const text = findByClass(doc.body, 'dshui-editor-text').value;
  assert.equal(JSON.parse(text).title, SAMPLE.title);
  ui.destroy();
});

check('多页面：示例有页签，点页签换页', () => {
  const { doc, storage } = makeEnv();
  const ui = initPanel(doc, storage);
  const tabs = findAllByClass(doc.body, 'dshui-page-tab');
  assert.equal(tabs.length, 2);
  assert.ok(tabs.some((t) => t.textContent.includes('主界面')));
  const bagTab = tabs.find((t) => t.textContent.includes('背包'));
  bagTab.click();
  const activeTab = findAllByClass(doc.body, 'dshui-page-tab').find((t) => t.classList.contains('is-active'));
  assert.ok(activeTab.textContent.includes('背包'));
  assert.ok(doc.body.textContent.includes('← 返回主界面'));
  findButtonByText(doc.body, '← 返回主界面').click();
  assert.ok(findButtonByText(doc.body, '抽卡（调「抽卡」逻辑）'));
  ui.destroy();
});

function fireInput(node, value) {
  node.value = value;
  for (const fn of node.listeners.get('input') ?? []) fn({ target: node });
}

check('表单：改标题 → 应用 → 预览更新、未落盘', () => {
  const { doc, storage } = makeEnv();
  const ui = initPanel(doc, storage);
  buttonByExactText(doc, '编辑').click();

  const titleInput = findAllByClass(doc.body, 'dshui-input').find((n) => n.value === SAMPLE.title);
  assert.ok(titleInput, '表单里应有标题输入框');
  fireInput(titleInput, '改过的标题');

  buttonByExactText(doc, '应用').click();
  assert.ok(findByClass(doc.body, 'dshui-note').textContent.includes('改过的标题'));
  assert.equal(storage.getItem('dshui.layouts.v2'), null);
  ui.destroy();
});

check('表单：＋ 控件 增加一格，说明行数变多', () => {
  const { doc, storage } = makeEnv();
  const ui = initPanel(doc, storage);
  buttonByExactText(doc, '编辑').click();
  const before = findAllByClass(doc.body, 'dshui-form-cell').length;
  buttonByExactText(doc, '＋ 控件').click();
  const after = findAllByClass(doc.body, 'dshui-form-cell').length;
  assert.equal(after, before + 1);
  ui.destroy();
});

check('编辑器：JSON → 表单 往返切换（切完只显示表单）', () => {
  const { doc, storage } = makeEnv();
  const ui = initPanel(doc, storage);
  buttonByExactText(doc, '编辑').click();
  buttonByExactText(doc, 'JSON').click();
  const textarea = findByClass(doc.body, 'dshui-editor-text');
  const formBox = findByClass(doc.body, 'dshui-form');
  assert.equal(textarea.hidden, false, 'JSON 模式显示文本框');
  assert.equal(formBox.hidden, true, 'JSON 模式隐藏表单');

  buttonByExactText(doc, '表单').click();
  assert.equal(textarea.hidden, true, '切回表单后文本框必须隐藏');
  assert.equal(formBox.hidden, false, '切回表单后表单必须显示');
  assert.equal(textarea.style.display, 'none', '样式兜底也应是 none');
  assert.ok(findAllByClass(doc.body, 'dshui-form-cell').length >= 1, '表单内容已重绘');
  assert.ok(doc.body.textContent.includes(`v${globalThis.__panel.VERSION}`), '标题栏显示版本号，便于确认加载的是哪一版');
  ui.destroy();
});

check('编辑区：拖动条只在编辑时出现，记住上次高度', () => {
  const { doc, storage } = makeEnv({ storage: { 'dshui.ui.v1': JSON.stringify({ open: false, editorHeight: 420 }) } });
  const ui = initPanel(doc, storage);
  const splitter = findByClass(doc.body, 'dshui-splitter');
  assert.ok(splitter, '应创建拖动条');
  assert.equal(splitter.hidden, true, '未编辑时拖动条隐藏');

  buttonByExactText(doc, '编辑').click();
  assert.equal(splitter.hidden, false, '编辑时拖动条出现');
  assert.ok(findByClass(doc.body, 'dshui-body').classList.contains('is-editing'));
  assert.equal(findByClass(doc.body, 'dshui-editor').style.height, '420px', '恢复上次拖动的高度');

  buttonByExactText(doc, '收起编辑').click();
  assert.equal(splitter.hidden, true, '退出编辑后拖动条隐藏');
  ui.destroy();
});

check('导入：粘贴导出的 JSON → 进预览，不落盘', () => {
  const { doc, storage } = makeEnv();
  const ui = initPanel(doc, storage);
  buttonByExactText(doc, '导入').click();
  const importArea = findByClass(doc.body, 'dshui-import-text');
  importArea.value = JSON.stringify({ kind: 'dshui-ui', format: 1, layout: LAYOUT });
  buttonByExactText(doc, '导入这段 JSON').click();
  assert.ok(findByClass(doc.body, 'dshui-note').textContent.includes('测试布局'));
  assert.equal(storage.getItem('dshui.layouts.v2'), null);
  ui.destroy();
});

check('导入：坏文件只报错', () => {
  const { doc, storage } = makeEnv();
  const ui = initPanel(doc, storage);
  buttonByExactText(doc, '导入').click();
  findByClass(doc.body, 'dshui-import-text').value = '{ 坏';
  buttonByExactText(doc, '导入这段 JSON').click();
  assert.ok(doc.body.textContent.includes('这个文件不是合法 JSON'));
  ui.destroy();
});

check('导出：生成下载并提示文件名', () => {
  const { doc, storage } = makeEnv();
  const ui = initPanel(doc, storage);
  buttonByExactText(doc, '导出').click();
  const foot = findByClass(doc.body, 'dshui-foot');
  assert.ok(foot.classList.contains('is-ok'));
  assert.ok(foot.textContent.includes('已导出 dshui-'));
  ui.destroy();
});

check('失效角色卡布局：两段式清理', () => {
  const entries = [
    {
      id: 'dead-1',
      title: '旧角色布局',
      scope: 'character',
      avatar: 'Alice.png',
      updatedAt: 0,
      layout: { schema: 'dshui/1', title: '旧角色布局', grid: { cols: 4, rows: 2 }, cells: [] },
    },
  ];
  globalThis.SillyTavern = { getContext: () => ({ characters: [{ avatar: 'Bob.png' }], characterId: 0 }) };
  const { doc, storage } = makeEnv({ storage: { 'dshui.layouts.v2': JSON.stringify(entries) } });
  const ui = initPanel(doc, storage);
  const first = findButtonByText(doc.body, '清理失效');
  assert.ok(first);
  first.click();
  assert.ok(doc.body.textContent.includes('确认清理'));
  const confirmBtn = findButtonByText(doc.body, '确认清理');
  confirmBtn.click();
  assert.equal(JSON.parse(storage.getItem('dshui.layouts.v2')).length, 0);
  delete globalThis.SillyTavern;
  ui.destroy();
});

check('legacy：1.0 的 ILB 也能画，状态行提示旧版', () => {
  const { doc, storage } = makeEnv({ ilb: { version: '1.0', caps: [] } });
  const ui = initPanel(doc, storage);
  assert.ok(findByClass(doc.body, 'dshui-status').textContent.includes('旧版'));
  assert.ok(findByClass(doc.body, 'dshui-dot').classList.contains('is-warn'));
  assert.ok(findByClass(doc.body, 'dshui-kind-stat'));
  ui.destroy();
});

check('missing：没有 ILB 也不崩，给出提示', () => {
  const { doc, storage } = makeEnv({ noIlb: true });
  const ui = initPanel(doc, storage);
  assert.ok(findByClass(doc.body, 'dshui-status').textContent.includes('ILB 未加载'));
  assert.ok(findByClass(doc.body, 'dshui-dot').classList.contains('is-bad'));
  assert.equal(findByClass(doc.body, 'dshui-vars').children.length, 0);
  ui.destroy();
});

console.log(`panel.test: ${n} passed`);

