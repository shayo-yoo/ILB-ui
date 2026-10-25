/**
 * 纯函数层：layout + vars → 渲染计划。
 *
 * 这一层不碰 DOM、不碰 ILB，只用普通对象，所以 Node 里能直接测。
 * panel.js 只负责把这里的计划画出来。
 */

import { KINDS, normalizeLayout } from './schema.js';

/** 把值格式化成界面文字。 */
export function formatValue(value, cell = {}) {
  const prefix = typeof cell.prefix === 'string' ? cell.prefix : '';
  const suffix = typeof cell.suffix === 'string' ? cell.suffix : '';
  const decimals = Number.isInteger(cell.decimals) ? cell.decimals : null;

  if (value === undefined) return '—';
  if (value === null) return '—';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '—';
    const body = decimals !== null ? value.toFixed(decimals) : trimNumber(value);
    return `${prefix}${body}${suffix}`;
  }
  if (typeof value === 'boolean') return value ? '是' : '否';
  const text = String(value);
  if (text === '') return '（空）';
  return `${prefix}${text}${suffix}`;
}

function trimNumber(n) {
  if (Number.isInteger(n)) return String(n);
  const rounded = Math.round(n * 100) / 100;
  return String(rounded);
}

function toNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return NaN;
}

function looseEqual(a, b) {
  const na = toNumber(a);
  const nb = toNumber(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  return String(a) === String(b);
}

/** 单个条件；变量不存在时：empty/falsy 为真，其余为假。 */
export function evalCond(cond, vars = {}) {
  if (!cond || typeof cond.var !== 'string' || !cond.var) return false;
  const has = Object.prototype.hasOwnProperty.call(vars, cond.var);
  const actual = has ? vars[cond.var] : undefined;

  switch (cond.op) {
    case 'truthy':
      return Boolean(actual);
    case 'falsy':
      return !actual;
    case 'empty':
      return !has || actual === undefined || actual === null || actual === '';
    default:
      break;
  }

  if (!has) return false;
  if (cond.op === '=') return looseEqual(actual, cond.value);
  if (cond.op === '!=') return !looseEqual(actual, cond.value);

  const a = toNumber(actual);
  const b = toNumber(cond.value);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  switch (cond.op) {
    case '>':
      return a > b;
    case '<':
      return a < b;
    case '>=':
      return a >= b;
    case '<=':
      return a <= b;
    default:
      return false;
  }
}

/** when 是 AND。 */
export function evalWhen(when, vars = {}) {
  if (!Array.isArray(when) || when.length === 0) return true;
  return when.every((cond) => evalCond(cond, vars));
}

/** 0..1 的比例；max 不是有效数字时按 100 算。 */
export function ratioOf(value, cell = {}) {
  const n = toNumber(value);
  if (!Number.isFinite(n)) return 0;
  const max = Number.isFinite(cell.max) ? cell.max : 100;
  const min = Number.isFinite(cell.min) ? cell.min : 0;
  if (max === min) return n >= max ? 1 : 0;
  return Math.min(1, Math.max(0, (n - min) / (max - min)));
}

/**
 * 生成渲染计划。
 * @param {object} rawLayout 未归一化的布局也可以
 * @param {Record<string, unknown>} vars
 * @param {{ pageId?: string }} [opts] 画哪一页；空/找不到时画第一页
 * @returns {{ title: string, grid: object, cells: Array<object>, page: object, pages: Array<object> }}
 */
export function buildPlan(rawLayout, vars = {}, opts = {}) {
  const layout = normalizeLayout(rawLayout);
  const safeVars = vars && typeof vars === 'object' ? vars : {};
  const page = findPage(layout, opts.pageId);
  const cells = [];

  for (const cell of page.cells) {
    if (!cell.area) continue; // 坏 area 交给校验器报，这里不画
    if (!evalWhen(cell.when, safeVars)) continue;
    cells.push(planCell(cell, safeVars));
  }

  return {
    title: layout.title,
    grid: page.grid ?? layout.grid,
    cells,
    page: { id: page.id, title: page.title },
    pages: layout.pages.map((p) => ({ id: p.id, title: p.title, cells: p.cells.length })),
  };
}

/** 按 id 找页面；找不到回第一页。 */
export function findPage(layout, pageId) {
  if (!pageId) return layout.pages[0];
  return layout.pages.find((p) => p.id === pageId) ?? layout.pages[0];
}

function planCell(cell, vars) {
  const known = KINDS.includes(cell.kind);
  const kind = known ? cell.kind : 'stat';
  const hasVar = Boolean(cell.var) && Object.prototype.hasOwnProperty.call(vars, cell.var);
  const value = hasVar ? vars[cell.var] : undefined;

  const plan = {
    key: cell.id,
    id: cell.id,
    kind,
    degraded: !known,
    area: { c: cell.area[0], r: cell.area[1], cs: cell.area[2], rs: cell.area[3] },
    label: '',
    text: '',
    sub: '',
    tone: 'plain',
    clickable: Boolean(cell.onClick),
    action: cell.onClick ?? null,
  };

  if (kind === 'text') {
    plan.text = cell.text ?? '';
    return plan;
  }

  if (kind === 'button') {
    plan.text = cell.label || '按钮';
    return plan;
  }

  if (kind === 'bar') {
    const ratio = ratioOf(value, cell);
    plan.label = cell.label || cell.var || '';
    plan.text = formatValue(value, cell);
    plan.ratio = Math.round(ratio * 1000) / 1000;
    plan.tone = !hasVar ? 'muted' : ratio >= 0.5 ? 'ok' : ratio >= 0.2 ? 'warn' : 'bad';
    return plan;
  }

  if (kind === 'toggle') {
    plan.label = cell.label || cell.var || '';
    if (!hasVar) {
      plan.tone = 'muted';
      plan.text = '未设置';
      plan.state = 'missing';
      plan.action = { kind: 'toggle', var: cell.var };
      plan.clickable = false;
      return plan;
    }
    const on = Boolean(value);
    plan.text = on ? cell.onLabel : cell.offLabel;
    plan.state = on ? 'on' : 'off';
    plan.tone = on ? 'ok' : 'muted';
    plan.action = { kind: 'toggle', var: cell.var };
    plan.clickable = true;
    return plan;
  }

  if (kind === 'list') {
    plan.label = cell.label || '';
    plan.text = '';
    plan.items = (cell.items ?? [])
      .filter(Boolean)
      .map((item, i) => ({ key: `${cell.id}-${i}`, label: item.label || `项 ${i + 1}`, action: item.action }));
    plan.clickable = false;
    return plan;
  }

  // stat / number
  plan.label = cell.label || cell.var || '';
  plan.text = formatValue(value, cell);
  plan.sub = cell.label && cell.var && cell.label !== cell.var ? cell.var : '';

  if (!hasVar || value === null || value === undefined) plan.tone = 'muted';
  else if (typeof value === 'number') plan.tone = 'ok';
  else if (typeof value === 'boolean') plan.tone = 'ok';
  else plan.tone = 'plain';

  return plan;
}
