/**
 * 唯一接触 window.ILB 的地方。
 *
 * 契约来源：ILB `docs/UI扩展接口.md`（接口 v1.1 / ILB 0.12.0）
 *   api.version / api.caps / api.snapshot() / api.set / api.remove / api.call / api.subscribe
 *   api.ui.openPanel(tab)（v1.1 起）/ document 事件 'ilb:ready'、'ilb:change'
 *
 * 本文件不 import ILB 的任何内部文件（ILB 的规则，也是我们的规则）。
 */

/** 我们按哪个接口版本写。低于它进入 legacy（1.0）态：能显示，但少几样能力。 */
export const REQUIRED_VERSION = '1.1';

/** 1.0 也能用，只是没有 outcome/caps/byId/nonce。 */
export const LEGACY_VERSION = '1.0';

/** ILB 实际会发的 reason（见 runtime/api.js emit 调用）。 */
export const KNOWN_EVENTS = ['set', 'remove', 'call', 'run', 'chat_changed', 'manual'];

/** 拿到 api 或 null。ILB 未启用、未加载、旧版本没有 api 时都是 null。 */
function getApi() {
  const ilb = globalThis.ILB;
  const api = ilb && ilb.api;
  if (!api || typeof api.snapshot !== 'function') return null;
  return api;
}

/** 版本号比较只认 x.y；比较不了就返回 false。 */
function atLeast(version, want) {
  const parse = (v) => String(v ?? '').split('.').map((x) => Number(x));
  const [a1, a2] = parse(version);
  const [b1, b2] = parse(want);
  if (!Number.isFinite(a1) || !Number.isFinite(b1)) return false;
  return a1 > b1 || (a1 === b1 && (a2 || 0) >= (b2 || 0));
}

export function capsOf(api = getApi()) {
  const caps = api && Array.isArray(api.caps) ? api.caps : [];
  return caps.map(String);
}

export function hasCap(name, api = getApi()) {
  return capsOf(api).includes(name);
}

/**
 * 三态探针。
 * @returns {{ state:'ok'|'legacy'|'missing', version?:string, caps:string[], reason:string }}
 */
export function probe() {
  const api = getApi();
  if (!api) {
    return { state: 'missing', caps: [], reason: 'ILB 未加载（需要 v0.11.0 以上）' };
  }
  const version = String(api.version ?? '?');
  const caps = capsOf(api);

  if (atLeast(version, REQUIRED_VERSION) || caps.includes('outcome')) {
    return { state: 'ok', version, caps, reason: `接口 v${version}` };
  }
  if (atLeast(version, LEGACY_VERSION)) {
    return {
      state: 'legacy',
      version,
      caps,
      reason: `接口 v${version}（旧版）：没有 outcome/caps，结果一律按成功/失败两态显示`,
    };
  }
  return { state: 'legacy', version, caps, reason: `接口 v${version} 太旧，只保留读变量与 set` };
}

/** 读一次快照；失败返回 null（不抛）。 */
export function readSnapshot() {
  const api = getApi();
  if (!api) return null;
  try {
    const snap = api.snapshot();
    return snap && typeof snap === 'object' ? snap : null;
  } catch (err) {
    console.warn('[dsh-ui] snapshot 失败', err);
    return null;
  }
}

/** 统一取变量表。 */
export function varsOf(snapshot) {
  const vars = snapshot && snapshot.vars;
  return vars && typeof vars === 'object' ? vars : {};
}

/** 统计用：书数、启用逻辑数（v1.1 字段是 logics[]，v1.0 也输出 logics）。 */
export function countsOf(snapshot) {
  const books = Array.isArray(snapshot?.books) ? snapshot.books : [];
  let logics = 0;
  for (const book of books) {
    const list = Array.isArray(book?.logics) ? book.logics : Array.isArray(book?.logic) ? book.logic : [];
    for (const l of list) {
      if (l && l.enabled !== false) logics += 1;
    }
  }
  return { books: books.length, logics };
}

/**
 * 写一个变量。返回 ILB 原样的 {ok, name, value, previous, coerced} 或 {ok:false, outcome, reason}。
 */
export function setVar(name, value) {
  const api = getApi();
  if (!api) return { ok: false, outcome: 'error', reason: 'ILB 未加载' };
  if (typeof name !== 'string' || !name) return { ok: false, outcome: 'error', reason: '变量名为空' };
  try {
    const res = api.set(name, value);
    return res && typeof res === 'object' ? res : { ok: false, outcome: 'error', reason: '接口无返回' };
  } catch (err) {
    console.warn('[dsh-ui] set 抛异常', err);
    return { ok: false, outcome: 'error', reason: String(err?.message ?? err) };
  }
}

