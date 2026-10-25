/**
 * 布局归一化：补默认值、给控件/页面补 id、把写法别名收拢成一种。
 * 归一化只保证“形状可渲染”，不判断对错——对错交给 validate.js。
 *
 * 认识的写法（同一份数据，不要求用户改）：
 *   我们的：{ cells: [{ kind, var, onClick }] }
 *   交接文档的：{ widgets: [{ type, bind, action }] }
 *   多页面：{ pages: [{ id, title, grid?, cells/widgets }] }；只有 cells 时自动成为「主界面」一页。
 */

export const SCHEMA_ID = 'dshui/1';

export const GRID_COL_MIN = 1;
export const GRID_COL_MAX = 24;
export const GRID_ROW_MIN = 1;
export const GRID_ROW_MAX = 24;

export const GRID_DEFAULTS = Object.freeze({
  cols: 12,
  rows: 12,
  gap: 8,
  padding: 12,
  minCellWidth: 44,
  minCellHeight: 28,
});

export const KIND_DEFAULT = 'stat';

/** 真正渲染的控件。未知控件报 warning 并降级成 stat 的样子。 */
export const KINDS = Object.freeze(['stat', 'text', 'button', 'number', 'bar', 'toggle', 'list']);

/** 界面里显示的中文名。存进 JSON 的仍然是 KINDS 里的英文 key。 */
export const KIND_LABELS = Object.freeze({
  stat: '状态',
  text: '文本',
  button: '按钮',
  number: '数字',
  bar: '条形',
  toggle: '开关',
  list: '列表',
});

/** 兼容旧名字。 */
export const KINDS_P1 = KINDS;

export const MAX_LIST_ITEMS = 12;
export const MAX_CELLS = 64;
export const MAX_PAGES = 12;

