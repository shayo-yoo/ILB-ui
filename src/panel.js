/**
 * 面板：浮窗 + 抽屉 + 变量板 + 多页面网格 + 表单编辑器 + 导入导出。
 *
 * 规则：不用 innerHTML（布局来自用户粘贴的 JSON，等于注入）；所有节点用 createElement 拼。
 * 测试时用 tests/dom-stub.mjs 注入 doc 与 storage，所以这里不直接引用 window。
 */

import {
  addVar,
  callLogic,
  callLogicAsync,
  candidatesOf,
  countsOf,
  extraList,
  hasCallAsync,
  hasCap,
  openIlbPanel,
  outcomeOf,
  probe,
  readSnapshot,
  setVar,
  subscribe,
  toggleVar,
  uiCommandOf,
  varsOf,
  waitForApi,
} from './api.js';
import { buildPlan, findPage, formatValue } from './plan.js';
import { createStore, scopeKey } from './store.js';
import {
  ILB_TABS,
  KIND_LABELS,
  KINDS,
  MAX_PAGES,
  normalizeCell,
  normalizeLayout,
  SCHEMA_ID,
} from './schema.js';
import { formatIssues, validateLayout } from './validate.js';
import { exportText, fileNameFor, importText } from './share.js';
import { HANDLE, avoidTaken, clampHandleY, handleLeft, maxHandleTop } from './placement.js';
import SAMPLE_LAYOUT from '../ui/sample-layout.js';
import { HELP_SECTIONS } from '../ui/help.js';

export const VERSION = '0.10.0';

const GRID_FIELDS = [
  ['cols', '列数'],
  ['rows', '行数'],
  ['gap', '间距'],
  ['padding', '内边距'],
];

/** 从 SillyTavern 拿当前角色卡（没有 ST 时返回空）。 */
function currentAvatar() {
  try {
    const ctx = globalThis.SillyTavern?.getContext?.();
    const list = Array.isArray(ctx?.characters) ? ctx.characters : [];
    const ch = ctx?.characterId !== undefined ? list[ctx.characterId] : null;
    return ch && typeof ch.avatar === 'string' ? ch.avatar : '';
  } catch {
    return '';
  }
}