/**
 * 调一条逻辑。
 * @param {string} name 逻辑名或 id
 * @param {object} [args] 键是参数名
 * @param {{nonce?:string, text?:string, strict?:boolean}} [opts]
 */
export function callLogic(name, args, opts) {
  const api = getApi();
  if (!api) return { ok: false, outcome: 'error', reason: 'ILB 未加载' };
  if (typeof name !== 'string' || !name) return { ok: false, outcome: 'error', reason: '逻辑名为空' };
  try {
    const res =
      opts && typeof opts === 'object' ? api.call(name, args ?? {}, opts) : api.call(name, args ?? {});
    return res && typeof res === 'object'
      ? res
      : { ok: false, outcome: 'error', reason: '接口无返回' };
  } catch (err) {
    console.warn('[dsh-ui] call 抛异常', err);
    return { ok: false, outcome: 'error', reason: String(err?.message ?? err) };
  }
}

/**
 * 结果的语气：ok / blocked（业务拒绝，黄） / error（真错，红）。
 * 旧版没有 outcome：只能二分。
 */
export function outcomeOf(res) {
  if (!res || typeof res !== 'object') return 'error';
  if (res.outcome === 'ok' || res.outcome === 'blocked' || res.outcome === 'error') return res.outcome;
  return res.ok ? 'ok' : 'error';
}

/** 同名逻辑的候选列表（v1.1 才有）。 */
export function candidatesOf(res) {
  return Array.isArray(res?.candidates) ? res.candidates : [];
}

/** 打开 ILB 自带面板（v1.1）。失败返回 false，不抛。 */
export function openIlbPanel(tab) {
  const api = getApi();
  const ui = api && api.ui;
  if (!ui || typeof ui.openPanel !== 'function') return false;
  try {
    ui.openPanel(tab || undefined);
    return true;
  } catch (err) {
    console.warn('[dsh-ui] ui.openPanel 失败', err);
    return false;
  }
}

/**
 * 订阅 ILB 的变量变化。
 * 返回退订函数；ILB 不在或订阅抛错时返回空函数（界面永远不因订阅失败而崩）。
 */
export function subscribe(fn) {
  const api = getApi();
  if (!api || typeof api.subscribe !== 'function') return () => {};
  try {
    const off = api.subscribe(fn);
    return typeof off === 'function' ? off : () => {};
  } catch (err) {
    console.warn('[dsh-ui] subscribe 失败', err);
    return () => {};
  }
}

/**
 * UI 侧的原子加减（ILB 没有 add 接口，只能读改写）。
 * 因为 api 是同步的，读和写之间不会插入别的调用，安全。
 */
export function addVar(name, by) {
  const step = Number(by);
  if (!Number.isFinite(step)) return { ok: false, outcome: 'error', reason: `步长不合法：${by}` };
  const snap = readSnapshot();
  const vars = varsOf(snap);
  if (!Object.prototype.hasOwnProperty.call(vars, name)) {
    return { ok: false, outcome: 'error', reason: `变量「${name}」不存在` };
  }
  const current = vars[name];
  const base = Number(current);
  if (!Number.isFinite(base)) {
    return { ok: false, outcome: 'error', reason: `变量「${name}」不是数字（当前：${String(current)}）` };
  }
  return setVar(name, base + step);
}

/** 开关：读当前值 → 取反 → 写回。变量不存在时拒绝（不凭空造变量）。 */
export function toggleVar(name) {
  const snap = readSnapshot();
  const vars = varsOf(snap);
  if (!Object.prototype.hasOwnProperty.call(vars, name)) {
    return { ok: false, outcome: 'error', reason: `变量「${name}」不存在` };
  }
  return setVar(name, !vars[name]);
}

/**
 * 等 ILB 就绪：先探针，再听 'ilb:ready'，最后轮询兜底。
 * @returns {() => void} 取消
 */
export function waitForApi(onReady, { interval = 500, timeout = 15000 } = {}) {
  const started = Date.now();
  let timer = null;
  let done = false;
  const doc = globalThis.document;

  const finish = (state) => {
    if (done) return;
    done = true;
    if (timer !== null) clearTimeout(timer);
    doc?.removeEventListener?.('ilb:ready', onReadyEvent);
    onReady(state);
  };

  const onReadyEvent = () => {
    const state = probe();
    if (state.state !== 'missing') finish(state);
  };

  doc?.addEventListener?.('ilb:ready', onReadyEvent);

  const tick = () => {
    if (done) return;
    const state = probe();
    if (state.state !== 'missing') {
      finish(state);
      return;
    }
    if (Date.now() - started >= timeout) {
      finish(state);
      return;
    }
    timer = setTimeout(tick, interval);
  };

  tick();
  return () => {
    done = true;
    if (timer !== null) clearTimeout(timer);
    doc?.removeEventListener?.('ilb:ready', onReadyEvent);
  };
}
