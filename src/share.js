/**
 * 分享：布局 ↔ 可下载的 JSON 文件。
 *
 * 导出格式（稳定契约）：
 *   { "kind": "dshui-ui", "format": 1, "exportedAt": "...", "layout": { schema, title, grid, pages } }
 * 也接受直接把 layout 对象丢进来（导入时两种都认）。
 *
 * id / scope / avatar 不进导出文件：id 由导入方的布局库重新分配，
 * 作用域在“保存”时由用户选（全局 / 当前角色卡）。
 */

import { normalizeLayout, SCHEMA_ID, MAX_PAGES } from './schema.js';
import { formatIssues, validateLayout } from './validate.js';

export const SHARE_KIND = 'dshui-ui';
export const SHARE_FORMAT = 1;

export function exportLayout(layout) {
  const l = normalizeLayout(layout);
  return {
    kind: SHARE_KIND,
    format: SHARE_FORMAT,
    exportedAt: new Date().toISOString(),
    layout: {
      schema: SCHEMA_ID,
      title: l.title,
      grid: l.grid,
      pages: l.pages.slice(0, MAX_PAGES).map((page) => ({
        id: page.id,
        title: page.title,
        grid: page.grid,
        cells: page.cells,
      })),
    },
  };
}

export function exportText(layout, pretty = true) {
  return JSON.stringify(exportLayout(layout), null, pretty ? 2 : 0);
}

/** 下载文件名：只用安全字符，避免 Windows/macOS 上奇怪的字符。 */
export function fileNameFor(layout, stamp = new Date()) {
  const title = String(layout?.title || '布局').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40) || '布局';
  const y = stamp.getFullYear();
  const m = String(stamp.getMonth() + 1).padStart(2, '0');
  const d = String(stamp.getDate()).padStart(2, '0');
  return `dshui-${title}-${y}${m}${d}.json`;
}

/**
 * @returns {{ ok: boolean, layout?: object, errors: Array, warnings: Array, message: string }}
 */
export function importText(text) {
  let parsed;
  try {
    parsed = JSON.parse(String(text ?? ''));
  } catch (err) {
    return { ok: false, errors: [{ path: '(JSON)', message: `JSON 解析失败：${err.message}` }], warnings: [], message: '这个文件不是合法 JSON' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, errors: [{ path: '(根)', message: '文件内容必须是一个对象' }], warnings: [], message: '文件内容必须是一个对象' };
  }

  if (parsed.kind !== undefined && parsed.kind !== SHARE_KIND) {
    return {
      ok: false,
      errors: [{ path: 'kind', message: `这不是 ILBUI 的布局文件（kind=${JSON.stringify(parsed.kind)}）` }],
      warnings: [],
      message: '文件类型不对',
    };
  }
  if (parsed.format !== undefined && parsed.format > SHARE_FORMAT) {
    return {
      ok: false,
      errors: [{ path: 'format', message: `文件格式 ${parsed.format} 比本扩展新（支持到 ${SHARE_FORMAT}）` }],
      warnings: [],
      message: '文件版本太新',
    };
  }

  const raw = parsed.layout && typeof parsed.layout === 'object' ? parsed.layout : parsed;
  if (Array.isArray(raw.pages) && raw.pages.length > MAX_PAGES) {
    return {
      ok: false,
      errors: [{ path: 'pages', message: `页面太多（${raw.pages.length} 页），上限 ${MAX_PAGES} 页` }],
      warnings: [],
      message: '页面太多',
    };
  }

  const result = validateLayout(raw, {});
  if (!result.ok) {
    return { ok: false, errors: result.errors, warnings: result.warnings, message: `校验没过：\n${formatIssues(result.errors)}` };
  }

  // 导入的布局 id 清空，交给存储层分配；作用域也重置为全局（保存时再选）
  const layout = { ...result.layout, id: '', scope: 'global', avatar: '' };
  return { ok: true, layout, errors: [], warnings: result.warnings, message: '可以导入' };
}
