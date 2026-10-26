import assert from 'node:assert/strict';
import {
  createDocument,
  findByClass,
  findAll,
  findAllByClass,
  findButtonByText,
  memoryStorage,
  sleep,
} from './dom-stub.mjs';
import { makeFakeIlb } from './fake-ilb.mjs';
import SAMPLE from '../ui/sample-layout.js';

let n = 0;
function check(name, fn) {
  fn();
  n += 1;
  console.log(`  ok ${name}`);
}

/** 异步用例（v1.2 的 callAsync 要等微任务/定时器）；靠 ESM 顶层 await 收尾。 */
async function checkAsync(name, fn) {
  await fn();
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
  assert.ok(fab.textContent.includes('⋮'));
  const panel = findByClass(doc.body, 'dshui-panel');
  assert.equal(panel.hidden, true);
  assert.ok(findByClass(doc.body, 'dshui-status').textContent.includes('接口 v1.1'));
  ui.destroy();
  assert.equal(globalThis.DSHUI, undefined);
});

check('点浮窗：打开抽屉、浮窗姿态、状态写进 storage', () => {
  const { doc, storage } = makeEnv();
  const ui = initPanel(doc, storage);
  findByClass(doc.body, 'dshui-fab').click();
  const panel = findByClass(doc.body, 'dshui-panel');
  assert.equal(panel.hidden, false);
  assert.ok(findByClass(doc.body, 'dshui-fab').classList.contains('is-open'));
  const saved = JSON.parse(storage.getItem('dshui.ui.v1'));
  assert.equal(saved.open, true);
  assert.ok(Number.isFinite(saved.handleY), '把手高度也要一起记住');
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

check('使用说明：? 打开、返回关闭，含 ILB 联动章节', () => {
  const { doc, storage } = makeEnv();
  const ui = initPanel(doc, storage);
  const helpBtn = findAllByClass(doc.body, 'dshui-head-btn').find((n) => n.textContent === '?');
  assert.ok(helpBtn, '标题栏应有帮助按钮');

  helpBtn.click();
  const help = findByClass(doc.body, 'dshui-help');
  assert.notEqual(help.style.display, 'none', '点 ? 显示使用说明');
  assert.ok(help.textContent.includes('和 ILB 联动'));
  assert.ok(findAllByClass(help, 'dshui-help-sec').length >= 10, '说明应分多节');
  assert.equal(findByClass(doc.body, 'dshui-body').style.display, 'none', '看说明时收起正文');

  buttonByExactText(doc, '返回').click();
  assert.equal(help.style.display, 'none', '点返回关闭说明');
  assert.notEqual(findByClass(doc.body, 'dshui-body').style.display, 'none', '正文回来');
  ui.destroy();
});

check('表单：控件类型显示中文，存的仍是英文 kind', () => {
  const { doc, storage } = makeEnv();
  const ui = initPanel(doc, storage);
  buttonByExactText(doc, '编辑').click();

  const optionTexts = [];
  for (const select of findAllByClass(doc.body, 'dshui-select')) {
    for (const opt of select.children) {
      if (opt.tagName === 'option') optionTexts.push(opt.textContent);
    }
  }
  assert.ok(optionTexts.includes('状态'));
  assert.ok(optionTexts.includes('按钮'));
  assert.ok(!optionTexts.includes('stat'), '界面里不该露出英文 kind');
  ui.destroy();
});

check('编辑态：全屏编辑器，浏览件交给 CSS 让位', () => {
  const { doc, storage } = makeEnv();
  const ui = initPanel(doc, storage);
  const body = findByClass(doc.body, 'dshui-body');

  assert.ok(!body.classList.contains('is-editing'), '默认不是编辑态');
  assert.equal(findByClass(doc.body, 'dshui-editor').hidden, true, '默认编辑器藏着');

  buttonByExactText(doc, '编辑').click();
  // 浏览器里由 .dshui-body.is-editing 下的 CSS 把网格/工具栏等藏掉
  assert.ok(body.classList.contains('is-editing'), '编辑时 body 带 is-editing（CSS 据此隐藏浏览件）');
  assert.equal(findByClass(doc.body, 'dshui-editor').hidden, false, '编辑器可见');
  assert.ok(findByClass(doc.body, 'dshui-editor').classList.contains('is-open'));

  buttonByExactText(doc, '收起编辑').click();
  assert.ok(!body.classList.contains('is-editing'), '退出编辑后恢复');
  assert.equal(findByClass(doc.body, 'dshui-editor').hidden, true);
  ui.destroy();
});

check('预览：点一下进入交互态，再点一下回编辑', () => {
  const { doc, storage } = makeEnv();
  const ui = initPanel(doc, storage);
  buttonByExactText(doc, '编辑').click();

  const layer = findByClass(doc.body, 'dshui-preview');
  const btn = findByClass(doc.body, 'dshui-preview-btn');
  assert.ok(layer, '应有预览层');
  assert.equal(layer.hidden, true, '未预览时预览层藏着');
  // 预览在抽屉「里面」：它是 panel 的子节点，占正文那块地方，不铺满屏幕
  const panel = findByClass(doc.body, 'dshui-panel');
  assert.equal(layer.parent, panel, '预览层挂在 panel 里，不挂 root');
  assert.equal(findByClass(doc.body, 'dshui-root').children.includes(layer), false, 'root 下没有预览层');

  btn.click();
  assert.equal(layer.hidden, false, '点按后预览层出现');
  assert.equal(findByClass(doc.body, 'dshui-editor').hidden, true, '预览时编辑器让位');
  assert.equal(findByClass(doc.body, 'dshui-body').hidden, true, '预览时正文整块让位');
  // 面板外壳留着：这才叫「在 ILBUI 的窗口里预览」，而不是另开一屏
  assert.equal(findByClass(doc.body, 'dshui-status').style.display, '', '状态行还在');
  assert.equal(findByClass(doc.body, 'dshui-toolbar').style.display, '', '工具栏还在');
  assert.equal(findByClass(doc.body, 'dshui-foot').style.display, '', '底栏还在');
  assert.ok(findByClass(doc.body, 'dshui-preview-text').textContent.includes('交互预览'));
  assert.equal(btn.textContent, '结束预览');
  assert.equal(btn.getAttribute('aria-pressed'), 'true');

  // 交互态：预览里的按钮真的能改变量
  const before = JSON.parse(storage.getItem('dshui.vars.demo') ?? 'null');
  const previewGrid = findByClass(doc.body, 'dshui-preview-grid');
  assert.ok(previewGrid.children.length > 0, '预览层里应画出网格');

  btn.click();
  assert.equal(layer.hidden, true, '再点一次回到编辑');
  assert.equal(findByClass(doc.body, 'dshui-body').hidden, false, '正文回来了');
  assert.equal(findByClass(doc.body, 'dshui-editor').hidden, false, '编辑器回来了');
  assert.equal(btn.textContent, '预览');
  void before;
  ui.destroy();
});

check('预览：长按是临时预览，松手自动回编辑', () => {
  const { doc, storage } = makeEnv();
  // 注入一个手动触发的计时器：长按逻辑不用等真实时间，也就不会跨用例串状态
  let fire = null;
  const ui = initPanel(doc, storage, {
    setTimer: (fn) => {
      fire = fn;
      return 1;
    },
    clearTimer: () => {
      fire = null;
    },
  });
  buttonByExactText(doc, '编辑').click();

  const layer = findByClass(doc.body, 'dshui-preview');
  const btn = findByClass(doc.body, 'dshui-preview-btn');

  btn.dispatch('pointerdown', { button: 0, pointerId: 7 });
  assert.equal(typeof fire, 'function', '按下后应排上长按计时');
  assert.equal(layer.hidden, true, '还没到阈值，仍是编辑态');

  fire(); // 触发长按
  assert.equal(layer.hidden, false, '长按后浮层出现');
  assert.ok(findByClass(doc.body, 'dshui-preview-text').textContent.includes('临时预览'));

  btn.dispatch('pointerup', { button: 0, pointerId: 7 });
  assert.equal(layer.hidden, true, '松手就回编辑');
  assert.equal(findByClass(doc.body, 'dshui-editor').hidden, false);

  // 松手后浏览器补发的 click 不该把界面锁进交互态
  btn.click();
  assert.equal(layer.hidden, true, '收尾的 click 被吃掉');
  ui.destroy();
});

check('预览：返回按钮与 Esc 都能退出', () => {
  const { doc, storage } = makeEnv();
  const ui = initPanel(doc, storage);
  buttonByExactText(doc, '编辑').click();
  const layer = findByClass(doc.body, 'dshui-preview');
  const btn = findByClass(doc.body, 'dshui-preview-btn');

  btn.click();
  assert.equal(layer.hidden, false);
  buttonByExactText(doc, '返回编辑').click();
  assert.equal(layer.hidden, true, '返回编辑按钮生效');

  btn.click();
  assert.equal(layer.hidden, false);
  findByClass(doc.body, 'dshui-panel').dispatch('keydown', { key: 'Escape' });
  assert.equal(layer.hidden, true, 'Esc 生效');
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

check('无障碍：进度条带 progressbar 语义与数值', () => {
  const { doc, storage } = makeEnv();
  const ui = initPanel(doc, storage);
  const track = findByClass(doc.body, 'dshui-bar-track');
  assert.ok(track, '示例布局里有进度条');
  assert.equal(track.getAttribute('role'), 'progressbar');
  assert.equal(track.getAttribute('aria-valuemin'), '0');
  assert.equal(track.getAttribute('aria-valuemax'), '100');
  assert.match(track.getAttribute('aria-valuenow'), /^\d+$/);
  assert.ok(track.getAttribute('aria-label'), '进度条有名字');
  assert.ok(track.getAttribute('aria-valuetext'), '数值外还有可读文本');
  ui.destroy();
});

check('无障碍：网格是带页面名的 group', () => {
  const { doc, storage } = makeEnv();
  const ui = initPanel(doc, storage);
  const grid = findByClass(doc.body, 'dshui-grid');
  assert.equal(grid.getAttribute('role'), 'group');
  assert.ok(grid.getAttribute('aria-label').startsWith('页面：'), grid.getAttribute('aria-label'));
  ui.destroy();
});

check('无障碍：动作结果写进 aria-live，同一句不重复刷', () => {
  const { doc, storage } = makeEnv();
  const ui = initPanel(doc, storage);
  const live = findByClass(doc.body, 'dshui-sr-only');
  assert.ok(live, '有播报区');
  assert.equal(live.getAttribute('aria-live'), 'polite');
  assert.equal(live.textContent, '', '初始静默，不打扰');

  buttonByExactText(doc, '金币 +1').click();
  const first = live.textContent;
  assert.ok(first.includes('金币'), `播报了金币变化：${first}`);

  // 再点一次：值变了，播报要更新
  buttonByExactText(doc, '金币 +1').click();
  assert.notEqual(live.textContent, first, '值变化要重新播报');
  ui.destroy();
});

check('无障碍：Esc 先退预览，再关抽屉', () => {
  const { doc, storage } = makeEnv();
  const ui = initPanel(doc, storage);
  const fab = findByClass(doc.body, 'dshui-fab');
  const panel = findByClass(doc.body, 'dshui-panel');

  fab.click();
  assert.equal(panel.hidden, false, '抽屉打开');

  // 没有预览时，Esc 直接关抽屉
  panel.dispatch('keydown', { key: 'Escape' });
  assert.equal(panel.hidden, true, 'Esc 关掉了抽屉');

  // 有预览时，Esc 只退预览，抽屉留着
  fab.click();
  assert.equal(panel.hidden, false, '抽屉重新打开');
  buttonByExactText(doc, '编辑').click();
  const layer = findByClass(doc.body, 'dshui-preview');
  findByClass(doc.body, 'dshui-preview-btn').click();
  assert.equal(layer.hidden, false);
  panel.dispatch('keydown', { key: 'Escape' });
  assert.equal(layer.hidden, true, 'Esc 退了预览');
  assert.equal(panel.hidden, false, '抽屉还在');
  ui.destroy();
});

check('无障碍：开抽屉焦点进面板，关抽屉焦点回把手', () => {
  const { doc, storage } = makeEnv();
  const ui = initPanel(doc, storage);
  const fab = findByClass(doc.body, 'dshui-fab');
  const panel = findByClass(doc.body, 'dshui-panel');

  fab.click();
  assert.equal(panel.hidden, false);
  assert.ok(panel.contains(doc.activeElement), '焦点落进面板内部');
  assert.notEqual(doc.activeElement, doc.body, '焦点没留在 body');

  findByClass(doc.body, 'dshui-close').click();
  assert.equal(panel.hidden, true);
  assert.equal(doc.activeElement, fab, '焦点回到把手，不丢');
  ui.destroy();
});

check('编辑态：状态行/布局下拉收起，正文网格不再占地方', () => {
  const { doc, storage } = makeEnv();
  const ui = initPanel(doc, storage);
  const panel = findByClass(doc.body, 'dshui-panel');
  const grid = findByClass(doc.body, 'dshui-grid');
  assert.equal(grid.style.display, undefined, '网格不能写 inline display，否则 CSS 藏不掉');

  buttonByExactText(doc, '编辑').click();
  assert.ok(panel.classList.contains('is-editing'), '面板进编辑态');
  assert.ok(findByClass(doc.body, 'dshui-body').classList.contains('is-editing'), '正文进编辑态');
  assert.equal(findByClass(doc.body, 'dshui-editor').hidden, false, '编辑器出来');

  buttonByExactText(doc, '收起编辑').click();
  assert.equal(panel.classList.contains('is-editing'), false, '退出编辑态');
  ui.destroy();
});

check('编辑器：动作条在滚动区外面，键盘弹起也点得到', () => {
  const { doc, storage } = makeEnv();
  const ui = initPanel(doc, storage);
  buttonByExactText(doc, '编辑').click();
  const editor = findByClass(doc.body, 'dshui-editor');
  const scroll = findByClass(doc.body, 'dshui-editor-scroll');
  const actions = findByClass(doc.body, 'dshui-editor-actions');
  assert.ok(scroll.contains(findByClass(doc.body, 'dshui-form')), '表单在滚动区里');
  assert.equal(scroll.contains(actions), false, '动作条不在滚动区里');
  assert.equal(editor.children[editor.children.length - 1], actions, '动作条是编辑器最后一项');
  ui.destroy();
});

check('编辑器：打字时重绘不重建输入框（光标不会被踢回开头）', () => {
  const { doc, storage } = makeEnv();
  const ui = initPanel(doc, storage);
  buttonByExactText(doc, '编辑').click();
  const pick = findAll(doc.body, (n) => n.classList.contains('dshui-form-cell-pick'))[0];
  pick.click();
  const labelField = findAll(
    doc.body,
    (n) => n.classList.contains('dshui-field') && n.textContent.startsWith('label'),
  )[0];
  const input = findAll(labelField, (n) => n.tagName === 'input')[0];
  input.focus();
  input.value = '金币';
  input.dispatch('input');

  ui.render();
  const again = findAll(
    findAll(doc.body, (n) => n.classList.contains('dshui-field') && n.textContent.startsWith('label'))[0],
    (n) => n.tagName === 'input',
  )[0];
  assert.equal(again, input, '同一个输入节点，没被换掉');
  assert.equal(doc.activeElement, input, '焦点还在输入框里');
  assert.equal(again.value, '金币', '输入的内容还在');
  ui.destroy();
});

check('编辑器：结构变了（加页面）照样重建表单', () => {
  const { doc, storage } = makeEnv();
  const ui = initPanel(doc, storage);
  buttonByExactText(doc, '编辑').click();
  const before = findAll(doc.body, (n) => n.classList.contains('dshui-form-cell')).length;
  assert.ok(before > 0, '先有控件行');
  buttonByExactText(doc, '＋ 页面').click();
  const after = findAll(doc.body, (n) => n.classList.contains('dshui-form-cell')).length;
  assert.equal(after, 0, '新页没有控件，列表跟着重画');
  assert.ok(findByClass(doc.body, 'dshui-form').textContent.includes('控件 · 0'));
  ui.destroy();
});

check('手机键盘：抽屉按 visualViewport 收缩，关抽屉还原', () => {
  const { doc, storage } = makeEnv();
  const listeners = new Map();
  const vv = {
    height: 500,
    offsetTop: 0,
    addEventListener(type, fn) {
      listeners.set(type, fn);
    },
    removeEventListener() {},
  };
  const fakeWin = {
    innerHeight: 844,
    visualViewport: vv,
    addEventListener() {},
    removeEventListener() {},
  };
  const ui = initPanel(doc, storage, { window: fakeWin });
  const panel = findByClass(doc.body, 'dshui-panel');
  const fab = findByClass(doc.body, 'dshui-fab');

  fab.click();
  assert.equal(panel.style.top, '12px', '顶到可视区上沿');
  assert.equal(panel.style.height, '476px', `高度跟可视区走，实际 ${panel.style.height}`);

  // 键盘弹起来：可视区变矮，抽屉跟着缩
  vv.height = 300;
  listeners.get('resize')();
  assert.equal(panel.style.height, '276px', '键盘弹起后动作条别被键盘挡住');

  findByClass(doc.body, 'dshui-close').click();
  assert.equal(panel.style.height, '', '关抽屉后交还给 CSS');
  ui.destroy();
});

const TWO_PAGES = {
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

const pagePop = (doc) => findByClass(doc.body, 'dshui-page-pop');
const varPop = (doc) => findByClass(doc.body, 'dshui-var-pop');
const pageChip = (doc) => findByClass(findByClass(doc.body, 'dshui-meta'), 'dshui-page-chip');
const varChip = (doc) => findByClass(findByClass(doc.body, 'dshui-meta'), 'dshui-var-chip');

check('折叠：页面/变量默认收成 chip，浮层不开就占一行', () => {
  const { doc, storage } = makeEnv();
  const ui = initPanel(doc, storage, { sample: TWO_PAGES });
  assert.ok(findByClass(doc.body, 'dshui-meta'), '有 meta 条');
  assert.equal(pageChip(doc).hidden, false, '两页时页面 chip 要露出来');
  assert.ok(pageChip(doc).textContent.includes('第一页'), `chip 上要写当前页，实际 ${pageChip(doc).textContent}`);
  assert.equal(pageChip(doc).getAttribute('aria-expanded'), 'false');
  assert.ok(varChip(doc).textContent.includes('变量 · 4'), `变量 chip 要报数量，实际 ${varChip(doc).textContent}`);
  // 浮层默认看不到
  assert.equal(pagePop(doc).hidden, true, '页面浮层默认收起');
  assert.equal(varPop(doc).hidden, true, '变量浮层默认收起');
  ui.destroy();
});

check('折叠：点 chip 展开浮层，两条 chip 互斥', () => {
  const { doc, storage } = makeEnv();
  const ui = initPanel(doc, storage, { sample: TWO_PAGES });
  pageChip(doc).click();
  assert.equal(pagePop(doc).hidden, false, '页面浮层要开');
  assert.equal(pageChip(doc).getAttribute('aria-expanded'), 'true');
  assert.ok(pageChip(doc).textContent.includes('▴'));

  varChip(doc).click();
  assert.equal(pagePop(doc).hidden, true, '开变量浮层时要把页面浮层收掉');
  assert.equal(varPop(doc).hidden, false);

  varChip(doc).click();
  assert.equal(varPop(doc).hidden, true, '再点一次收起');
  assert.equal(JSON.parse(storage.getItem('dshui.ui.v1')).varsOpen, false, '开合状态要记住');
  ui.destroy();
});

check('折叠：Esc 先收浮层，收完才关抽屉', () => {
  const { doc, storage } = makeEnv();
  const ui = initPanel(doc, storage, { sample: TWO_PAGES });
  findByClass(doc.body, 'dshui-fab').click();
  const panel = findByClass(doc.body, 'dshui-panel');

  pageChip(doc).click();
  assert.equal(pagePop(doc).hidden, false);
  panel.dispatch('keydown', { key: 'Escape' });
  assert.equal(pagePop(doc).hidden, true, '第一下 Esc 只收浮层');
  assert.equal(panel.hidden, false, '抽屉还在');

  panel.dispatch('keydown', { key: 'Escape' });
  assert.equal(panel.hidden, true, '第二下 Esc 才关抽屉');
  ui.destroy();
});

check('折叠：点浮层外面收起', () => {
  const { doc, storage } = makeEnv();
  const ui = initPanel(doc, storage, { sample: TWO_PAGES });
  pageChip(doc).click();
  assert.equal(pagePop(doc).hidden, false);
  doc.dispatch('click', { target: findByClass(doc.body, 'dshui-grid') });
  assert.equal(pagePop(doc).hidden, true, '点格子区域就收起');
  ui.destroy();
});

check('折叠：动作切页后 chip 跟上并闪一下', () => {
  const { doc, storage } = makeEnv();
  const ui = initPanel(doc, storage, { sample: TWO_PAGES });
  assert.ok(pageChip(doc).textContent.includes('第一页'));
  findButtonByText(doc.body, '去第二页').click();
  assert.ok(pageChip(doc).textContent.includes('第二页'), `切页后 chip 要改，实际 ${pageChip(doc).textContent}`);
  assert.ok(pageChip(doc).classList.contains('is-flash'), '闪一下，否则界面自己翻页像点错了');
  ui.destroy();
});

check('折叠：单页布局不显示页面 chip', () => {
  const { doc, storage } = makeEnv();
  const ui = initPanel(doc, storage, { sample: LAYOUT });
  assert.equal(pageChip(doc).hidden, true, '只有一页时不用给切换入口');
  assert.equal(varChip(doc).hidden, false);
  ui.destroy();
});

check('复制：控件 ⧉ 生成副本并选中它', () => {
  const { doc, storage } = makeEnv();
  const ui = initPanel(doc, storage);
  buttonByExactText(doc, '编辑').click();
  const before = findAllByClass(doc.body, 'dshui-form-cell').length;
  const rows = findAllByClass(doc.body, 'dshui-form-cell');
  assert.equal(rows.length, before, '每个控件一行');
  // 遍历顺序不保证，按行首编号找第 1 行
  const row1 = rows.find((r) => r.textContent.trim().startsWith('1.'));
  const copyBtn = findAllByClass(row1, 'dshui-icon-btn').find((b) => b.textContent === '⧉');
  assert.ok(copyBtn, '第 1 行要有复制按钮');
  copyBtn.click();
  assert.equal(findAllByClass(doc.body, 'dshui-form-cell').length, before + 1, '多出一个控件');

  // 草稿里检查：id 不重复、区域往下挪了一行、选中的是副本
  const draft = JSON.parse(findByClass(doc.body, 'dshui-editor-text').value);
  const cells = draft.pages ? draft.pages[0].cells : draft.cells;
  const ids = cells.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, `id 不能重复：${ids.join(',')}`);
  assert.equal(cells[1].area[1], cells[0].area[1] + (cells[0].area[3] || 1), '副本默认往下挪一行');
  const active = findAllByClass(doc.body, 'dshui-form-cell-pick').find((n) => n.classList.contains('is-active'));
  assert.ok(active.textContent.startsWith('2.'), `选中副本，实际 ${active.textContent}`);
  ui.destroy();
});

check('复制：页 → 新页 id/控件 id 都不撞', () => {
  const { doc, storage } = makeEnv();
  const ui = initPanel(doc, storage, { sample: TWO_PAGES });
  buttonByExactText(doc, '编辑').click();
  buttonByExactText(doc, '复制页').click();
  const draft = JSON.parse(findByClass(doc.body, 'dshui-editor-text').value);
  const pages = draft.pages;
  assert.equal(pages.length, 3, '两页 → 三页');
  const ids = pages.map((p) => p.id);
  assert.equal(new Set(ids).size, 3, `页面 id 不能重复：${ids.join(',')}`);
  assert.ok(pages[1].title.includes('副本'), `副本标题要带副本，实际 ${pages[1].title}`);
  const cellIds = pages[1].cells.map((c) => c.id);
  assert.equal(new Set(cellIds).size, cellIds.length, '副本页内控件 id 也不能重复');
  ui.destroy();
});

check('复制：成新布局 → 库里多一条，原件还在', () => {
  const { doc, storage } = makeEnv();
  const ui = initPanel(doc, storage, { sample: TWO_PAGES });
  buttonByExactText(doc, '编辑').click();
  buttonByExactText(doc, '复制成新布局').click();
  const lib = JSON.parse(storage.getItem('dshui.layouts.v2'));
  assert.equal(lib.length, 1, '库里应有一条副本');
  assert.ok(lib[0].title.includes('副本'), `标题带副本，实际 ${lib[0].title}`);
  assert.ok(lib[0].id && lib[0].id !== 'sample', '副本要是自己的 id');
  // 复制完切到副本上继续改，且已经不在编辑态
  assert.ok(findByClass(doc.body, 'dshui-note').textContent.includes('副本'));
  assert.equal(findByClass(doc.body, 'dshui-body').classList.contains('is-editing'), false);
  // 选中项指向副本
  assert.equal(JSON.parse(storage.getItem('dshui.selected.v2')).global, lib[0].id);
  assert.equal(JSON.parse(storage.getItem('dshui.layouts.v2')).length, 1, '原件不是库里的示例，所以只多一条');
  ui.destroy();
});

// ---------- v1.2：界面指令（ui / callAsync / durationMs） ----------

const V12_LAYOUT = {
  schema: 'dshui/1',
  title: 'v12',
  grid: { cols: 2, rows: 2 },
  cells: [
    { id: 'c1', kind: 'stat', label: '甲', var: '金币', area: [0, 0, 1, 1] },
    { id: 'c2', kind: 'stat', label: '乙', var: '生命', area: [1, 0, 1, 1] },
    {
      id: 'go',
      kind: 'button',
      label: '抽卡',
      area: [0, 1, 2, 1],
      onClick: { kind: 'call', logic: '抽卡' },
    },
  ],
};

function v12Env(uiFor) {
  return makeEnv({ ilb: { version: '1.2', uiFor } });
}

await checkAsync('v1.2：走 callAsync，先显示「执行中」再出结果', async () => {
  const { doc, storage, fake } = v12Env(() => null);
  const ui = initPanel(doc, storage, { sample: V12_LAYOUT });
  findButtonByText(doc.body, '抽卡').click();
  // 还没等定时器回来：应该是"执行中"
  const footText = () => findByClass(doc.body, 'dshui-foot').textContent;
  assert.ok(footText().includes('执行中'), `点击后立刻要显示执行中，实际 ${footText()}`);
  await sleep(10);
  assert.ok(footText().includes('已执行'), `回来后要出结果，实际 ${footText()}`);
  assert.equal(fake.state.calls.length, 1, '只调一次');
  ui.destroy();
});

await checkAsync('v1.2：durationMs 和 extra[] 都进回执', async () => {
  const { doc, storage } = v12Env(() => null);
  const ui = initPanel(doc, storage, { sample: V12_LAYOUT });
  findButtonByText(doc.body, '抽卡').click();
  await sleep(10);
  const text = findByClass(doc.body, 'dshui-foot').textContent;
  assert.ok(text.includes('你抽到了 SSR'), `extra 要显示，实际 ${text}`);
  assert.ok(text.includes('41ms'), `耗时要显示，实际 ${text}`);
  ui.destroy();
});

await checkAsync('v1.2：ui.toast 顶掉默认回执，并进读屏播报', async () => {
  const { doc, storage } = v12Env((name) => (name === '抽卡' ? { seq: 1, toast: '抽到 SSR 了！' } : null));
  const ui = initPanel(doc, storage, { sample: V12_LAYOUT });
  findButtonByText(doc.body, '抽卡').click();
  await sleep(10);
  assert.ok(findByClass(doc.body, 'dshui-foot').textContent.includes('抽到 SSR 了！'));
  const live = findByClass(doc.body, 'dshui-sr-only');
  assert.ok(live.textContent.includes('抽到 SSR 了！'), `播报区要念出来，实际 ${live.textContent}`);
  ui.destroy();
});

await checkAsync('v1.2：ui.page 切页；页面不存在只提示不报错', async () => {
  const twoPages = {
    title: '两页',
    grid: { cols: 2, rows: 1 },
    pages: [
      {
        id: 'main',
        title: '主界面',
        grid: { cols: 2, rows: 1 },
        cells: [
          {
            id: 'go',
            kind: 'button',
            label: '去背包',
            area: [0, 0, 1, 1],
            onClick: { kind: 'call', logic: '抽卡' },
          },
        ],
      },
      {
        id: 'bag',
        title: '背包',
        grid: { cols: 2, rows: 1 },
        cells: [{ id: 'bag0', kind: 'text', label: '空的', area: [0, 0, 1, 1] }],
      },
    ],
  };
  const { doc, storage } = v12Env(() => ({ seq: 1, page: 'bag' }));
  const ui = initPanel(doc, storage, { sample: twoPages });
  findButtonByText(doc.body, '去背包').click();
  await sleep(10);
  assert.ok(pageChip(doc).textContent.includes('背包'), `要切到背包页，实际 ${pageChip(doc).textContent}`);

  // 目标页不存在：只提示，不抛错，也不切页
  const { doc: doc2, storage: storage2 } = v12Env(() => ({ seq: 2, page: 'nope' }));
  const ui2 = initPanel(doc2, storage2, { sample: twoPages });
  findButtonByText(doc2.body, '去背包').click();
  await sleep(10);
  assert.ok(findByClass(doc2.body, 'dshui-foot').textContent.includes('没有这一页'));
  assert.ok(pageChip(doc2).textContent.includes('主界面'), '不能乱切');
  ui.destroy();
  ui2.destroy();
});

await checkAsync('v1.2：ui.select 给控件打高亮，ui.ask 显示后能点掉', async () => {
  const { doc, storage } = v12Env(() => ({
    seq: 1,
    select: 'c2',
    ask: { title: '确认一下', text: '真的要用吗？', ok: '用了' },
  }));
  const ui = initPanel(doc, storage, { sample: V12_LAYOUT });
  findButtonByText(doc.body, '抽卡').click();
  await sleep(10);
  const picked = findAllByClass(doc.body, 'dshui-cell').filter((n) => n.classList.contains('is-picked'));
  assert.equal(picked.length, 1, '只高亮一个格子');
  assert.equal(picked[0].dataset.cellId, 'c2', `高亮的应是 c2，实际 ${picked[0].dataset.cellId}`);
  const askBox = findByClass(doc.body, 'dshui-ask');
  assert.equal(askBox.hidden, false, '提示条要出现');
  assert.ok(findByClass(doc.body, 'dshui-ask-title').textContent.includes('确认一下'));
  findByClass(doc.body, 'dshui-ask-ok').click();
  assert.equal(findByClass(doc.body, 'dshui-ask').hidden, true, '点掉后消失');
  ui.destroy();
});

await checkAsync('v1.2：同一逻辑同 seq 只生效一次，seq 变大再生效', async () => {
  let seq = 1;
  const { doc, storage } = v12Env(() => ({ seq, toast: `第${seq}次` }));
  const ui = initPanel(doc, storage, { sample: V12_LAYOUT });
  findButtonByText(doc.body, '抽卡').click();
  await sleep(10);
  assert.ok(findByClass(doc.body, 'dshui-foot').textContent.includes('第1次'));

  // 逻辑重放同一个 seq（比如刷新后重放）→ 界面指令丢掉，不再播一次
  findButtonByText(doc.body, '抽卡').click();
  await sleep(10);
  assert.ok(
    !findByClass(doc.body, 'dshui-foot').textContent.includes('第1次'),
    `重复 seq 不能再执行一次，实际 ${findByClass(doc.body, 'dshui-foot').textContent}`,
  );

  seq = 2;
  findButtonByText(doc.body, '抽卡').click();
  await sleep(10);
  assert.ok(findByClass(doc.body, 'dshui-foot').textContent.includes('第2次'));
  ui.destroy();
});

await checkAsync('v1.2：状态行显示 ui 能力', async () => {
  const { doc, storage } = v12Env(() => null);
  const ui = initPanel(doc, storage, { sample: V12_LAYOUT });
  const status = findByClass(doc.body, 'dshui-status').textContent;
  assert.ok(status.includes('v1.2'), `要显示接口版本，实际 ${status}`);
  assert.ok(status.includes('ui'), `要显示 ui 能力，实际 ${status}`);
  ui.destroy();
});

await checkAsync('v1.2：给了 page 就在那一页找 select，找不到只提示、不翻第二页', async () => {
  const twoPages = {
    title: '两页',
    grid: { cols: 2, rows: 1 },
    pages: [
      {
        id: 'main',
        title: '主界面',
        grid: { cols: 2, rows: 1 },
        cells: [
          { id: 'go', kind: 'button', label: '去背包', area: [0, 0, 1, 1], onClick: { kind: 'call', logic: '抽卡' } },
        ],
      },
      {
        id: 'bag',
        title: '背包',
        grid: { cols: 2, rows: 1 },
        cells: [
          { id: 'bag0', kind: 'text', label: '空的', area: [0, 0, 1, 1] },
          { id: 'back', kind: 'button', label: '返回', area: [1, 0, 1, 1], onClick: { kind: 'open', page: 'main' } },
        ],
      },
      {
        id: 'third',
        title: '第三页',
        grid: { cols: 2, rows: 1 },
        cells: [{ id: 'far', kind: 'text', label: '远处', area: [0, 0, 1, 1] }],
      },
    ],
  };
  // select 指到第三页的控件，但逻辑写的是 page: 'bag'
  const { doc, storage } = v12Env(() => ({ seq: 1, page: 'bag', select: 'far' }));
  const ui = initPanel(doc, storage, { sample: twoPages });
  findButtonByText(doc.body, '去背包').click();
  await sleep(10);
  const chip = pageChip(doc).textContent;
  assert.ok(chip.includes('背包'), `page 该赢，实际 ${chip}`);
  assert.ok(!chip.includes('第三页'), `不能翻第二页，实际 ${chip}`);
  const foot = findByClass(doc.body, 'dshui-foot').textContent;
  assert.ok(foot.includes('不在'), `要提示找不到控件，实际 ${foot}`);
  assert.equal(findAllByClass(doc.body, 'dshui-cell').filter((n) => n.classList.contains('is-picked')).length, 0);
  ui.destroy();
});

await checkAsync('v1.2：seq 按 call 返回的 id 分桶（同名逻辑不串台）', async () => {
  let resId = 'B1::L::1';
  const { doc, storage, fake } = makeEnv({
    ilb: { version: '1.2', resId, uiFor: () => ({ seq: 1, toast: '来了' }) },
  });
  const ui = initPanel(doc, storage, { sample: V12_LAYOUT });
  findButtonByText(doc.body, '抽卡').click();
  await sleep(10);
  assert.ok(findByClass(doc.body, 'dshui-foot').textContent.includes('来了'));

  // 同一 seq，但换了一条逻辑（id 不同）→ 新桶，仍然执行
  fake.options.resId = 'B2::L::1';
  findButtonByText(doc.body, '抽卡').click();
  await sleep(10);
  assert.ok(
    findByClass(doc.body, 'dshui-foot').textContent.includes('来了'),
    `换一条逻辑后同 seq 也该执行，实际 ${findByClass(doc.body, 'dshui-foot').textContent}`,
  );
  ui.destroy();
});

await checkAsync('v1.2：被忽略的界面指令要显示出来（uiSkipped）', async () => {
  const { doc, storage } = makeEnv({
    ilb: {
      version: '1.2',
      uiFor: () => null,
      uiSkipped: () => [{ reason: '只有用户点按钮调用时才执行' }],
    },
  });
  const ui = initPanel(doc, storage, { sample: V12_LAYOUT });
  findButtonByText(doc.body, '抽卡').click();
  await sleep(10);
  const foot = findByClass(doc.body, 'dshui-foot').textContent;
  assert.ok(foot.includes('界面指令被忽略'), `要说明被忽略，实际 ${foot}`);
  ui.destroy();
});

// ---------- 布局库（0.11.0） ----------

function libEnv(extra = {}) {
  const one = (id, title) => ({
    id,
    title,
    scope: 'global',
    avatar: '',
    updatedAt: 1700000000000,
    layout: { schema: 'dshui/1', id, title, grid: { cols: 4, rows: 2 }, cells: [{ id: `${id}-c`, kind: 'text', label: title, area: [0, 0, 2, 1] }] },
  });
  return makeEnv({
    storage: { 'dshui.layouts.v2': JSON.stringify([one('a', '甲布局'), one('b', '乙布局')]) },
    ...extra,
  });
}

function libItems(doc) {
  return findAllByClass(doc.body, 'dshui-lib-item');
}

function itemNamed(doc, title) {
  return libItems(doc).find((row) => findByClass(row, 'dshui-lib-name')?.textContent === title) ?? null;
}

function miniIn(row, text) {
  return findAll(row, (n) => n.tagName === 'button' && n.textContent === text)[0] ?? null;
}

check('布局库：点「库」换成库屏，正文让位，列出已存布局', () => {
  const { doc, storage } = libEnv();
  const ui = initPanel(doc, storage);
  ui.open();
  buttonByExactText(doc, '库').click();

  assert.equal(findByClass(doc.body, 'dshui-body').style.display, 'none', '库屏时正文让位');
  assert.notEqual(findByClass(doc.body, 'dshui-lib').style.display, 'none', '库屏可见');
  assert.equal(libItems(doc).length, 2, `应列出 2 条，实际 ${libItems(doc).length}`);
  assert.ok(findByClass(doc.body, 'dshui-lib-count').textContent.includes('2'), '顶部显示条数');
  // 元信息：页数 / 控件数
  assert.ok(findByClass(libItems(doc)[0], 'dshui-lib-meta').textContent.includes('1 控件'));

  buttonByExactText(doc, '返回界面').click();
  assert.notEqual(findByClass(doc.body, 'dshui-body').style.display, 'none', '返回后正文回来');
  ui.destroy();
});

check('布局库：改名写回存储并重绘', () => {
  const { doc, storage } = libEnv();
  const ui = initPanel(doc, storage);
  ui.open();
  buttonByExactText(doc, '库').click();

  miniIn(itemNamed(doc, '甲布局'), '改名').click();
  const input = findByClass(doc.body, 'dshui-lib-rename');
  assert.ok(input, '出现改名输入框');
  input.value = '甲布局 2.0';
  buttonByExactText(doc, '保存').click();

  assert.equal(findByClass(doc.body, 'dshui-lib-rename'), null, '保存后输入框收起');
  assert.ok(itemNamed(doc, '甲布局 2.0'), '列表里是新名字');
  assert.ok(storage.getItem('dshui.layouts.v2').includes('甲布局 2.0'), '存储里也改了');
  ui.destroy();
});

check('布局库：复制出的新条目 id 不同、标题带副本', () => {
  const { doc, storage } = libEnv();
  const ui = initPanel(doc, storage);
  ui.open();
  buttonByExactText(doc, '库').click();

  miniIn(itemNamed(doc, '甲布局'), '复制').click();
  assert.equal(libItems(doc).length, 3, '多出一条');
  const copy = itemNamed(doc, '甲布局 副本');
  assert.ok(copy, '出现「甲布局 副本」');
  assert.notEqual(copy.dataset.id, 'a', '副本不能顶掉原件的 id');
  assert.ok(itemNamed(doc, '甲布局'), '原件还在');
  ui.destroy();
});

check('布局库：↑↓ 调顺序并写回', () => {
  const { doc, storage } = libEnv();
  const ui = initPanel(doc, storage);
  ui.open();
  buttonByExactText(doc, '库').click();

  const order = () => JSON.parse(storage.getItem('dshui.layouts.v2')).map((x) => x.id);
  assert.deepEqual(order(), ['a', 'b'], '初始顺序');

  miniIn(itemNamed(doc, '乙布局'), '↑').click();
  assert.deepEqual(order(), ['b', 'a'], '乙上移到第一位');
  const saved = JSON.parse(storage.getItem('dshui.layouts.v2')).map((x) => x.id);
  assert.deepEqual(saved, ['b', 'a'], '存储顺序也换了');
  // 已经是第一条，↑ 应该置灰（没有处理器）
  assert.ok(miniIn(itemNamed(doc, '乙布局'), '↑').classList.contains('is-off'), '第一条的 ↑ 不可用');
  ui.destroy();
});

check('布局库：删除要点两次，第二次才真删', () => {
  const { doc, storage } = libEnv();
  const ui = initPanel(doc, storage);
  ui.open();
  buttonByExactText(doc, '库').click();

  miniIn(itemNamed(doc, '乙布局'), '删除').click();
  assert.equal(libItems(doc).length, 2, '第一次只是举手，不删');
  const armed = miniIn(itemNamed(doc, '乙布局'), '确认删除');
  assert.ok(armed, '按钮变成「确认删除」');
  armed.click();
  assert.equal(libItems(doc).length, 1, '第二次真删');
  assert.equal(itemNamed(doc, '乙布局'), null);
  assert.ok(!storage.getItem('dshui.layouts.v2').includes('乙布局'), '存储里也没了');
  ui.destroy();
});

check('布局库：点名字应用该布局，下拉跟着变', () => {
  const { doc, storage } = libEnv();
  const ui = initPanel(doc, storage);
  ui.open();
  buttonByExactText(doc, '库').click();

  findByClass(itemNamed(doc, '乙布局'), 'dshui-lib-name').click();
  assert.notEqual(findByClass(doc.body, 'dshui-body').style.display, 'none', '应用后回到正文');
  assert.equal(findByClass(doc.body, 'dshui-layout-select').value, 'b', '下拉选中乙布局');
  assert.ok(findByClass(doc.body, 'dshui-foot').textContent.includes('乙布局'));
  ui.destroy();
});

check('布局库：＋新建 存一个空布局并直接应用', () => {
  const { doc, storage } = libEnv();
  const ui = initPanel(doc, storage);
  ui.open();
  buttonByExactText(doc, '库').click();
  buttonByExactText(doc, '＋ 新建').click();

  const list = JSON.parse(storage.getItem('dshui.layouts.v2'));
  assert.equal(list.length, 3, '库里多一条');
  const made = list.find((x) => x.title === '新布局');
  assert.ok(made, '标题是「新布局」');
  assert.equal(made.layout.cells.length, 1, '新布局只有一个标题格');
  assert.notEqual(findByClass(doc.body, 'dshui-body').style.display, 'none', '新建后直接进正文');
  assert.equal(findByClass(doc.body, 'dshui-layout-select').value, made.id);
  ui.destroy();
});

check('布局库：打开说明会关掉库，两者不叠', () => {
  const { doc, storage } = libEnv();
  const ui = initPanel(doc, storage);
  ui.open();
  buttonByExactText(doc, '库').click();
  findAllByClass(doc.body, 'dshui-head-btn').find((n) => n.textContent === '?').click();

  assert.notEqual(findByClass(doc.body, 'dshui-help').style.display, 'none', '说明可见');
  assert.equal(findByClass(doc.body, 'dshui-lib').style.display, 'none', '库让位');
  ui.destroy();
});

console.log(`panel.test: ${n} passed`);