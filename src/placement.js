/**
 * 侧边把手（peek handle）的排布计算。
 *
 * 把“夹在哪个高度”和“怎么避开别的浮球”从 DOM 里拆出来，方便单测；
 * 同时保证：无论展开/收起，把手都不会盖住输入栏。
 */

/** 把手尺寸：宽度、高度、收起时露出的宽度。 */
export const HANDLE = { width: 22, height: 88, peek: 12, gap: 8, edge: 8 };

/**
 * 把把手顶端夹进安全范围。
 * @param {number} y 期望的顶端（视口坐标）
 * @param {{top?: number, maxTop?: number, height?: number}} opts
 */
export function clampHandleY(y, opts = {}) {
  const height = Number.isFinite(opts.height) ? opts.height : HANDLE.height;
  const top = Number.isFinite(opts.top) ? opts.top : HANDLE.edge;
  const maxTop = Number.isFinite(opts.maxTop) ? opts.maxTop : top;
  const lo = Math.min(top, maxTop);
  const hi = Math.max(top, maxTop);
  const n = Number(y);
  if (!Number.isFinite(n)) return lo + Math.round((hi - lo) / 2);
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

/** 从视口高度和输入栏顶边算“把手顶端最高能到哪”。 */
export function maxHandleTop({ viewportHeight, sendFormTop, height = HANDLE.height, gap = HANDLE.gap } = {}) {
  const vh = Number(viewportHeight) || 800;
  const limit = Number.isFinite(sendFormTop) && sendFormTop > height + gap ? sendFormTop : vh - 72;
  return Math.max(HANDLE.edge + height, Math.round(limit - height - gap));
}

/**
 * 避开已经占住边缘的球（比如 ILB 的）。
 * 只做一次上移/下移，不做迭代：宁可让开一点，也不跟别人的球打架。
 * @param {number} y
 * @param {{top:number,bottom:number}[]} taken
 */
export function avoidTaken(y, taken = [], { height = HANDLE.height, gap = HANDLE.gap, min = 0, max = Infinity } = {}) {
  let out = Number(y);
  if (!Number.isFinite(out)) return y;
  for (const box of taken) {
    if (!box || !Number.isFinite(box.top) || !Number.isFinite(box.bottom)) continue;
    const overlaps = out < box.bottom + gap && out + height > box.top - gap;
    if (!overlaps) continue;
    const above = box.top - gap - height;
    const below = box.bottom + gap;
    if (above >= min) out = above;
    else if (below <= max) out = below;
  }
  return out;
}

/** 展开时把手贴在面板左缘，只露 peek 宽。 */
export function handleLeft({ panelLeft, width = HANDLE.width, peek = HANDLE.peek } = {}) {
  return Math.max(0, Math.round(panelLeft - (width - peek)));
}