/** 所有角色卡的 avatar，用来判断“失效的角色卡布局”。 */
function knownAvatars() {
  try {
    const ctx = globalThis.SillyTavern?.getContext?.();
    const list = Array.isArray(ctx?.characters) ? ctx.characters : [];
    return new Set(list.map((ch) => ch?.avatar).filter((x) => typeof x === 'string'));
  } catch {
    return null;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function init(options = {}) {
  const doc = options.document ?? globalThis.document;
  if (!doc || typeof doc.createElement !== 'function' || !doc.body) {
    throw new Error('[dsh-ui] 初始化失败：没有可用的 document');
  }
  const storage = options.storage ?? globalThis.localStorage;
  const sample = options.sample ?? SAMPLE_LAYOUT;
  const getAvatar = options.getAvatar ?? currentAvatar;
  const store = createStore(storage);

  if (globalThis.DSHUI && typeof globalThis.DSHUI.destroy === 'function') {
    globalThis.DSHUI.destroy();
  }

  const state = {
    open: store.loadUi().open === true,
    editing: false,
    mode: 'form', // form | json
    msg: null,
    issues: null,
    formIssues: null,
    disposed: false,
    unsub: null,
    renderQueued: false,
    draft: null, // 编辑中但还没保存的布局
    pageId: null,
    form: { pageIndex: 0, cellIndex: 0 },
    formKey: null, // 表单结构指纹；一样就不重建，避免打字时光标被踢回开头
    importOpen: false,
    importText: '',
    purgeArmed: false,
    handleY: Number(store.loadUi().handleY) || 0, // 0 = 用默认位置（视口 62%）
    help: false, // true = 面板里显示使用说明
    // 预览层：'off' 编辑态（整块编辑器）| 'peek' 长按临时预览 | 'live' 点按锁定交互。
    // 三种状态都发生在抽屉内部，不铺满视口（见 D-U26）。
    preview: 'off',
    vpTop: null, // 最近一次按 visualViewport 算出来的 top/height；用来做抖动抑制
    // v1.2 界面指令：busy 防叠加调用，picked 高亮哪个控件，ask 是那条不阻塞的提示
    busy: false,
    pickedId: '',
    ask: null,
    uiSeq: {}, // 每个逻辑最近消费过的 seq，用来丢弃重放
    vpHeight: null,
    peekArmed: false, // 长按松手的收尾 click 要吃掉，避免顺手锁进交互态
    // 页面 / 变量默认收成两条细 chip（D-U36）：只在点开时弹浮层，不占内容高度。
    metaOpen: {
      pages: store.loadUi().pagesOpen === true,
      vars: store.loadUi().varsOpen === true,
    },
    flashPage: false, // 动作切页后让 chip 闪一下，否则用户以为点错了
    // v1.2 界面指令：pickedId 是要高亮的控件（null = 没有），ask 是「只提示不阻塞」的浮条
    pickedId: null,
    ask: null,
    busy: false, // callAsync 进行中：按钮置灰，防连点
    uiSeq: {}, // 每条逻辑各记一个 seq 水位，只在变大时执行（ILB 侧要求的一次性消费）
  };
  let cancelWait = null;
  let pressTimer = null; // 长按计时器
  let flashTimer = null; // 切页闪烁复位的计时器

  const el = (tag, cls) => {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    return node;
  };
  const win = options.window ?? doc.defaultView ?? globalThis;

  // ---------- 结构 ----------
  const root = el('div', 'dshui-root');

  const fab = el('button', 'dshui-fab');
  fab.setAttribute('type', 'button');
  fab.setAttribute('title', 'ILBUI：点一下展开/收起，按住上下拖可换位置');
  fab.setAttribute('aria-label', '打开 ILBUI');
  fab.setAttribute('aria-expanded', 'false');
  const fabGlyph = el('span', 'dshui-fab-glyph');
  fabGlyph.textContent = '⋮';
  fab.append(fabGlyph);

  const panel = el('section', 'dshui-panel');
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'ILBUI');
  panel.setAttribute('tabindex', '-1');

  const head = el('header', 'dshui-head');
  const dot = el('span', 'dshui-dot');
  const title = el('span', 'dshui-head-title');
  title.textContent = 'ILBUI';
  const build = el('span', 'dshui-build');
  build.textContent = `v${VERSION}`;
  build.title = '扩展版本；如果这里不是最新版本，强制刷新（Ctrl+Shift+R）';
  const helpBtn = el('button', 'dshui-head-btn');
  helpBtn.setAttribute('type', 'button');
  helpBtn.setAttribute('title', '使用说明');
  helpBtn.setAttribute('aria-label', '使用说明');
  helpBtn.textContent = '?';
  const editBtn = el('button', 'dshui-head-btn');
  editBtn.setAttribute('type', 'button');
  editBtn.setAttribute('title', '编辑布局');
  editBtn.setAttribute('aria-label', '编辑布局');
  editBtn.textContent = '编辑';
  const closeBtn = el('button', 'dshui-close');
  closeBtn.setAttribute('type', 'button');
  closeBtn.setAttribute('title', '收起');
  closeBtn.setAttribute('aria-label', '收起');
  closeBtn.textContent = '×';
  head.append(dot, title, build, helpBtn, editBtn, closeBtn);

  const status = el('div', 'dshui-status');

  const toolbar = el('div', 'dshui-toolbar');
  const layoutSelect = el('select', 'dshui-layout-select');
  layoutSelect.setAttribute('aria-label', '选择布局');
  const scopeTag = el('span', 'dshui-scope-tag');
  scopeTag.textContent = '';
  toolbar.append(layoutSelect, scopeTag);

  const tools = el('div', 'dshui-tools');

  const note = el('div', 'dshui-note');
  // 页面 / 变量降级成两条细 chip（D-U36）：常态只占一行 28px，
  // 点开是浮层——浮层不参与布局流，展开不会把下面的格子顶下去。
  const metaRow = el('div', 'dshui-meta');
  const pageChip = el('button', 'dshui-meta-chip dshui-page-chip');
  pageChip.setAttribute('type', 'button');
  const varChip = el('button', 'dshui-meta-chip dshui-var-chip');
  varChip.setAttribute('type', 'button');
  const pagePop = el('div', 'dshui-pop dshui-page-pop');
  pagePop.hidden = true;
  pagePop.setAttribute('role', 'group');
  pagePop.setAttribute('aria-label', '页面列表');
  const varPop = el('div', 'dshui-pop dshui-var-pop');
  varPop.hidden = true;
  varPop.setAttribute('role', 'group');
  varPop.setAttribute('aria-label', '变量列表');
  const pagesBox = el('div', 'dshui-pages');
  const varsBox = el('div', 'dshui-vars');
  pagePop.append(pagesBox);
  varPop.append(varsBox);
  metaRow.append(pageChip, varChip, pagePop, varPop);
  const gridBox = el('div', 'dshui-grid');
  const gridBoxRef = gridBox; // renderGrid 的默认目标；预览层传自己的容器

  // 编辑器
  const editor = el('div', 'dshui-editor');
  editor.hidden = true;
  const editorHint = el('div', 'dshui-editor-hint');
  editorHint.textContent = '表单改完点“应用”预览，满意后“保存”进布局库；高级写法（when、页面级 grid、列表项动作）走 JSON。';
  const modeRow = el('div', 'dshui-mode-row');
  const formModeBtn = el('button', 'dshui-mode-btn');
  formModeBtn.setAttribute('type', 'button');
  formModeBtn.textContent = '表单';
  const jsonModeBtn = el('button', 'dshui-mode-btn');
  jsonModeBtn.setAttribute('type', 'button');
  jsonModeBtn.textContent = 'JSON';
  modeRow.append(formModeBtn, jsonModeBtn);

  const formBox = el('div', 'dshui-form');
  const textarea = el('textarea', 'dshui-editor-text');
  textarea.setAttribute('spellcheck', 'false');
  textarea.setAttribute('placeholder', `{ "schema": "${SCHEMA_ID}", "title": "…", "cells": [] }`);

  const editorActions = el('div', 'dshui-editor-actions');
  const previewBtn = el('button', 'dshui-small-btn dshui-preview-btn');
  previewBtn.setAttribute('type', 'button');
  previewBtn.textContent = '预览';
  previewBtn.setAttribute('title', '按住 = 临时预览（松手回到编辑器）；点一下 = 进入交互模式，再点一次返回编辑');
  previewBtn.setAttribute('aria-label', '预览');
  previewBtn.setAttribute('aria-pressed', 'false');
  const checkBtn = el('button', 'dshui-small-btn');
  checkBtn.setAttribute('type', 'button');
  checkBtn.textContent = '校验';
  const applyBtn = el('button', 'dshui-small-btn');
  applyBtn.setAttribute('type', 'button');
  applyBtn.textContent = '应用';
  const saveGlobalBtn = el('button', 'dshui-small-btn');
  saveGlobalBtn.setAttribute('type', 'button');
  saveGlobalBtn.textContent = '保存（全局）';
  const saveCharBtn = el('button', 'dshui-small-btn');
  saveCharBtn.setAttribute('type', 'button');
  saveCharBtn.textContent = '保存（角色卡）';
  const sampleBtn = el('button', 'dshui-small-btn');
  sampleBtn.setAttribute('type', 'button');
  sampleBtn.textContent = '填入示例';
  const dupLayoutBtn = el('button', 'dshui-small-btn');
  dupLayoutBtn.setAttribute('type', 'button');
  dupLayoutBtn.textContent = '复制成新布局';
  dupLayoutBtn.title = '把当前草稿复制一份进布局库，原件不动——改 2.0 版时用它';
  const closeEditorBtn = el('button', 'dshui-small-btn');
  closeEditorBtn.setAttribute('type', 'button');
  closeEditorBtn.textContent = '收起编辑';
  editorActions.append(previewBtn, checkBtn, applyBtn, saveGlobalBtn, saveCharBtn, dupLayoutBtn, sampleBtn, closeEditorBtn);

  const importBox = el('div', 'dshui-import');
  importBox.hidden = true;
  const importTextEl = el('textarea', 'dshui-import-text');
  importTextEl.setAttribute('spellcheck', 'false');
  importTextEl.setAttribute('placeholder', '把导出的 dshui-*.json 内容粘贴到这里');
  const importRow = el('div', 'dshui-import-actions');
  const importApplyBtn = el('button', 'dshui-small-btn');
  importApplyBtn.setAttribute('type', 'button');
  importApplyBtn.textContent = '导入这段 JSON';
  const importFileInput = el('input', 'dshui-import-file');
  importFileInput.setAttribute('type', 'file');
  importFileInput.setAttribute('accept', 'application/json,.json');
  importFileInput.hidden = true;
  const importFileBtn = el('button', 'dshui-small-btn');
  importFileBtn.setAttribute('type', 'button');
  importFileBtn.textContent = '选择文件…';
  importRow.append(importApplyBtn, importFileBtn, importFileInput);
  importBox.append(importTextEl, importRow);

  const issueBox = el('div', 'dshui-issues');
  // 滚动区只管「表单 / JSON / 导入」：动作条固定在编辑器底部，
  // 手机上键盘弹出来时不会跟着内容一起被推到看不见的地方。
  const editorScroll = el('div', 'dshui-editor-scroll');
  editorScroll.append(formBox, textarea, importBox);
  editor.append(editorHint, modeRow, editorScroll, issueBox, editorActions);

  // 预览层：**在抽屉里面**，占用正文那块地方——不铺满屏幕。
  // 编辑时这里放编辑器，预览时这里放实时网格，两者不共存，面板自己的
  // 标题栏 / 状态行 / 工具栏 / 底栏都留着，看起来还是 ILBUI 的窗口。
  const previewLayer = el('div', 'dshui-preview');
  previewLayer.hidden = true;
  const previewBar = el('div', 'dshui-preview-bar');
  const previewBarText = el('span', 'dshui-preview-text');
  const previewBarBtn = el('button', 'dshui-small-btn');
  previewBarBtn.setAttribute('type', 'button');
  previewBarBtn.textContent = '返回编辑';
  previewBar.append(previewBarText, previewBarBtn);
  const previewGrid = el('div', 'dshui-preview-grid');
  previewLayer.append(previewBar, previewGrid);

  // 预览区 / 编辑区不再共用一屏：编辑是整块编辑器，预览是整块网格，都在抽屉里
  const body = el('div', 'dshui-body');
  body.append(note, metaRow, gridBox, tools, editor);
  const foot = el('div', 'dshui-foot');
  const footText = el('span', 'dshui-foot-text');
  const footMore = el('button', 'dshui-small-btn dshui-foot-more');
  footMore.setAttribute('type', 'button');
  footMore.textContent = '详情';
  footMore.hidden = true;
  foot.append(footText, footMore);

  // 使用说明：和正文互斥显示（面板里没有路由，直接切换可见性）
  const helpBox = el('div', 'dshui-help');
  helpBox.style.display = 'none';

  // 「只提示不阻塞」的浮条（v1.2 ui.ask）：贴在正文底部，点掉就消失，不拦任何操作
  const askBox = el('div', 'dshui-ask');
  askBox.hidden = true;
  askBox.setAttribute('role', 'group');
  askBox.setAttribute('aria-label', '逻辑提示');
  const askTitle = el('div', 'dshui-ask-title');
  const askText = el('div', 'dshui-ask-text');
  const askOk = el('button', 'dshui-small-btn dshui-ask-ok');
  askOk.setAttribute('type', 'button');
  const askRow = el('div', 'dshui-ask-row');
  askRow.append(askOk);
  askBox.append(askTitle, askText, askRow);
  askOk.addEventListener('click', () => {
    state.ask = null;
    renderAsk();
  });

  // 读屏播报区：只在值真的变了的时候写一句话，避免每次 render 都刷屏
  const liveBox = el('div', 'dshui-sr-only');
  liveBox.id = 'dshui-live';
  liveBox.setAttribute('role', 'status');
  liveBox.setAttribute('aria-live', 'polite');
  liveBox.setAttribute('aria-atomic', 'true');
  state.lastLive = '';

  panel.append(head, status, toolbar, body, askBox, previewLayer, foot, helpBox, liveBox);
  root.append(fab, panel);
  doc.body.append(root);

  // ---------- 小工具 ----------
  function clear(node) {
    node.textContent = '';
  }

  function button(text, onClick, cls = '') {
    // 永远带上基础样式：只传 'dshui-icon-btn' 时别把按钮退回浏览器默认的白底
    const node = el('button', `dshui-small-btn ${cls}`.trim());
    node.setAttribute('type', 'button');
    node.textContent = text;
    node.addEventListener('click', onClick);
    return node;
  }

  function field(labelText, control, cls = 'dshui-field') {
    const wrap = el('label', cls);
    const span = el('span', 'dshui-field-label');
    span.textContent = labelText;
    wrap.append(span, control);
    return wrap;
  }

  function textInput(value, onInput, attrs = {}) {
    const input = el('input', 'dshui-input');
    input.setAttribute('type', attrs.type ?? 'text');
    if (attrs.placeholder) input.setAttribute('placeholder', attrs.placeholder);
    if (attrs.min !== undefined) input.setAttribute('min', attrs.min);
    if (attrs.max !== undefined) input.setAttribute('max', attrs.max);
    if (attrs.step !== undefined) input.setAttribute('step', attrs.step);
    if (attrs.ariaLabel) input.setAttribute('aria-label', attrs.ariaLabel);
    input.value = value === null || value === undefined ? '' : String(value);
    input.addEventListener('input', () => onInput(input.value));
    return input;
  }

  function numberInput(value, onInput, attrs = {}) {
    return textInput(value, (raw) => {
      const n = Number(raw);
      onInput(raw.trim() === '' || !Number.isFinite(n) ? null : n);
    }, { type: 'number', ...attrs });
  }

  function selectInput(pairs, value, onChange, attrs = {}) {
    const select = el('select', 'dshui-input dshui-select');
    if (attrs.ariaLabel) select.setAttribute('aria-label', attrs.ariaLabel);
    for (const [val, text] of pairs) {
      const opt = el('option');
      opt.value = String(val);
      opt.textContent = text;
      select.append(opt);
    }
    select.value = value === null || value === undefined ? '' : String(value);
    select.addEventListener('change', () => onChange(select.value));
    return select;
  }

  function ensureSubscribed() {
    if (state.unsub) return;
    state.unsub = subscribe(() => scheduleRender());
  }

  function scheduleRender() {
    if (state.disposed || state.renderQueued) return;
    state.renderQueued = true;
    const run = () => {
      state.renderQueued = false;
      render();
    };
    const raf = globalThis.requestAnimationFrame;
    if (typeof raf === 'function') raf(run);
    else setTimeout(run, 16);
  }

  function applyOpen(save = true, moveFocus = true) {
    const wasOpen = panel.hidden === false;
    panel.hidden = !state.open;
    fab.setAttribute('aria-expanded', state.open ? 'true' : 'false');
    if (state.open) fab.classList.add('is-open');
    else fab.classList.remove('is-open');
    positionHandle();
    if (save) store.saveUi({ open: state.open, handleY: state.handleY });
    // 焦点跟着走：开抽屉后键盘能直接操作，关抽屉后焦点回到把手，不丢在地里
    if (!moveFocus) return;
    if (state.open && !wasOpen) focusFirst();
    else if (!state.open && wasOpen) focusFab();
  }

  /** 抽屉里第一个能聚焦的控件；都找不到就聚焦面板本身。 */
  function focusFirst() {
    const first = collectFocusable(panel)[0];
    if (first) first.focus();
    else if (typeof panel.focus === 'function') panel.focus();
  }

  /** 自己走树收集可聚焦元素：不依赖 querySelectorAll，测试桩里也能跑。 */
  function collectFocusable(node, out = []) {
    if (!node || node.hidden) return out;
    const tag = String(node.tagName || '').toLowerCase();
    const native = tag === 'button' || tag === 'select' || tag === 'input' || tag === 'textarea';
    if (native && !node.disabled && node.getAttribute?.('tabindex') !== '-1') out.push(node);
    for (const child of node.children || []) collectFocusable(child, out);
    return out;
  }

  /** node 是不是 root 的后代（桩 DOM 只有 parent，真 DOM 用 parentNode）。 */
  function inside(node, root) {
    for (let n = node; n; n = n.parent || n.parentNode) if (n === root) return true;
    return false;
  }

  /** 焦点是不是在某个输入框里——是的话就别重建表单/别覆盖它的值。 */
  function isTypingInside(root) {
    const active = doc.activeElement;
    if (!active || !inside(active, root)) return false;
    const tag = String(active.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea';
  }

  function focusFab() {
    if (typeof fab.focus === 'function') fab.focus();
  }

  function closePanel() {
    if (!state.open) return;
    state.open = false;
    applyOpen();
  }

  // ---------- 侧边把手 ----------
  function handleMaxTop() {
    const send = typeof doc.querySelector === 'function' ? doc.querySelector('#send_form') : null;
    let sendTop = NaN;
    if (send && typeof send.getBoundingClientRect === 'function') {
      const r = send.getBoundingClientRect();
      if (r && r.height > 0) sendTop = r.top;
    }
    return maxHandleTop({ viewportHeight: win.innerHeight || 800, sendFormTop: sendTop, height: HANDLE.height });
  }

  /** 别的球（ILB）已经占住的位置；只避让，不接管。 */
  function takenBoxes() {
    const out = [];
    if (typeof doc.querySelectorAll !== 'function') return out;
    for (const node of doc.querySelectorAll('.ilb-fab')) {
      if (!node || node === fab) continue;
      const r = typeof node.getBoundingClientRect === 'function' ? node.getBoundingClientRect() : null;
      if (r && r.height > 0 && r.width > 0) out.push({ top: r.top, bottom: r.bottom });
    }
    return out;
  }

  function positionHandle() {
    if (state.disposed) return;
    applyViewport();
    const maxTop = handleMaxTop();
    let y = clampHandleY(state.handleY || Math.round((win.innerHeight || 800) * 0.62), {
      top: HANDLE.edge,
      maxTop,
      height: HANDLE.height,
    });
    if (!state.open) {
      y = avoidTaken(y, takenBoxes(), { height: HANDLE.height, gap: HANDLE.gap, min: HANDLE.edge, max: maxTop });
      y = clampHandleY(y, { top: HANDLE.edge, maxTop, height: HANDLE.height });
    }
    state.handleY = y;
    fab.style.top = `${y}px`;
    if (state.open) {
      const rect = typeof panel.getBoundingClientRect === 'function' ? panel.getBoundingClientRect() : null;
      if (rect && rect.width > 0) fab.style.left = `${handleLeft({ panelLeft: rect.left })}px`;
      fab.style.right = 'auto';
    } else {
      fab.style.left = 'auto';
      fab.style.right = '';
    }
  }

  /**
   * 手机键盘：visualViewport 描述「真正看得见的那块」，比 100vh / 100dvh 靠谱。
   * 键盘弹起来时把抽屉的 top / height 收到可视区内，否则抽屉下半截
   * （校验结果 + 动作条）会被键盘顶到屏幕外，看不见也点不到。
   * 变化不足 32px 就不动，免得地址栏伸缩时抽屉一直抖。
   */
  function applyViewport() {
    if (state.disposed) return;
    const vv = win.visualViewport;
    if (!vv) return;
    if (!state.open) {
      panel.style.top = '';
      panel.style.height = '';
      state.vpTop = null;
      state.vpHeight = null;
      return;
    }
    const top = Math.round((vv.offsetTop || 0) + 12);
    const height = Math.max(240, Math.round((vv.height || win.innerHeight || 800) - 24));
    if (
      state.vpTop !== null &&
      state.vpHeight !== null &&
      Math.abs(state.vpTop - top) < 32 &&
      Math.abs(state.vpHeight - height) < 32
    ) {
      return;
    }
    state.vpTop = top;
    state.vpHeight = height;
    panel.style.top = `${top}px`;
    panel.style.height = `${height}px`;
  }

  /** 键盘弹起后把正在编辑的输入框滚回可视区。 */
  function revealFocus() {
    const active = doc.activeElement;
    if (!active || !inside(active, panel)) return;
    if (typeof active.scrollIntoView !== 'function') return;
    try {
      active.scrollIntoView({ block: 'nearest' });
    } catch {
      /* 老内核不接受参数对象就算了 */
    }
  }

  function setMsg(tone, text) {
    state.msg = text ? { tone, text } : null;
    announce(text);
  }

  /** 读屏播报：同一句话不重复念（否则每次 render 都会刷屏）。 */
  function announce(text) {
    const next = text ? String(text) : '';
    if (!next || next === state.lastLive) return;
    state.lastLive = next;
    liveBox.textContent = next;
  }

  // ---------- 当前布局与作用域 ----------
  function activeScopeKey() {
    const avatar = getAvatar();
    return avatar ? `char:${avatar}` : 'global';
  }

  function currentLayout() {
    if (state.draft) return state.draft;
    const key = activeScopeKey();
    const id = store.getSelectedId(key) ?? store.getSelectedId('global');
    if (id) {
      const entry = store.getLayout(id);
      if (entry && entry.layout) return entry.layout;
    }
    return sample;
  }

  function usingSample() {
    return !state.draft && currentLayout() === sample;
  }

  function currentPageIndex() {
    const layout = currentLayout();
    const i = layout.pages?.findIndex((p) => p.id === state.pageId) ?? -1;
    return i >= 0 ? i : 0;
  }

  function setPage(pageId) {
    state.pageId = pageId;
    state.metaOpen.pages = false; // 选完就把浮层收起，别挡住刚切过去的页面
    render();
  }

  // ---------- 渲染 ----------
  /** 使用说明只画一次（内容静态）。 */
  function renderHelp() {
    if (helpBox.firstChild) return;
    for (const sec of HELP_SECTIONS) {
      const block = el('section', 'dshui-help-sec');
      const heading = el('h3', 'dshui-help-title');
      heading.textContent = sec.title;
      block.append(heading);
      if (sec.text) {
        const p = el('p', 'dshui-help-text');
        p.textContent = sec.text;
        block.append(p);
      }
      if (sec.bullets) {
        const ul = el('ul', 'dshui-help-list');
        for (const item of sec.bullets) {
          const li = el('li');
          li.textContent = item;
          ul.append(li);
        }
        block.append(ul);
      }
      if (sec.code) {
        const pre = el('pre', 'dshui-help-code');
        pre.textContent = sec.code;
        block.append(pre);
      }
      if (sec.note) {
        const note = el('p', 'dshui-help-note');
        note.textContent = sec.note;
        block.append(note);
      }
      helpBox.append(block);
    }
  }

  function applyHelpUi() {
    const help = state.help === true;
    if (help) renderHelp();
    // 用 style.display 而不是 hidden：这些节点自己有 display:flex，[hidden] 会被 CSS 盖掉
    helpBox.style.display = help ? '' : 'none';
    status.style.display = help ? 'none' : '';
    toolbar.style.display = help ? 'none' : '';
    body.style.display = help ? 'none' : '';
    previewLayer.hidden = help || state.preview === 'off';
    foot.style.display = help ? 'none' : '';
    editBtn.style.display = help ? 'none' : '';
    helpBtn.textContent = help ? '返回' : '?';
    helpBtn.setAttribute('title', help ? '返回界面' : '使用说明');
    helpBtn.setAttribute('aria-label', help ? '返回界面' : '使用说明');
  }

  function render() {
    try {
      applyHelpUi();
      if (state.help !== true) renderBody();
    } catch (err) {
      reportRenderError(err);
    }
  }

  function reportRenderError(err) {
    console.error('[dshui-ui] 渲染失败', err);
    state.msg = { tone: 'bad', text: `渲染出错：${err && err.message ? err.message : err}` };
    try {
      renderFoot();
    } catch {
      /* 连底栏都画不出来就只能看控制台了 */
    }
  }

  function renderBody() {
    if (state.disposed) return;
    const p = probe();
    if (p.state !== 'missing') ensureSubscribed();
    setDot(p);

    const snap = p.state === 'missing' ? null : readSnapshot();
    const vars = varsOf(snap);
    const counts = countsOf(snap);

    status.textContent = statusText(p, counts, vars);

    const layout = currentLayout();
    const plan = buildPlan(layout, vars, { pageId: state.pageId });
    state.pageId = plan.page.id;

    renderToolbar(layout);
    renderTools(layout);
    note.textContent = usingSample()
      ? '内置示例布局（点右上角“编辑”改成你自己的）'
      : `布局：${layout.title || layout.id}`;
    note.classList.toggle('is-sample', usingSample());

    renderMeta(plan, p, vars);
    renderGrid(plan);
    renderEditor(layout);
    // 预览层要的是「当前草稿」的实时网格，和编辑态用的是同一个 plan
    if (state.preview !== 'off') renderGrid(plan, previewGrid);
    renderFoot();
  }

  function setDot(p) {
    dot.className = 'dshui-dot';
    if (p.state === 'ok') dot.classList.add('is-ok');
    else if (p.state === 'legacy') dot.classList.add('is-warn');
    else dot.classList.add('is-bad');
    dot.setAttribute('title', p.reason);
  }

  function statusText(p, counts, vars) {
    if (p.state === 'missing') {
      return 'ILB 未加载 · 在扩展设置里启用 ILB（v0.11.0+）后刷新页面';
    }
    if (p.state === 'legacy') {
      return `${p.reason} · 可用，但少 outcome/nonce 等新能力`;
    }
    const base = `接口 v${p.version} · 书 ${counts.books} · 逻辑 ${counts.logics} · 变量 ${Object.keys(vars).length}`;
    // v1.2 的 ui 能力单独标出来：能显示说明"逻辑可以指挥界面"这条通道通了
    return hasCap('ui') ? `${base} · ui` : base;
  }

  function orphanEntries() {
    const avatars = knownAvatars();
    if (!avatars) return [];
    return store.loadLibrary().filter((entry) => entry.scope === 'character' && entry.avatar && !avatars.has(entry.avatar));
  }

  function renderToolbar(layout) {
    clear(layoutSelect);
    const entries = store.loadLibrary();
    const sampleOpt = el('option');
    sampleOpt.value = '';
    sampleOpt.textContent = '示例布局';
    layoutSelect.append(sampleOpt);

    const deadEntries = new Set(orphansOf(entries));
    for (const entry of entries) {
      const scopeLabel = entry.scope === 'character' ? '角色卡' : '全局';
      const dead = deadEntries.has(entry);
      const opt = el('option');
      opt.value = entry.id;
      opt.textContent = `${entry.title || entry.id}（${scopeLabel}${dead ? ' · 失效' : ''}）`;
      layoutSelect.append(opt);
    }
    const currentId = usingSample() ? '' : layout.id ?? '';
    const known = Boolean(currentId) && entries.some((entry) => entry.id === currentId);
    const isDraft = !usingSample() && !known;
    if (isDraft) {
      const draftOpt = el('option');
      draftOpt.value = '__draft__';
      draftOpt.textContent = `${layout.title || layout.id || '未命名'}（未保存预览）`;
      layoutSelect.append(draftOpt);
    }
    layoutSelect.value = isDraft ? '__draft__' : currentId;

    const key = activeScopeKey();
    const avatar = getAvatar();
    scopeTag.textContent = avatar ? `角色卡 · ${avatar}` : '全局';
    scopeTag.setAttribute('title', key);
  }

  function orphansOf(entries) {
    const avatars = knownAvatars();
    if (!avatars) return [];
    return entries.filter((entry) => entry.scope === 'character' && entry.avatar && !avatars.has(entry.avatar));
  }

  function renderTools() {
    clear(tools);
    tools.append(
      button('导出', () => exportNow()),
      button('导入', () => {
        state.importOpen = !state.importOpen;
        render();
      }),
    );
    const orphans = orphanEntries();
    if (orphans.length) {
      const label = state.purgeArmed ? `确认清理 ${orphans.length} 个？` : `清理失效（${orphans.length}）`;
      tools.append(button(label, () => purgeOrphans(orphans), 'dshui-small-btn dshui-danger-btn'));
    }
  }

  /** 两条 meta chip + 各自的浮层。只改文本与 hidden，不重建节点，避免闪烁。 */
  function renderMeta(plan, p, vars) {
    const pages = plan?.pages ?? [];
    const showPages = pages.length > 1;
    if (!showPages) state.metaOpen.pages = false;
    pageChip.hidden = !showPages;
    if (showPages) {
      const active = pages.find((x) => x.id === plan.page.id);
      pageChip.textContent = `页面 · ${active ? active.title || active.id : '—'} ${state.metaOpen.pages ? '▴' : '▾'}`;
      pageChip.setAttribute('aria-expanded', state.metaOpen.pages ? 'true' : 'false');
      pageChip.setAttribute('title', `共 ${pages.length} 页，点开切换`);
      pageChip.classList.toggle('is-flash', state.flashPage === true);
    }

    const names = Object.keys(vars ?? {});
    const showVars = p.state !== 'missing';
    varChip.hidden = !showVars;
    if (showVars) {
      varChip.textContent = `变量 · ${names.length} ${state.metaOpen.vars ? '▴' : '▾'}`;
      varChip.setAttribute('aria-expanded', state.metaOpen.vars ? 'true' : 'false');
      varChip.setAttribute('title', names.length ? `共 ${names.length} 个变量，点开查看、点数字 +1` : '这条聊天还没有变量');
    }

    pagePop.hidden = !(showPages && state.metaOpen.pages);
    varPop.hidden = !(showVars && state.metaOpen.vars);
    renderPages(plan);
    renderVars(p, vars);
  }

  function toggleMeta(which) {
    const next = !state.metaOpen[which];
    state.metaOpen[which] = next;
    // 两条 chip 共用一个浮层位，同时开两个会互相盖住
    if (next) state.metaOpen[which === 'pages' ? 'vars' : 'pages'] = false;
    store.saveUi(which === 'pages' ? { pagesOpen: next } : { varsOpen: next });
    render();
  }

  /** 点浮层外面 / Esc 时收起；返回 true 表示「确实收了一个」。 */
  function closeMeta() {
    if (!state.metaOpen.pages && !state.metaOpen.vars) return false;
    state.metaOpen.pages = false;
    state.metaOpen.vars = false;
    render();
    return true;
  }

  /** 动作切页时让 chip 闪一下：否则界面"自己翻页"看起来像点错了。 */
  function flashPageChip() {
    state.flashPage = true;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      state.flashPage = false;
      if (!state.disposed) render();
    }, 700);
    render();
  }

  function renderPages(plan) {
    clear(pagesBox);
    if (plan.pages.length <= 1) return;
    for (const page of plan.pages) {
      const tab = el('button', 'dshui-page-tab');
      tab.setAttribute('type', 'button');
      tab.textContent = page.title || page.id;
      tab.setAttribute('title', `${page.id} · ${page.cells} 个控件`);
      if (page.id === plan.page.id) tab.classList.add('is-active');
      tab.addEventListener('click', () => setPage(page.id));
      pagesBox.append(tab);
    }
  }

  function renderVars(p, vars) {
    clear(varsBox);
    if (p.state === 'missing') return;

    const names = Object.keys(vars);
    if (names.length === 0) {
      const empty = el('div', 'dshui-empty');
      const text = el('div', 'dshui-empty-text');
      text.textContent = '这条聊天还没有变量。';
      const btn = button('写入示例变量（金币 / 生命 / 心情 / 灯）', () => seedVars());
      empty.append(text, btn);
      varsBox.append(empty);
      return;
    }

    const headRow = el('div', 'dshui-vars-head');
    const label = el('span', 'dshui-vars-label');
    label.textContent = `变量 · ${names.length}`;
    const hint = el('span', 'dshui-vars-hint');
    hint.textContent = '点数字 +1';
    headRow.append(label, hint);
    varsBox.append(headRow);

    const chips = el('div', 'dshui-chips');
    for (const name of names) {
      const value = vars[name];
      const numeric = typeof value === 'number' && Number.isFinite(value);
      const chip = el(numeric ? 'button' : 'div', 'dshui-chip');
      if (numeric) chip.setAttribute('type', 'button');
      chip.setAttribute('title', `${name}：${formatValue(value)}`);
      const nameEl = el('span', 'dshui-chip-name');
      nameEl.textContent = name;
      const valueEl = el('span', 'dshui-chip-value');
      valueEl.textContent = formatValue(value);
      chip.append(nameEl, valueEl);
      if (numeric) chip.addEventListener('click', () => bump(name));
      chips.append(chip);
    }
    varsBox.append(chips);
  }

  function renderGrid(plan, gridBox = gridBoxRef) {
    clear(gridBox);
    // 这里**不能**写 inline display：编辑态要靠 .dshui-body.is-editing .dshui-grid 的
    // display:none 让位，inline 样式优先级更高，会把编辑时的网格又顶出来（0.8.1 修）
    gridBox.setAttribute('role', 'group');
    gridBox.setAttribute('aria-label', `页面：${plan.page.title || plan.page.id}`);
    gridBox.style.gridTemplateColumns = `repeat(${plan.grid.cols}, minmax(${plan.grid.minCellWidth}px, 1fr))`;
    gridBox.style.gridAutoRows = `minmax(${plan.grid.minCellHeight}px, auto)`;
    gridBox.style.gap = `${plan.grid.gap}px`;
    gridBox.style.padding = `${plan.grid.padding}px`;

    for (const cell of plan.cells) {
      const cls = `dshui-cell dshui-kind-${cell.kind} dshui-tone-${cell.tone}`;
      const clickable = cell.clickable && cell.kind !== 'list';
      const node = el(clickable ? 'button' : 'div', cls);
      if (clickable) node.setAttribute('type', 'button');
      if (cell.degraded) node.classList.add('is-degraded');
      if (cell.id) node.dataset.cellId = cell.id;
      if (state.pickedId && cell.id === state.pickedId) node.classList.add('is-picked');
      node.style.gridColumn = `${cell.area.c + 1} / span ${cell.area.cs}`;
      node.style.gridRow = `${cell.area.r + 1} / span ${cell.area.rs}`;

      if (cell.kind === 'list') {
        renderListCell(node, cell);
      } else if (cell.kind === 'bar') {
        renderBarCell(node, cell);
      } else {
        if (cell.label) {
          const label = el('span', 'dshui-cell-label');
          label.textContent = cell.label;
          node.append(label);
        }
        const text = el('span', 'dshui-cell-text');
        text.textContent = cell.text;
        node.append(text);
        if (cell.sub) {
          const sub = el('span', 'dshui-cell-sub');
          sub.textContent = cell.sub;
          node.append(sub);
        }
        if (cell.kind === 'toggle') {
          node.setAttribute('aria-pressed', cell.state === 'on' ? 'true' : 'false');
          if (cell.state === 'missing') {
            node.classList.add('is-missing');
            node.setAttribute('title', `变量「${cell.var}」不存在——先点变量板里的「写入示例变量」`);
          }
        }
      }

      if (clickable && cell.action) {
        node.addEventListener('click', () => runAction(cell.action));
      }
      gridBox.append(node);
    }
  }

  function renderBarCell(node, cell) {
    const label = el('span', 'dshui-cell-label');
    label.textContent = cell.label;
    const text = el('span', 'dshui-cell-text dshui-bar-value');
    text.textContent = cell.text;
    const track = el('span', 'dshui-bar-track');
    // 读屏语义：进度条告诉辅助技术「现在是多少 / 上限多少」，光靠宽度看不出
    const ratio = cell.ratio ?? 0;
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
    track.setAttribute('aria-valuetext', cell.text);
    track.setAttribute('aria-label', cell.label || '进度');
    const fill = el('span', 'dshui-bar-fill');
    fill.style.width = `${Math.round((cell.ratio ?? 0) * 100)}%`;
    track.append(fill);
    node.append(label, text, track);
  }

  function renderListCell(node, cell) {
    if (cell.label) {
      const label = el('span', 'dshui-cell-label');
      label.textContent = cell.label;
      node.append(label);
    }
    const row = el('span', 'dshui-list');
    for (const item of cell.items ?? []) {
      const btn = el('button', 'dshui-list-item');
      btn.setAttribute('type', 'button');
      btn.textContent = item.label;
      if (item.action) btn.addEventListener('click', () => runAction(item.action));
      else btn.classList.add('is-passive');
      row.append(btn);
    }
    node.append(row);
  }

  // ---------- 编辑器 ----------
  function applyModeUi() {
    const isForm = state.mode === 'form';
    formModeBtn.classList.toggle('is-active', isForm);
    jsonModeBtn.classList.toggle('is-active', !isForm);
    formModeBtn.setAttribute('aria-pressed', String(isForm));
    jsonModeBtn.setAttribute('aria-pressed', String(!isForm));
    formBox.hidden = !isForm;
    textarea.hidden = isForm;
    // 双保险：主题自带的 textarea 样式可能盖掉 [hidden]
    formBox.style.display = isForm ? '' : 'none';
    textarea.style.display = isForm ? 'none' : '';
  }

  function renderEditor(layout) {
    // 预览层占正文的位置：和编辑器、浏览件互斥，但面板外壳（标题栏/状态行/工具栏/底栏）留着
    const previewing = state.preview !== 'off';
    // 编辑态就是整块编辑器：正文的浏览件交给 CSS（.dshui-body.is-editing 下全部 display:none）
    const fullEditor = state.editing && !previewing;
    editor.hidden = !fullEditor;
    editor.classList.toggle('is-open', fullEditor);
    body.classList.toggle('is-editing', fullEditor);
    // 编辑态把状态行/布局下拉也收起来：只留标题栏 + 编辑器 + 动作条，
    // 手机上每一像素都要留给输入框（0.8.1）
    panel.classList.toggle('is-editing', fullEditor);
    editor.style.height = '';
    previewLayer.hidden = !previewing;
    // 预览时正文整块让位（不只是藏网格）：否则会看到「网格 + 编辑器」上下堆着
    body.hidden = previewing;
    body.style.display = previewing ? 'none' : '';
    if (previewing) {
      previewBarText.textContent = state.preview === 'live' ? '交互预览 · 点按钮会真的改变量' : '临时预览 · 松手返回';
      previewBar.classList.toggle('is-live', state.preview === 'live');
      previewBtn.classList.toggle('is-active', state.preview === 'live');
      previewBtn.setAttribute('aria-pressed', state.preview === 'live' ? 'true' : 'false');
      previewBtn.textContent = state.preview === 'live' ? '结束预览' : '预览';
    } else {
      previewBtn.classList.remove('is-active');
      previewBtn.setAttribute('aria-pressed', 'false');
      previewBtn.textContent = '预览';
    }
    applyModeUi();
    importBox.hidden = !state.importOpen;
    if (state.importOpen && doc.activeElement !== importTextEl) importTextEl.value = state.importText;
    if (!fullEditor) return;

    if (state.mode === 'json') {
      if (doc.activeElement !== textarea) textarea.value = JSON.stringify(layout, null, 2);
      renderIssues();
      return;
    }
    renderForm();
    renderIssues();
  }

  /**
   * 结构指纹：只有「结构」变了才重建表单。
   * 输入框里的字变了不算结构变化——重建会把输入节点整个换掉，
   * 光标被扔回开头，打出来的字就成了倒序（手机上尤其明显）。
   */
  function formKey(layout, page, pageIndex) {
    return [
      pageIndex,
      state.form.cellIndex,
      page.id,
      JSON.stringify(layout.grid ?? null),
      page.cells.map((c) => `${c.id}:${c.kind}`).join('|'),
    ].join('#');
  }

  function renderForm(force = false) {
    // 直接改草稿本体：normalizeLayout 会深拷贝，改副本等于白改（P3 回归）
    const layout = state.draft ?? normalizeLayout(currentLayout());
    if (!layout) return;
    const pages = layout.pages;
    const pageIndex = Math.min(Math.max(0, state.form.pageIndex | 0), pages.length - 1);
    state.form.pageIndex = pageIndex;
    const page = pages[pageIndex];
    const key = formKey(layout, page, pageIndex);
    // 正在打字就绝不重建（结构动作都会把焦点移到按钮上，不会被这条挡住）；
    // 结构指纹没变也不用重建
    if (!force) {
      if (isTypingInside(formBox)) return;
      if (state.formKey === key) return;
    }
    state.formKey = key;
    clear(formBox);

    formBox.append(field('标题', textInput(layout.title, (v) => {
      layout.title = v;
      syncJson();
    })));

    const gridRow = el('div', 'dshui-form-row');
    for (const [key, label] of GRID_FIELDS) {
      gridRow.append(
        field(label, numberInput(layout.grid[key], (n) => {
          if (n !== null) {
            layout.grid[key] = n;
            syncJson();
          }
        }, { min: 0, ariaLabel: `网格${label}` })),
      );
    }
    formBox.append(gridRow);

    // 页面
    const pagesRow = el('div', 'dshui-form-row dshui-form-pages');
    pagesRow.append(
      field('页面', selectInput(
        pages.map((p, i) => [String(i), p.title || p.id]),
        pageIndex,
        (raw) => {
          state.form.pageIndex = Number(raw);
          state.form.cellIndex = 0;
          renderForm(true);
        },
      )),
      button('＋ 页面', () => {
        if (pages.length >= MAX_PAGES) {
          setMsg('warn', `页面最多 ${MAX_PAGES} 个`);
          return;
        }
        const n = pages.length + 1;
        pages.push({ id: `page-${n}`, title: `第 ${n} 页`, grid: { ...layout.grid }, cells: [] });
        state.form.pageIndex = pages.length - 1;
        state.form.cellIndex = 0;
        syncJson();
        renderForm(true);
      }),
      button('复制页', () => {
        if (pages.length >= MAX_PAGES) {
          setMsg('warn', `页面最多 ${MAX_PAGES} 个`);
          return;
        }
        const copy = cloneJson(page);
        copy.id = freeId(pages.map((p) => p.id), page.id, 'page');
        copy.title = `${page.title || '页面'} 副本`;
        // 控件 id 只在页内查重，副本自己重新编号，免得跟原件撞
        const used = [];
        copy.cells = (copy.cells ?? []).map((c) => {
          const id = freeId(used, c.id, c.kind || 'cell');
          used.push(id);
          return { ...c, id };
        });
        pages.splice(pageIndex + 1, 0, copy);
        state.form.pageIndex = pageIndex + 1;
        state.form.cellIndex = 0;
        syncJson();
        renderForm(true);
        setMsg('ok', `已复制「${page.title || '页面'}」，改了再保存`);
      }),
      button('删除页', () => {
        if (pages.length <= 1) return;
        pages.splice(pageIndex, 1);
        state.form.pageIndex = Math.max(0, pageIndex - 1);
        state.form.cellIndex = 0;
        syncJson();
        renderForm(true);
      }),
    );
    formBox.append(pagesRow);
    formBox.append(field('页标题', textInput(page.title, (v) => {
      page.title = v;
      syncJson();
    })));

    // 控件列表
    const listHead = el('div', 'dshui-form-subhead');
    listHead.textContent = `控件 · ${page.cells.length}`;
    formBox.append(listHead);

    const list = el('div', 'dshui-form-cells');
    page.cells.forEach((cell, i) => {
      const row = el('div', 'dshui-form-cell');
      const pick = el('button', 'dshui-small-btn dshui-form-cell-pick');
      pick.setAttribute('type', 'button');
      pick.textContent = `${i + 1}. ${KIND_LABELS[cell.kind] ?? cell.kind}${cell.label ? ` · ${cell.label}` : cell.var ? ` · ${cell.var}` : ''}`;
      if (i === state.form.cellIndex) pick.classList.add('is-active');
      pick.addEventListener('click', () => {
        state.form.cellIndex = i;
        renderForm(true);
      });
      row.append(pick);
      const copyBtn = button('⧉', () => copyCell(page, i), 'dshui-icon-btn');
      copyBtn.title = '复制这个控件';
      copyBtn.setAttribute('aria-label', `复制控件 ${i + 1}`);
      row.append(
        button('↑', () => moveCell(page, i, -1), 'dshui-icon-btn'),
        button('↓', () => moveCell(page, i, 1), 'dshui-icon-btn'),
        copyBtn,
        button('删', () => {
          page.cells.splice(i, 1);
          state.form.cellIndex = Math.max(0, Math.min(state.form.cellIndex, page.cells.length - 1));
          syncJson();
          renderForm(true);
        }, 'dshui-icon-btn dshui-danger-btn'),
      );
      list.append(row);
    });
    formBox.append(list);

    const addKind = selectInput(
      KINDS.map((k) => [k, KIND_LABELS[k] ?? k]),
      'stat',
      () => {},
      { ariaLabel: '新增控件类型' },
    );
    const addRow = el('div', 'dshui-form-row');
    addRow.append(addKind, button('＋ 控件', () => {
      const kind = addKind.value || 'stat';
      page.cells.push(
        normalizeCell(
          { kind, label: kind === 'text' ? '' : `新${KIND_LABELS[kind] ?? kind}`, var: ['stat', 'number', 'bar', 'toggle'].includes(kind) ? '金币' : null, area: [0, 0, 1, 1] },
          page.cells.length,
        ),
      );
      state.form.cellIndex = page.cells.length - 1;
      syncJson();
      renderForm(true);
    }));
    formBox.append(addRow);

    const cell = page.cells[state.form.cellIndex];
    if (cell) formBox.append(renderCellForm(cell, page));
  }

  /** 深拷贝：布局是纯 JSON，没有函数/循环引用，JSON 往返就够。 */
  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  /** 在 used 里挑一个不撞的 id：base → base-2 → base-3 … */
  function freeId(used, base, fallback) {
    const root = String(base || fallback || 'item');
    if (!used.includes(root)) return root;
    let n = 2;
    while (used.includes(`${root}-${n}`)) n += 1;
    return `${root}-${n}`;
  }

  /** 复制一个控件：挪到原控件下一行，免得副本正好压在原件上。 */
  function copyCell(page, index) {
    const src = page.cells[index];
    if (!src) return;
    const copy = cloneJson(src);
    copy.id = freeId(page.cells.map((c) => c.id), src.id, src.kind || 'cell');
    const rows = page.grid?.rows ?? layout.grid?.rows ?? 4;
    const area = Array.isArray(src.area) ? [...src.area] : [0, 0, 1, 1];
    area[1] = Math.min(area[1] + area[3], Math.max(0, rows - area[3]));
    copy.area = area;
    page.cells.splice(index + 1, 0, copy);
    state.form.cellIndex = index + 1;
    syncJson();
    renderForm(true);
    setMsg('ok', `已复制 ${KIND_LABELS[src.kind] ?? src.kind}${src.label ? `「${src.label}」` : ''}，区域可能要调`);
  }

  function moveCell(page, index, delta) {
    const to = index + delta;
    if (to < 0 || to >= page.cells.length) return;
    const [cell] = page.cells.splice(index, 1);
    page.cells.splice(to, 0, cell);
    state.form.cellIndex = to;
    syncJson();
    renderForm(true);
  }

  function renderCellForm(cell, page) {
    const box = el('div', 'dshui-cell-form');

    const idLine = el('div', 'dshui-cell-form-id');
    idLine.textContent = `id：${cell.id}`;
    box.append(idLine);

    box.append(field('类型', selectInput(
      KINDS.map((k) => [k, KIND_LABELS[k] ?? k]),
      cell.kind,
      (v) => {
        cell.kind = v;
        syncJson();
        renderForm(true);
      },
    )));

    const areaRow = el('div', 'dshui-form-row');
    const areaLabels = ['列', '行', '跨列', '跨行'];
    areaLabels.forEach((label, i) => {
      areaRow.append(field(`区·${label}`, numberInput(cell.area ? cell.area[i] : null, (n) => {
        const base = cell.area ?? [0, 0, 1, 1];
        base[i] = n === null ? 0 : n;
        cell.area = base;
        syncJson();
      }, { min: 0, ariaLabel: `area${label}` })));
    });
    box.append(areaRow);

    const common = [];
    common.push(field('label', textInput(cell.label, (v) => {
      cell.label = v;
      syncJson();
    })));
    if (['stat', 'number', 'bar', 'toggle'].includes(cell.kind) || !['text', 'button', 'list'].includes(cell.kind)) {
      common.push(field('变量 var', textInput(cell.var, (v) => {
        cell.var = v || null;
        syncJson();
      }, { placeholder: '金币' })));
    }
    if (['text', 'button'].includes(cell.kind)) {
      common.push(field('文字 text', textInput(cell.text ?? (cell.kind === 'button' ? '' : ''), (v) => {
        cell.text = v;
        if (cell.kind === 'button') cell.label = cell.label || v;
        syncJson();
      })));
    }
    box.append(...common);

    if (['stat', 'number'].includes(cell.kind)) {
      const fmtRow = el('div', 'dshui-form-row');
      fmtRow.append(
        field('前缀', textInput(cell.prefix, (v) => { cell.prefix = v; syncJson(); })),
        field('后缀', textInput(cell.suffix, (v) => { cell.suffix = v; syncJson(); })),
        field('小数位', numberInput(cell.decimals, (n) => { cell.decimals = n; syncJson(); }, { min: 0, max: 6 })),
      );
      box.append(fmtRow);
    }
    if (cell.kind === 'bar') {
      const barRow = el('div', 'dshui-form-row');
      barRow.append(
        field('最小值', numberInput(cell.min, (n) => { cell.min = n; syncJson(); })),
        field('最大值', numberInput(cell.max, (n) => { cell.max = n; syncJson(); })),
      );
      box.append(barRow);
    }
    if (cell.kind === 'toggle') {
      const tRow = el('div', 'dshui-form-row');
      tRow.append(
        field('开文字', textInput(cell.onLabel, (v) => { cell.onLabel = v; syncJson(); })),
        field('关文字', textInput(cell.offLabel, (v) => { cell.offLabel = v; syncJson(); })),
      );
      box.append(tRow);
    }
    if (cell.kind === 'list') {
      const textareaEl = el('textarea', 'dshui-input dshui-list-text');
      textareaEl.setAttribute('rows', '4');
      textareaEl.value = (cell.items ?? []).map((item) => item.label).join('\n');
      textareaEl.addEventListener('input', () => {
        cell.items = textareaEl.value
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((label) => ({ label, action: null }));
        syncJson();
      });
      box.append(field('列表项（一行一个）', textareaEl));
    }

    box.append(renderActionEditor(cell));
    return box;
  }

  function renderActionEditor(cell) {
    const wrap = el('div', 'dshui-action-form');
    const action = cell.onClick;
    const kind = action?.kind ?? 'none';
    wrap.append(field('点击动作', selectInput(
      [['none', '无'], ['set', 'set 设置'], ['add', 'add 加/减'], ['call', 'call 调逻辑'], ['open', 'open 打开']],
      kind,
      (v) => {
        if (v === 'none') cell.onClick = null;
        else if (v === 'set') cell.onClick = { kind: 'set', var: '', value: '' };
        else if (v === 'add') cell.onClick = { kind: 'add', var: '', by: 1 };
        else if (v === 'call') cell.onClick = { kind: 'call', logic: '', args: {} };
        else cell.onClick = { kind: 'open', page: '', tab: '' };
        syncJson();
        renderForm(true);
      },
    )));

    if (!action) return wrap;

    const row = el('div', 'dshui-form-row');
    if (action.kind === 'set' || action.kind === 'add') {
      row.append(field('变量', textInput(action.var, (v) => {
        action.var = v;
        syncJson();
      })));
    }
    if (action.kind === 'set') {
      row.append(field('值', textInput(action.value, (v) => {
        action.value = parseScalar(v);
        syncJson();
      }, { placeholder: '数字 / 文字 / true' })));
    }
    if (action.kind === 'add') {
      row.append(field('增减量', numberInput(action.by, (n) => {
        action.by = n ?? 0;
        syncJson();
      }, { step: 1 })));
    }
    if (action.kind === 'call') {
      row.append(field('逻辑名', textInput(action.logic, (v) => {
        action.logic = v;
        syncJson();
      }, { placeholder: '获得/测试道具 或 逻辑 id' })));
      const argsText = el('textarea', 'dshui-input dshui-action-args');
      argsText.setAttribute('rows', '2');
      argsText.setAttribute('placeholder', '{ "数量": 1 }（留空 = 无参数）');
      argsText.value = action.args && Object.keys(action.args).length ? JSON.stringify(action.args) : '';
      argsText.addEventListener('input', () => {
        const raw = argsText.value.trim();
        if (!raw) {
          action.args = {};
          return;
        }
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) action.args = parsed;
        } catch {
          /* 半截 JSON 先不管，apply 时校验会说 */
        }
        syncJson();
      });
      row.append(field('参数 args', argsText));
    }
    if (action.kind === 'open') {
      const layout = state.draft ?? currentLayout();
      const pages = layout.pages ?? [];
      row.append(field('切到页', selectInput(
        [['', '（不切页）'], ...pages.map((p) => [p.id, `${p.title}（${p.id}）`])],
        action.page ?? '',
        (v) => {
          action.page = v;
          syncJson();
        },
      )));
      row.append(field('打开 ILB 面板', selectInput(
        [['', '（不打开）'], ...ILB_TABS.map((t) => [t, t])],
        action.tab ?? '',
        (v) => {
          action.tab = v;
          syncJson();
        },
      )));
    }
    wrap.append(row);
    return wrap;
  }

  function parseScalar(raw) {
    const text = String(raw).trim();
    if (text === 'true') return true;
    if (text === 'false') return false;
    if (text === 'null') return null;
    if (text !== '' && Number.isFinite(Number(text))) return Number(text);
    return raw;
  }

  function syncJson() {
    if (!state.editing) return;
    if (doc.activeElement === textarea) return;
    textarea.value = JSON.stringify(normalizeLayout(state.draft ?? currentLayout()), null, 2);
  }

  function renderIssues() {
    clear(issueBox);
    const issues = state.issues;
    if (!issues) return;
    const { errors = [], warnings = [] } = issues;
    if (errors.length === 0 && warnings.length === 0) {
      const ok = el('div', 'dshui-issue is-ok');
      ok.textContent = '校验通过，可以应用或保存。';
      issueBox.append(ok);
      return;
    }
    for (const item of errors) {
      const row = el('div', 'dshui-issue is-error');
      row.textContent = `[${item.path}] ${item.message}`;
      issueBox.append(row);
    }
    for (const item of warnings) {
      const row = el('div', 'dshui-issue is-warn');
      row.textContent = `[${item.path}] ${item.message}`;
      issueBox.append(row);
    }
  }

  function renderFoot() {
    if (!state.msg) {
      foot.className = 'dshui-foot';
      footText.textContent = '';
      footMore.hidden = true;
      footMore.onclick = null;
      return;
    }
    foot.className = `dshui-foot is-${state.msg.tone}`;
    footText.textContent = state.msg.text;
    footMore.hidden = !state.msg.detail;
    footMore.onclick = state.msg.detail ? () => showIssues(state.msg.detail) : null;
  }

  function showIssues(text) {
    state.editing = true;
    state.issues = { errors: [{ path: '详情', message: text }], warnings: [] };
    render();
  }

  // ---------- 动作 ----------
  function bump(name) {
    const res = addVar(name, 1);
    setMsg(res.ok ? 'ok' : 'bad', res.ok ? `${name} → ${formatValue(res.value)}` : res.reason || '没成功');
    render();
  }

  function seedVars() {
    const seeds = [
      ['金币', 0],
      ['生命', 10],
      ['心情', '平静'],
      ['灯', false],
    ];
    let ok = 0;
    let fail = null;
    for (const [name, value] of seeds) {
      const res = setVar(name, value);
      if (res.ok) ok += 1;
      else fail = res.reason;
    }
    setMsg(ok === seeds.length ? 'ok' : 'bad', ok === seeds.length ? '已写入示例变量' : `写入失败：${fail || '未知原因'}`);
    render();
  }

  function parseDraft() {
    if (state.mode === 'json') {
      try {
        return { value: JSON.parse(textarea.value) };
      } catch (err) {
        return { error: `JSON 解析失败：${err.message}` };
      }
    }
    return { value: state.draft ?? currentLayout() };
  }

  function submitDraft(save, scope) {
    const parsed = parseDraft();
    if (parsed.error) {
      state.issues = { errors: [{ path: '(JSON)', message: parsed.error }], warnings: [] };
      renderIssues();
      return;
    }
    const vars = varsOf(readSnapshot());
    const result = validateLayout(parsed.value, { vars });
    state.issues = { errors: result.errors, warnings: result.warnings };
    if (!result.ok) {
      renderIssues();
      return;
    }

    const layout = normalizeLayout(result.layout);
    state.draft = layout;
    state.pageId = findPage(layout, state.pageId).id;
    state.form.pageIndex = Math.max(0, layout.pages.findIndex((p) => p.id === state.pageId));
    syncJson();

    if (!save) {
      setMsg('ok', '已应用（还没保存）');
      render();
      return;
    }

    const avatar = scope === 'character' ? getAvatar() : '';
    if (scope === 'character' && !avatar) {
      setMsg('warn', '当前没有角色卡，存不了“角色卡”布局；已跳过');
      renderIssues();
      return;
    }
    layout.scope = scope === 'character' ? 'character' : 'global';
    layout.avatar = avatar;
    const entry = store.saveLayout(layout);
    store.setSelectedId(entry.id, scopeKey({ scope: layout.scope, avatar }));
    if (layout.scope === 'global') store.setSelectedId(entry.id, 'global');
    state.draft = null;
    state.editing = false;
    setMsg('ok', `已保存「${entry.title}」（${layout.scope === 'character' ? '角色卡' : '全局'}）`);
    render();
  }

  /**
   * 把当前草稿复制一份进布局库（原件不动），并切到副本上继续编辑。
   * 想要「在现有 UI 上改出 2.0 版」时用这个，比先导出再导入省事。
   */
  function duplicateLayout() {
    const parsed = parseDraft();
    if (parsed.error) {
      setMsg('bad', `先修好 JSON 再复制：${parsed.error}`);
      return;
    }
    const result = validateLayout(parsed.value, {});
    if (!result.ok) {
      state.issues = { errors: result.errors, warnings: result.warnings };
      renderIssues();
      setMsg('bad', '当前草稿有错，复制前先修好（见下面的校验结果）');
      return;
    }
    const copy = cloneJson(normalizeLayout(result.layout));
    copy.id = ''; // 空 id 才会被分配新 id；否则会覆盖原件
    delete copy.id;
    copy.title = `${copy.title || '未命名面板'} 副本`;
    const scope = copy.scope === 'character' ? 'character' : 'global';
    const avatar = scope === 'character' ? getAvatar() : '';
    if (scope === 'character' && !avatar) {
      setMsg('warn', '当前没有角色卡，角色卡布局复制不了；改成全局再试');
      return;
    }
    copy.scope = scope;
    copy.avatar = avatar;
    const entry = store.saveLayout(copy);
    store.setSelectedId(entry.id, scopeKey({ scope, avatar }));
    if (scope === 'global') store.setSelectedId(entry.id, 'global');
    state.draft = null;
    state.editing = false;
    state.pageId = null;
    setMsg('ok', `已复制为「${entry.title}」（原件没动），接着改它就行`);
    render();
  }

  function exportNow() {    try {
      const layout = currentLayout();
      const text = exportText(layout);
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = el('a');
      a.href = url;
      a.download = fileNameFor(layout);
      a.hidden = true;
      doc.body.append(a);
      if (typeof a.click === 'function') a.click();
      a.remove?.();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMsg('ok', `已导出 ${a.download}`);
    } catch (err) {
      setMsg('bad', `导出失败：${err.message}`);
    }
    render();
  }

  function applyImport(text) {
    const result = importText(text);
    if (!result.ok) {
      state.issues = { errors: result.errors, warnings: result.warnings };
      state.importOpen = true;
      state.importText = text;
      setMsg('bad', result.message);
      render();
      return;
    }
    state.draft = result.layout;
    state.pageId = null;
    state.form = { pageIndex: 0, cellIndex: 0 };
    state.formKey = null;
    state.editing = true;
    state.mode = 'form';
    state.importOpen = false;
    state.importText = '';
    state.issues = result.warnings.length ? { errors: [], warnings: result.warnings } : null;
    setMsg('ok', '已导入到预览；检查无误后点“保存（全局 / 角色卡）”');
    render();
  }

  function purgeOrphans(orphans) {
    if (!state.purgeArmed) {
      state.purgeArmed = true;
      setMsg('warn', `再点一次“确认清理”会删掉 ${orphans.length} 个失效角色卡布局（不可撤销）`);
      render();
      return;
    }
    for (const entry of orphans) store.deleteLayout(entry.id);
    state.purgeArmed = false;
    setMsg('ok', `已清理 ${orphans.length} 个失效布局`);
    render();
  }

  async function runAction(action) {
    if (!action) return;
    let res;
    if (action.kind === 'set') res = setVar(action.var, action.value);
    else if (action.kind === 'add') res = addVar(action.var, action.by);
    else if (action.kind === 'toggle') res = toggleVar(action.var);
    else if (action.kind === 'open') {
      if (action.page) {
        const layout = currentLayout();
        const target = (layout.pages ?? []).find((p) => p.id === action.page);
        if (!target) {
          setMsg('bad', `没有页面「${action.page}」`);
        } else {
          switchPage(target, `切到「${target.title}」`);
          return;
        }
        render();
        return;
      }
      const ok = openIlbPanel(action.tab);
      setMsg(ok ? 'ok' : 'warn', ok ? `已打开 ILB 面板：${action.tab}` : '这个 ILB 版本没有 ui.openPanel');
      render();
      return;
    } else if (action.kind === 'call') {
      const opts = {};
      if (action.nonce) opts.nonce = action.nonce;
      if (action.text) opts.text = action.text;
      if (state.busy) return; // v1.2 异步调用还没回来，别叠加
      if (hasCallAsync()) {
        // 先画「执行中…」再让出：callAsync 自己会让一帧
        state.busy = true;
        setMsg('ok', `执行中…（${action.logic}）`);
        renderFoot();
        try {
          res = await callLogicAsync(action.logic, action.args ?? {}, opts);
        } finally {
          state.busy = false;
        }
      } else {
        res = callLogic(action.logic, action.args ?? {}, opts);
      }
    } else {
      res = { ok: false, outcome: 'error', reason: `不认识的点击动作：${action.kind}` };
    }

    const tone = outcomeOf(res);
    if (!res.ok) {
      const candidates = candidatesOf(res);
      const hint = candidates.length
        ? ` · 候选：${candidates.map((c) => `${c.book}/${c.name}（${c.id}）`).join('、')}`
        : '';
      setMsg(tone === 'blocked' ? 'warn' : 'bad', `${res.reason || '操作没成功'}${hint}`);
      render();
      return;
    }
    if (action.kind === 'call') {
      // 「界面」步骤的指令先记账，等这一轮画完再落（见 applyUiCommand）
      const cmd = uiCommandOf(res);
      const parts = [];
      const extra = extraList(res.extra);
      if (extra.length) parts.push(extra.join(' · '));
      if (Number.isFinite(res.durationMs)) parts.push(`${Math.round(res.durationMs)}ms`);
      if (cmd) {
        const done = applyUiCommand(cmd, action.logic);
        if (done.toast) parts.unshift(done.toast);
        setMsg(tone === 'ok' ? 'ok' : 'warn', parts.length ? `已执行 · ${parts.join(' · ')}` : '已执行逻辑');
        render();
        applyUiFocus(done);
        return;
      }
      setMsg(tone === 'ok' ? 'ok' : 'warn', parts.length ? `已执行 · ${parts.join(' · ')}` : '已执行逻辑');
      render();
      return;
    }
    setMsg('ok', `${action.var} → ${formatValue(res.value ?? readValue(action.var))}`);
    render();
  }

  /** 切页统一入口：chip 闪一下 + 收起页面浮层，免得"界面自己翻页"看着像点错了。 */
  function switchPage(target, text) {
    state.pageId = target.id;
    setMsg('ok', text);
    state.metaOpen.pages = false;
    flashPageChip();
    render();
  }

  /**
   * 消费一条 v1.2 界面指令。**只认 v1.2 那几个键**，不做任何求值。
   * 返回 { toast, pageTarget, picked }，真正的滚动/高亮在 render 之后做。
   */
  function applyUiCommand(ui, logicName) {
    const done = { toast: '', pageTarget: null, picked: null };
    // seq 去重：只在变大时执行（ILB 侧要求"每次调用只消费一次"）
    const seq = Number(ui.seq);
    if (Number.isFinite(seq) && seq >= 0) {
      const last = state.uiSeq[logicName];
      if (typeof last === 'number' && seq <= last) return done;
      state.uiSeq[logicName] = seq;
    }
    if (typeof ui.toast === 'string' && ui.toast.trim()) {
      done.toast = clip(ui.toast.trim(), 80);
    }
    if (typeof ui.page === 'string' && ui.page) {
      const layout = currentLayout();
      const target = (layout.pages ?? []).find((p) => p.id === ui.page);
      if (target) {
        state.pageId = target.id;
        state.metaOpen.pages = false;
        flashPageChip();
        done.pageTarget = target;
      } else {
        // 页面不存在：只提示，不报错（契约要求）
        done.toast = done.toast || `逻辑要切到「${ui.page}」，但这个布局没有这一页`;
      }
    }
    if (typeof ui.select === 'string' && ui.select) done.picked = clip(ui.select, 64);
    if (ui.ask && typeof ui.ask === 'object') done.ask = normalizeAsk(ui.ask);
    return done;
  }

  function normalizeAsk(ask) {
    const title = clip(String(ask.title ?? '提示'), 40);
    const text = clip(String(ask.text ?? ''), 120);
    const ok = clip(String(ask.ok ?? '知道了'), 12);
    return { title, text, ok };
  }

  /** 高亮 + 滚到看得见。必须在 render 之后调用（节点那时才存在）。 */
  function applyUiFocus(done) {
    if (done.picked) {
      state.pickedId = done.picked;
      // 选中的控件可能不在当前页：先翻到它所在的页，再找节点
      const onCurrent = currentCells().some((c) => c.id === done.picked);
      if (!onCurrent) {
        const layout = currentLayout();
        const target = (layout.pages ?? []).find((p) => (p.cells ?? []).some((c) => c.id === done.picked));
        if (target && target.id !== state.pageId) {
          state.pageId = target.id;
          state.metaOpen.pages = false;
          flashPageChip();
        }
      }
      render();
      const node = findCellNode(done.picked);
      if (node) {
        try {
          node.scrollIntoView?.({ block: 'nearest' });
        } catch {
          /* 老浏览器没有参数对象就算了 */
        }
      }
    }
    if (done.ask) setAsk(done.ask);
  }

  function currentCells() {
    const layout = currentLayout();
    if (layout.pages && layout.pages.length) {
      const page = layout.pages.find((p) => p.id === state.pageId) ?? layout.pages[0];
      return page.cells ?? [];
    }
    return layout.cells ?? [];
  }

  function findCellNode(id) {
    // 桩环境里没有 querySelectorAll，用 children 树自己走
    const stack = [...gridBox.children];
    while (stack.length) {
      const node = stack.pop();
      if (node.dataset && node.dataset.cellId === id) return node;
      if (node.children) stack.push(...node.children);
    }
    return null;
  }

  function setAsk(ask) {
    state.ask = ask;
    renderAsk();
  }

  /** ui.ask 的渲染：只是提示条，不拦操作、不阻塞后续逻辑（ILB 明确不做可挂起运行时）。 */
  function renderAsk() {
    const ask = state.ask;
    if (!ask) {
      askBox.hidden = true;
      return;
    }
    askBox.hidden = false;
    askTitle.textContent = ask.title;
    askText.textContent = ask.text;
    askText.hidden = !ask.text;
    askOk.textContent = ask.ok;
  }

  function clip(text, max) {
    const s = String(text);
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
  }

  function readValue(name) {
    return varsOf(readSnapshot())[name];
  }

  // ---------- 事件 ----------
  let drag = null;
  fab.addEventListener('pointerdown', (event) => {
    if (event.button != null && event.button !== 0) return;
    drag = { startY: event.clientY, origin: state.handleY, moved: false };
    try {
      fab.setPointerCapture?.(event.pointerId);
    } catch {
      /* ignore */
    }
    fab.classList.add('is-dragging');
  });
  fab.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    const maxTop = handleMaxTop();
    state.handleY = clampHandleY(drag.origin + dy, { top: HANDLE.edge, maxTop, height: HANDLE.height });
    positionHandle();
    event.preventDefault?.();
  });
  const endDrag = () => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    fab.classList.remove('is-dragging');
    if (moved) {
      state.suppressClick = true;
      store.saveUi({ handleY: state.handleY });
      setTimeout(() => {
        state.suppressClick = false;
      }, 0);
    }
  };
  fab.addEventListener('pointerup', endDrag);
  fab.addEventListener('pointercancel', endDrag);
  fab.addEventListener('click', () => {
    if (state.suppressClick) return;
    state.open = !state.open;
    applyOpen();
    render();
  });
  closeBtn.addEventListener('click', () => {
    state.open = false;
    applyOpen();
  });
  pageChip.addEventListener('click', () => toggleMeta('pages'));
  varChip.addEventListener('click', () => toggleMeta('vars'));
  // 点浮层外面收起。用 pointerdown 记账，是因为 setPage/bump 会立即重画，
  // 等 click 冒泡到 document 时目标节点已经被摘掉了，contains() 会误判成"外面"。
  let pressInMeta = false;
  const onMetaPointerDown = (ev) => {
    const t = ev.target;
    pressInMeta = !!(t && (metaRow.contains(t) || pagePop.contains(t) || varPop.contains(t)));
  };
  const onDocClick = (ev) => {
    if (state.disposed) return;
    if (!state.metaOpen.pages && !state.metaOpen.vars) {
      pressInMeta = false;
      return;
    }
    const t = ev.target;
    const inside = pressInMeta || !!(t && (metaRow.contains(t) || pagePop.contains(t) || varPop.contains(t)));
    pressInMeta = false;
    if (!inside) closeMeta();
  };
  doc.addEventListener('pointerdown', onMetaPointerDown, true);
  doc.addEventListener('click', onDocClick);
  helpBtn.addEventListener('click', () => {
    if (state.preview !== 'off') {
      state.preview = 'off';
      cancelPress();
    }
    state.help = state.help !== true;
    render();
  });
  editBtn.addEventListener('click', () => {
    if (state.editing) {
      state.editing = false;
      state.preview = 'off';
      cancelPress();
      render();
      return;
    }
    state.editing = true;
    state.preview = 'off';
    state.draft = normalizeLayout(currentLayout());
    state.form = { pageIndex: currentPageIndex(), cellIndex: 0 };
    state.formKey = null;
    state.mode = 'form';
    state.issues = null;
    syncJson();
    render();
  });
  formModeBtn.addEventListener('click', () => switchMode('form'));
  jsonModeBtn.addEventListener('click', () => switchMode('json'));

  // ---------- 预览按钮：按住看，点按进交互 ----------
  // 阈值可注入：测试里传 longPressMs 就能免掉真实计时
  const LONG_PRESS_MS = Number.isFinite(options.longPressMs) ? options.longPressMs : 220;
  const setTimer = typeof options.setTimer === 'function' ? options.setTimer : (fn, ms) => setTimeout(fn, ms);
  const clearTimer = typeof options.clearTimer === 'function' ? options.clearTimer : (id) => clearTimeout(id);

  function cancelPress() {
    if (pressTimer === null) return;
    clearTimer(pressTimer);
    pressTimer = null;
  }

  function startPress() {
    if (!state.editing) return;
    cancelPress();
    state.peekArmed = false; // 新一轮按压：清掉上一轮没被 click 消费的标记
    pressTimer = setTimer(() => {
      pressTimer = null;
      // 长按成立：临时预览（松手就回去）
      state.preview = 'peek';
      state.peekArmed = true;
      render();
    }, LONG_PRESS_MS);
  }

  /** 松手：临时预览结束；点按锁定态不在这里结束。 */
  function endPress() {
    const wasPeek = state.preview === 'peek';
    cancelPress();
    if (wasPeek) {
      state.preview = 'off';
      render();
    }
  }

  previewBtn.addEventListener('pointerdown', (ev) => {
    if (ev.button != null && ev.button !== 0) return;
    if (state.preview === 'live') return; // 锁定态由 click 负责退出
    startPress();
    ev.preventDefault?.();
  });
  previewBtn.addEventListener('pointerup', () => {
    endPress();
  });
  previewBtn.addEventListener('pointercancel', () => {
    cancelPress();
    if (state.preview === 'peek') {
      state.preview = 'off';
      render();
    }
  });
  previewBtn.addEventListener('pointerleave', () => {
    // 指针移出按钮也算松手，避免临时预览卡住
    if (state.preview === 'peek') endPress();
  });

  previewBtn.addEventListener('click', () => {
    // 长按松手后浏览器还会补一个 click，用 peekArmed 吃掉它
    if (state.peekArmed) {
      state.peekArmed = false;
      return;
    }
    if (state.preview === 'live') {
      state.preview = 'off';
    } else {
      state.preview = 'live';
    }
    render();
  });

  previewBarBtn.addEventListener('click', () => {
    state.preview = 'off';
    render();
  });
  // Esc：先退预览，再关抽屉（键盘用户的常规预期）
  panel.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (state.preview !== 'off') {
      state.preview = 'off';
      render();
      return;
    }
    // 浮层先收，浮层不在才关抽屉：Esc 的层级要跟视觉遮挡顺序一致
    if (closeMeta()) return;
    closePanel();
  });

  /** 切换表单/JSON：先无条件把界面切过去，再做解析与重绘，避免解析/渲染出错时卡在旧页签。 */
  function switchMode(mode) {
    state.mode = mode;
    // 换页签一定重画表单：JSON 里可能改过值，结构指纹看不出这些变化
    state.formKey = null;
    applyModeUi();
    try {
      if (mode === 'form' && state.editing) {
        // 从 JSON 切回表单：先尽力解析 textarea
        try {
          const parsed = JSON.parse(textarea.value);
          const result = validateLayout(parsed, {});
          if (result.ok) state.draft = normalizeLayout(result.layout);
        } catch {
          /* 半截 JSON：保留旧草稿 */
        }
      }
      if (mode === 'json') syncJson();
      render();
    } catch (err) {
      reportRenderError(err);
    }
  }
  checkBtn.addEventListener('click', () => {
    const parsed = parseDraft();
    if (parsed.error) {
      state.issues = { errors: [{ path: '(JSON)', message: parsed.error }], warnings: [] };
      renderIssues();
      return;
    }
    const vars = varsOf(readSnapshot());
    const result = validateLayout(parsed.value, { vars });
    state.issues = { errors: result.errors, warnings: result.warnings };
    renderIssues();
  });
  applyBtn.addEventListener('click', () => submitDraft(false, 'global'));
  saveGlobalBtn.addEventListener('click', () => submitDraft(true, 'global'));
  saveCharBtn.addEventListener('click', () => submitDraft(true, 'character'));
  dupLayoutBtn.addEventListener('click', duplicateLayout);
  sampleBtn.addEventListener('click', () => {
    state.draft = normalizeLayout(sample);
    state.form = { pageIndex: 0, cellIndex: 0 };
    state.formKey = null;
    state.pageId = null;
    state.issues = null;
    syncJson();
    render();
  });
  closeEditorBtn.addEventListener('click', () => {
    state.editing = false;
    state.preview = 'off';
    cancelPress();
    render();
  });
  importApplyBtn.addEventListener('click', () => applyImport(importTextEl.value));
  importTextEl.addEventListener('input', () => {
    state.importText = importTextEl.value;
  });
  importFileBtn.addEventListener('click', () => {
    if (typeof importFileInput.click === 'function') importFileInput.click();
  });
  importFileInput.addEventListener('change', () => {
    const file = importFileInput.files && importFileInput.files[0];
    if (!file) return;
    if (typeof globalThis.FileReader !== 'function') {
      setMsg('bad', '这个环境不支持读本地文件，请把 JSON 粘贴到上面的框里');
      render();
      return;
    }
    const reader = new globalThis.FileReader();
    reader.onload = () => applyImport(String(reader.result ?? ''));
    reader.onerror = () => {
      setMsg('bad', '读文件失败');
      render();
    };
    reader.readAsText(file);
  });
  layoutSelect.addEventListener('change', () => {
    const id = layoutSelect.value;
    if (id === '__draft__') {
      render();
      return;
    }
    state.draft = null;
    state.editing = false;
    state.preview = 'off';
    cancelPress();
    state.pageId = null;
    store.setSelectedId(id || null, activeScopeKey());
    if (!id) store.setSelectedId(null, 'global');
    render();
  });

  // ---------- 启动 ----------
  // 首屏恢复「上次是打开的」不算用户操作，不抢焦点
  applyOpen(false, false);
  render();

  // ILB 可能比我们晚加载：听 ilb:ready + 轮询兜底，就绪后补订阅、重画。
  cancelWait = waitForApi(
    () => {
      if (state.disposed) return;
      ensureSubscribed();
      render();
    },
    { interval: 500, timeout: 15000 },
  );

  // ---------- 视口（手机键盘 / 横竖屏） ----------
  const viewport = win.visualViewport;
  let revealTimer = 0;
  const onViewportResize = () => {
    applyViewport();
    positionHandle();
    // 等收起键盘的动画走完再滚，否则算出来的位置是旧的
    clearTimeout(revealTimer);
    revealTimer = setTimeout(revealFocus, 120);
  };
  const onViewportScroll = () => {
    applyViewport();
    positionHandle();
  };
  if (viewport && typeof viewport.addEventListener === 'function') {
    viewport.addEventListener('resize', onViewportResize);
    viewport.addEventListener('scroll', onViewportScroll);
  }
  if (typeof win.addEventListener === 'function') win.addEventListener('resize', onViewportResize);

  const controller = {
    version: VERSION,
    open: () => {
      state.open = true;
      applyOpen();
      render();
    },
    close: () => {
      state.open = false;
      applyOpen();
    },
    toggle: () => {
      state.open = !state.open;
      applyOpen();
      render();
    },
    edit: () => {
      state.editing = true;
      render();
    },
    render,
    probe,
    reposition: () => {
      applyViewport();
      positionHandle();
    },
    destroy,
    root,
  };

  function destroy() {
    state.disposed = true;
    clearTimeout(revealTimer);
    if (viewport && typeof viewport.removeEventListener === 'function') {
      viewport.removeEventListener('resize', onViewportResize);
      viewport.removeEventListener('scroll', onViewportScroll);
    }
    if (typeof win.removeEventListener === 'function') win.removeEventListener('resize', onViewportResize);
    if (typeof doc.removeEventListener === 'function') {
      doc.removeEventListener('pointerdown', onMetaPointerDown, true);
      doc.removeEventListener('click', onDocClick);
    }
    if (state.unsub) {
      try {
        state.unsub();
      } catch {
        /* ignore */
      }
      state.unsub = null;
    }
    if (typeof cancelWait === 'function') cancelWait();
    if (typeof cancelPress === 'function') cancelPress();
    // 预览层是 panel 的子节点（见 D-U26），root.remove() 会一并摘掉
    root.remove();
    if (globalThis.DSHUI === controller) delete globalThis.DSHUI;
  }

  globalThis.DSHUI = controller;
  return controller;
}
