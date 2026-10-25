/**
 * 假的 ILB：行为按 runtime/api.js v1.1 的契约写，不依赖 SillyTavern。
 * 只实现 UI 扩展用到的入口（含 caps / outcome / ui.openPanel）。
 */

export const CAPS_11 = [
  'snapshot',
  'set',
  'remove',
  'call',
  'subscribe',
  'outcome',
  'byId',
  'nonce',
  'context',
  'strict',
  'vars',
  'caps',
];

export function makeFakeIlb(options = {}) {
  const vars = { ...(options.vars ?? {}) };
  const listeners = new Set();
  const state = { calls: [], sets: [], panels: [] };
  const version = options.version ?? '1.1';

  function emit(reason, extra = {}) {
    for (const fn of [...listeners]) fn({ reason, ...extra });
  }

  const api = {
    version,
    caps: options.caps ?? (version === '1.0' ? [] : [...CAPS_11]),

    snapshot() {
      return {
        version,
        caps: [...api.caps],
        chatId: 'fake-chat',
        tick: state.sets.length,
        vars: { ...vars },
        books:
          options.books ??
          [
            {
              id: 'B1',
              name: '书一',
              enabled: true,
              entries: 2,
              logics: [
                { id: 'B1::L::1', name: '抽卡', enabled: true, exposed: false, params: [] },
                { id: 'B1::L::2', name: '已关闭', enabled: false, exposed: false, params: [] },
              ],
            },
          ],
      };
    },

    set(name, value) {
      const previous = Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : null;
      let stored = value;
      if (typeof value === 'string') {
        if (value === 'true') stored = true;
        else if (value === 'false') stored = false;
        else if (value.trim() !== '' && Number.isFinite(Number(value))) stored = Number(value);
      }
      if (typeof value === 'number' && !Number.isFinite(value)) {
        return { ok: false, outcome: 'error', reason: '数字不合法（不能是 NaN / Infinity）' };
      }
      vars[name] = stored;
      state.sets.push([name, stored]);
      emit('set', { name, value: stored });
      return { ok: true, name, value: stored, previous, coerced: stored !== value };
    },

    remove(name) {
      delete vars[name];
      emit('remove', { name });
      return { ok: true, name };
    },

    call(name, args = {}, opts = {}) {
      state.calls.push([name, args, opts]);
      if (name === '抽卡' || name === 'B1::L::1') {
        vars['结果'] = 'SSR';
        emit('call', { name, ok: true });
        return {
          ok: true,
          outcome: 'ok',
          ran: true,
          passed: true,
          reason: '',
          writes: { 结果: 'SSR' },
          extra: { 卡: 'SSR' },
          steps: [],
          vars: { ...vars },
          unusedArgs: [],
          missingParams: [],
        };
      }
      if (name === '同名') {
        return {
          ok: false,
          outcome: 'error',
          ran: false,
          passed: false,
          reason: '有 2 条同名逻辑，请改传 id',
          candidates: [
            { id: 'B1::L::9', name: '同名', book: '书一' },
            { id: 'B2::L::9', name: '同名', book: '书二' },
          ],
        };
      }
      if (name === '次数不够') {
        return { ok: false, outcome: 'blocked', ran: true, passed: false, reason: '次数不够' };
      }
      return { ok: false, outcome: 'error', ran: false, passed: false, reason: '没有对应的逻辑' };
    },

    subscribe(fn) {
      if (typeof fn !== 'function') {
        console.warn('[ILB] subscribe 需要一个函数');
        return () => {};
      }
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    ui: {
      openPanel(tab) {
        state.panels.push(tab);
      },
      close() {},
    },
  };

  return { api, vars, state, listeners, emit };
}