/** 能打开 ILB 自带面板的 tab（接口 v1.1 的 ui.openPanel 约定）。 */
export const ILB_TABS = Object.freeze(['shelf', 'rules', 'logic', 'snapshots', 'state', 'diagnostics', 'settings']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function asNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function normalizeGrid(raw) {
  const g = isPlainObject(raw) ? raw : {};
  return {
    cols: clampInt(g.cols, GRID_COL_MIN, GRID_COL_MAX, GRID_DEFAULTS.cols),
    rows: clampInt(g.rows, GRID_ROW_MIN, GRID_ROW_MAX, GRID_DEFAULTS.rows),
    gap: clampInt(g.gap, 0, 64, GRID_DEFAULTS.gap),
    padding: clampInt(g.padding, 0, 64, GRID_DEFAULTS.padding),
    minCellWidth: clampInt(g.minCellWidth, 16, 400, GRID_DEFAULTS.minCellWidth),
    minCellHeight: clampInt(g.minCellHeight, 16, 300, GRID_DEFAULTS.minCellHeight),
  };
}

/** 夹到区间内；不是数字就用默认值（不是 0）。 */
function clampInt(value, min, max, fallback) {
  const n = asInt(value, NaN);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function normalizeArea(raw) {
  if (!Array.isArray(raw)) return null;
  if (raw.length !== 4) return null;
  const [c, r, cs, rs] = raw.map((v) => asInt(v, NaN));
  if (![c, r, cs, rs].every(Number.isFinite)) return null;
  if (cs < 1 || rs < 1) return null;
  return [c, r, cs, rs];
}

export function normalizeWhen(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out = [];
  for (const item of raw) {
    if (!isPlainObject(item)) continue;
    const cond = { var: typeof item.var === 'string' ? item.var : '', op: String(item.op ?? '') };
    if (Object.prototype.hasOwnProperty.call(item, 'value')) cond.value = item.value;
    out.push(cond);
  }
  return out.length ? out : null;
}

/**
 * 点击动作归一化。收两种写法：
 *   我们的：onClick: { kind: 'set' | 'add' | 'call' | 'open', ... }
 *   文档的：action:  { kind: 'set' | 'call' | 'open', ... }
 * `add` 不是 ILB 的接口动作，是 UI 侧的“读-算-写”糖（见决策记录 D-U09）。
 * `open` 可以带 page（切页面）或 tab（打开 ILB 面板）；两者都空则由校验器报错。
 */
export function normalizeOnClick(raw) {
  if (!isPlainObject(raw)) return null;
  const kind = String(raw.kind ?? '');

  if (kind === 'set' || kind === 'add') {
    const action = { kind };
    action.var = typeof raw.var === 'string' ? raw.var : '';
    if (kind === 'set') action.value = raw.value;
    // 原样保留，交给 validate 判断“是不是数字”——归一化不替用户改错
    else action.by = raw.by;
    return action;
  }

  if (kind === 'call') {
    const action = { kind };
    action.logic = typeof raw.logic === 'string' ? raw.logic : '';
    // 同上：非对象原样保留，validate 报错；渲染时再用空对象兜底
    action.args = raw.args !== undefined ? raw.args : {};
    if (typeof raw.nonce === 'string' && raw.nonce) action.nonce = raw.nonce;
    if (typeof raw.text === 'string' && raw.text) action.text = raw.text;
    return action;
  }

  if (kind === 'open') {
    const page = typeof raw.page === 'string' ? raw.page : typeof raw.target === 'string' ? raw.target : '';
    const tab =
      typeof raw.tab === 'string' ? raw.tab : typeof raw.panel === 'string' ? raw.panel : '';
    return { kind, page, tab };
  }

  return { kind }; // 未知 kind 保留，交给 validate 报错
}

function normalizeItems(raw) {
  if (!Array.isArray(raw)) return null;
  return raw.map((item) => {
    if (typeof item === 'string') return { label: item, action: null };
    if (!isPlainObject(item)) return null;
    return {
      label: typeof item.label === 'string' ? item.label : '',
      action: normalizeOnClick(item.action ?? item.onClick ?? null),
    };
  });
}

export function normalizeCell(raw, index) {
  const cell = isPlainObject(raw) ? raw : {};
  const id = typeof cell.id === 'string' && cell.id ? cell.id : `cell-${index + 1}`;
  const kindRaw = cell.kind ?? cell.type;
  const varRaw = cell.var ?? cell.bind;
  return {
    id,
    kind: typeof kindRaw === 'string' && kindRaw ? kindRaw : KIND_DEFAULT,
    label: typeof cell.label === 'string' ? cell.label : '',
    var: typeof varRaw === 'string' && varRaw ? varRaw : null,
    area: normalizeArea(cell.area),
    when: normalizeWhen(cell.when),
    onClick: normalizeOnClick(cell.onClick ?? cell.action ?? null),
    format: typeof cell.format === 'string' ? cell.format : null,
    decimals: asNumberOrNull(cell.decimals),
    suffix: typeof cell.suffix === 'string' ? cell.suffix : '',
    prefix: typeof cell.prefix === 'string' ? cell.prefix : '',
    text: typeof cell.text === 'string' ? cell.text : null,
    max: asNumberOrNull(cell.max),
    min: asNumberOrNull(cell.min),
    onLabel: typeof cell.onLabel === 'string' ? cell.onLabel : '开',
    offLabel: typeof cell.offLabel === 'string' ? cell.offLabel : '关',
    items: normalizeItems(cell.items),
    class: typeof cell.class === 'string' ? cell.class : '',
  };
}

export function normalizePage(raw, index, inheritGrid) {
  const page = isPlainObject(raw) ? raw : {};
  const cellsRaw = Array.isArray(page.cells) ? page.cells : Array.isArray(page.widgets) ? page.widgets : [];
  const grid = page.grid !== undefined ? normalizeGrid(page.grid) : { ...inheritGrid };
  return {
    id: typeof page.id === 'string' && page.id ? page.id : index === 0 ? 'main' : `page-${index + 1}`,
    title: typeof page.title === 'string' && page.title ? page.title : index === 0 ? '主界面' : `第 ${index + 1} 页`,
    grid,
    cells: cellsRaw.map(normalizeCell),
  };
}

export function normalizeLayout(raw) {
  const src = isPlainObject(raw) ? raw : {};
  const grid = normalizeGrid(src.grid);
  const pagesRaw = Array.isArray(src.pages) ? src.pages : null;
  const pages =
    pagesRaw && pagesRaw.length
      ? pagesRaw.map((page, i) => normalizePage(page, i, grid))
      : [
          {
            id: 'main',
            title: '主界面',
            grid,
            cells: (Array.isArray(src.cells) ? src.cells : Array.isArray(src.widgets) ? src.widgets : []).map(
              normalizeCell,
            ),
          },
        ];
  return {
    schema: typeof src.schema === 'string' ? src.schema : SCHEMA_ID,
    id: typeof src.id === 'string' ? src.id : '',
    title: typeof src.title === 'string' ? src.title : '未命名面板',
    grid,
    pages,
    // 兼容：没有 pages 时的旧代码/旧测试仍可以读 layout.cells（= 第一页）
    cells: pages[0].cells,
    scope: src.scope === 'character' ? 'character' : 'global',
    avatar: typeof src.avatar === 'string' ? src.avatar : '',
  };
}
