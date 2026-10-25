/**
 * 校验器：给“手写/粘贴 JSON”的人看。
 * 返回 [{ path, message }]，path 精确到 pages[1].cells[3].area —— 为了能一眼找到地方。
 *
 * 认 cells / widgets 两种键名；错误路径按用户实际写的键名报。
 * P3 起认 pages（多页面），open 动作里的 page 必须在同一份布局里存在。
 */

import {
  GRID_COL_MAX,
  GRID_COL_MIN,
  GRID_ROW_MAX,
  GRID_ROW_MIN,
  ILB_TABS,
  KINDS,
  MAX_CELLS,
  MAX_LIST_ITEMS,
  MAX_PAGES,
  normalizeLayout,
  SCHEMA_ID,
} from './schema.js';

const OPS = new Set(['=', '!=', '>', '<', '>=', '<=', 'truthy', 'falsy', 'empty']);
const COMPARE_OPS = new Set(['=', '!=', '>', '<', '>=', '<=']);
const ACTIONS = new Set(['set', 'add', 'call', 'open']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isScalar(value) {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

/**
 * @param {unknown} raw 用户给的原始布局
 * @param {{ vars?: Record<string, unknown> }} [ctx] 当前变量表，用来提示“变量名可能写错”
 * @returns {{ ok: boolean, errors: Array, warnings: Array, layout: object }}
 */
export function validateLayout(raw, ctx = {}) {
  const errors = [];
  const warnings = [];
  const push = (list, path, message) => list.push({ path, message });

  if (!isPlainObject(raw)) {
    push(errors, '(根)', '布局必须是一个 JSON 对象');
    return { ok: false, errors, warnings, layout: normalizeLayout({}) };
  }

  const layout = normalizeLayout(raw);

  if (raw.schema !== undefined && raw.schema !== SCHEMA_ID) {
    push(errors, 'schema', `版本应为 "${SCHEMA_ID}"，实际是 ${JSON.stringify(raw.schema)}`);
  }
  if (typeof raw.title !== 'string' || !raw.title.trim()) {
    push(errors, 'title', 'title 必须是非空字符串');
  }
  if (raw.scope !== undefined && raw.scope !== 'global' && raw.scope !== 'character') {
    push(errors, 'scope', 'scope 只能是 "global" 或 "character"');
  }
  if (raw.scope === 'character' && (!raw.avatar || typeof raw.avatar !== 'string')) {
    push(warnings, 'avatar', '角色卡布局没写 avatar：保存时会绑定到当前角色');
  }

  const hasPages = Array.isArray(raw.pages);
  const pageIds = new Set();

  if (raw.pages !== undefined && !hasPages) {
    push(errors, 'pages', 'pages 必须是数组');
  }

  if (hasPages) {
    if (raw.cells !== undefined || raw.widgets !== undefined) {
      push(warnings, 'cells', '有 pages 时顶层 cells/widgets 会被忽略（每页自己的 cells 才算）');
    }
    if (raw.pages.length === 0) {
      push(errors, 'pages', 'pages 是空的；至少给一页');
    } else if (raw.pages.length > MAX_PAGES) {
      push(errors, 'pages', `页面太多（${raw.pages.length} 页），上限 ${MAX_PAGES} 页`);
    }

    // 第一遍：收集所有页面 id 与页面级结构。open 的 page 可以指向后面的页面，
    // 所以必须先把 id 全收齐（P3 回归：单遍校验时 "背包 →" 被误报成不存在）
    layout.pages.forEach((page, i) => {
      const at = `pages[${i}]`;
      const rawPage = raw.pages[i];
      if (!isPlainObject(rawPage)) {
        push(errors, at, '页面必须是对象');
        return;
      }
      if (typeof rawPage.id !== 'string' || !rawPage.id.trim()) {
        push(errors, `${at}.id`, '页面必须写 id（open 动作用它跳转）');
      } else if (pageIds.has(page.id)) {
        push(errors, `${at}.id`, `页面 id 重复：「${page.id}」`);
      }
      pageIds.add(page.id);
      if (typeof rawPage.title !== 'string' || !rawPage.title.trim()) {
        push(warnings, `${at}.title`, '没写标题，会显示「' + page.title + '」');
      }
      if (rawPage.grid !== undefined) checkGridOverride(rawPage.grid, `${at}.grid`, { errors, push });
    });

    // 第二遍：校验每页的控件（此时 pageIds 已完整）
    layout.pages.forEach((page, i) => {
      const at = `pages[${i}]`;
      const rawPage = raw.pages[i];
      if (!isPlainObject(rawPage)) return;
      const pageGrid = page.grid;
      const listKey = Array.isArray(rawPage.cells) ? 'cells' : Array.isArray(rawPage.widgets) ? 'widgets' : 'cells';
      const rawList = Array.isArray(rawPage[listKey]) ? rawPage[listKey] : null;
      if (!rawList) {
        push(errors, `${at}.${listKey}`, `${listKey} 必须是数组（这一页的控件）`);
        return;
      }
      validateCells(rawList, page.cells, listKey, `${at}.`, pageGrid.cols, pageGrid.rows, ctx.vars, {
        errors,
        warnings,
        push,
        pageIds,
      });
    });
  } else {
    checkGrid(raw.grid, { errors, push, at: 'grid' });
    const listKey = Array.isArray(raw.cells) ? 'cells' : Array.isArray(raw.widgets) ? 'widgets' : 'cells';
    const rawList = Array.isArray(raw[listKey]) ? raw[listKey] : null;
    if (!rawList) {
      push(errors, listKey, `${listKey} 必须是数组`);
    }
    validateCells(rawList, layout.cells, listKey, '', layout.grid.cols, layout.grid.rows, ctx.vars, {
      errors,
      warnings,
      push,
      pageIds: null,
    });
  }

  return { ok: errors.length === 0, errors, warnings, layout };
}

function checkGrid(rawGrid, { errors, push, at }) {
  if (rawGrid !== undefined && !isPlainObject(rawGrid)) {
    push(errors, at, 'grid 必须是对象');
    return;
  }
  const g = isPlainObject(rawGrid) ? rawGrid : {};
  if (!Number.isInteger(g.cols) || g.cols < GRID_COL_MIN || g.cols > GRID_COL_MAX) {
    push(errors, `${at}.cols`, `grid.cols 必须是 ${GRID_COL_MIN} 到 ${GRID_COL_MAX} 之间的整数`);
  }
  if (!Number.isInteger(g.rows) || g.rows < GRID_ROW_MIN || g.rows > GRID_ROW_MAX) {
    push(errors, `${at}.rows`, `grid.rows 必须是 ${GRID_ROW_MIN} 到 ${GRID_ROW_MAX} 之间的整数`);
  }
}

function checkGridOverride(rawGrid, at, { errors, push }) {
  if (!isPlainObject(rawGrid)) {
    push(errors, at, '页面级 grid 必须是对象（只写想覆盖的 cols/rows/gap 也行）');
    return;
  }
  if (rawGrid.cols !== undefined) {
    if (!Number.isInteger(rawGrid.cols) || rawGrid.cols < GRID_COL_MIN || rawGrid.cols > GRID_COL_MAX) {
      push(errors, `${at}.cols`, `cols 必须是 ${GRID_COL_MIN} 到 ${GRID_COL_MAX} 之间的整数`);
    }
  }
  if (rawGrid.rows !== undefined) {
    if (!Number.isInteger(rawGrid.rows) || rawGrid.rows < GRID_ROW_MIN || rawGrid.rows > GRID_ROW_MAX) {
      push(errors, `${at}.rows`, `rows 必须是 ${GRID_ROW_MIN} 到 ${GRID_ROW_MAX} 之间的整数`);
    }
  }
}

function validateCells(rawList, cells, listKey, prefix, cols, rows, vars, acc) {
  const { errors, warnings, push, pageIds } = acc;

  if (!rawList) return;
  if (rawList.length === 0) {
    push(warnings, `${prefix}${listKey}`, `${listKey} 是空的，这一页会是一片空白`);
  } else if (rawList.length > MAX_CELLS) {
    push(errors, `${prefix}${listKey}`, `控件太多（${rawList.length} 个），上限 ${MAX_CELLS} 个`);
  }

  const seenIds = new Set();
  cells.forEach((cell, i) => {
    const at = `${prefix}${listKey}[${i}]`;
    const rawCell = rawList[i];

    if (!isPlainObject(rawCell)) {
      push(errors, at, '控件必须是对象');
      return;
    }
    if (typeof rawCell.kind !== 'string' && typeof rawCell.type !== 'string') {
      push(warnings, `${at}.kind`, '没写 kind/type，按 stat 处理');
    }

    if (seenIds.has(cell.id)) push(errors, `${at}.id`, `控件 id 重复：「${cell.id}」`);
    seenIds.add(cell.id);

    if (!KINDS.includes(cell.kind)) {
      push(
        warnings,
        `${at}.kind`,
        `「${cell.kind}」不认识，会降级成 stat 的样子；可用：${KINDS.join(' / ')}`,
      );
    }

    const area = cell.area;
    if (!area) {
      push(errors, `${at}.area`, 'area 必须是 4 个整数 [列, 行, 跨列, 跨行]');
    } else {
      const [c, r, cs, rs] = area;
      if (c < 0 || r < 0) push(errors, `${at}.area`, `列/行不能是负数（现在 ${c}, ${r}）；坐标从 0 开始`);
      if (c + cs > cols) push(errors, `${at}.area`, `横向越界：列 ${c} + 跨 ${cs} > 网格 ${cols} 列`);
      if (r + rs > rows) push(errors, `${at}.area`, `纵向越界：行 ${r} + 跨 ${rs} > 网格 ${rows} 行`);
    }

    // ---------- 各控件自己的必填项 ----------
    if (cell.kind === 'stat' || cell.kind === 'number' || cell.kind === 'bar' || cell.kind === 'toggle') {
      if (!cell.var) push(errors, `${at}.var`, `${cell.kind} 必须写 var/bind（绑定哪个变量）`);
    }
    if (cell.kind === 'text' && !cell.text) {
      push(errors, `${at}.text`, 'text 必须写 text（显示的字）');
    }
    if (cell.kind === 'button' && !cell.label) {
      push(errors, `${at}.label`, 'button 必须写 label');
    }
    if (cell.kind === 'list') {
      if (!Array.isArray(cell.items) || cell.items.length === 0) {
        push(errors, `${at}.items`, 'list 必须写 items（至少一项）');
      } else if (cell.items.length > MAX_LIST_ITEMS) {
        push(errors, `${at}.items`, `list 最多 ${MAX_LIST_ITEMS} 项，现在 ${cell.items.length} 项`);
      } else {
        cell.items.forEach((item, j) => {
          if (!item) {
            push(errors, `${at}.items[${j}]`, '列表项必须是字符串或对象');
            return;
          }
          if (!item.label) push(errors, `${at}.items[${j}].label`, '列表项必须写 label');
          if (item.action) {
            checkAction(item.action, `${at}.items[${j}].action`, { errors, warnings, push, vars, pageIds });
          }
        });
      }
    }
    if (cell.kind === 'bar') {
      if (cell.max !== null && !(Number.isFinite(cell.max) && cell.max > 0)) {
        push(errors, `${at}.max`, 'bar 的 max 必须是正数');
      }
    }

    if (cell.var && isPlainObject(vars) && cell.kind !== 'text' && cell.kind !== 'button' && cell.kind !== 'list') {
      if (!Object.prototype.hasOwnProperty.call(vars, cell.var)) {
        if (cell.kind === 'toggle') {
          push(warnings, `${at}.var`, `变量「${cell.var}」当前不存在，开关会显示为“未设置”`);
        } else {
          push(warnings, `${at}.var`, `变量「${cell.var}」当前不存在，界面会显示 —`);
        }
      }
    }

    if (cell.onClick) checkAction(cell.onClick, `${at}.onClick`, { errors, warnings, push, vars, pageIds });

    if (cell.when) {
      cell.when.forEach((cond, j) => {
        const at2 = `${at}.when[${j}]`;
        if (!cond.var) push(errors, `${at2}.var`, '条件必须写 var');
        if (!OPS.has(cond.op)) {
          push(errors, `${at2}.op`, `不认识的比较符 "${cond.op}"，可用：${[...OPS].join(' / ')}`);
        }
        if (COMPARE_OPS.has(cond.op)) {
          if (!('value' in cond)) push(errors, `${at2}.value`, `比较符 "${cond.op}" 需要 value`);
          else if (!isScalar(cond.value)) push(errors, `${at2}.value`, 'value 必须是标量');
        }
      });
    }

    if (cell.decimals !== null && cell.decimals !== undefined) {
      if (!Number.isInteger(cell.decimals) || cell.decimals < 0 || cell.decimals > 6) {
        push(errors, `${at}.decimals`, 'decimals 必须是 0..6 的整数');
      }
    }
  });

  for (let i = 0; i < cells.length; i += 1) {
    for (let j = i + 1; j < cells.length; j += 1) {
      const a = cells[i].area;
      const b = cells[j].area;
      if (a && b && overlaps(a, b)) {
        push(warnings, `${prefix}${listKey}[${j}].area`, `与 ${listKey}[${i}]（${cells[i].id}）重叠，后画的会压在上面`);
      }
    }
  }
}

function checkAction(action, at, { errors, push, pageIds }) {
  if (!ACTIONS.has(action.kind)) {
    push(errors, `${at}.kind`, `点击动作只能是 ${[...ACTIONS].join(' / ')}，现在是 ${JSON.stringify(action.kind)}`);
    return;
  }
  if (action.kind === 'set') {
    if (!action.var) push(errors, `${at}.var`, 'set 必须写 var');
    if (!('value' in action) || !isScalar(action.value)) {
      push(errors, `${at}.value`, 'set 的 value 必须是标量（字符串 / 数字 / 布尔）');
    }
  } else if (action.kind === 'add') {
    if (!action.var) push(errors, `${at}.var`, 'add 必须写 var');
    if (!Number.isFinite(action.by)) push(errors, `${at}.by`, 'add 的 by 必须是数字');
  } else if (action.kind === 'call') {
    if (!action.logic) push(errors, `${at}.logic`, 'call 必须写 logic（逻辑名或 id）');
    if (action.args !== undefined && !isPlainObject(action.args)) {
      push(errors, `${at}.args`, 'call 的 args 必须是对象，键是参数名');
    }
  } else if (action.kind === 'open') {
    if (action.page && action.tab) {
      push(errors, `${at}`, 'open 的 page（切页面）和 tab（开 ILB 面板）只能写一个');
      return;
    }
    if (!action.page && !action.tab) {
      push(errors, `${at}`, 'open 必须写 page（本布局里的页面 id）或 tab（ILB 面板）');
      return;
    }
    if (action.page && pageIds && !pageIds.has(action.page)) {
      push(errors, `${at}.page`, `没有这个页面："${action.page}"；可用：${[...pageIds].join(' / ') || '（无）'}`);
    }
    if (action.tab && !ILB_TABS.includes(action.tab)) {
      push(errors, `${at}.tab`, `没有这个 tab："${action.tab}"；可用：${ILB_TABS.join(' / ')}`);
    }
  }
}

function overlaps(a, b) {
  const [ac, ar, aw, ah] = a;
  const [bc, br, bw, bh] = b;
  return ac < bc + bw && bc < ac + aw && ar < br + bh && br < ar + ah;
}

export function formatIssues(list) {
  if (!Array.isArray(list) || list.length === 0) return '';
  return list.map((x) => `[${x.path}] ${x.message}`).join('\n');
}
