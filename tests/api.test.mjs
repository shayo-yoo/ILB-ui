import assert from 'node:assert/strict';
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
} from '../src/api.js';
import { makeFakeIlb } from './fake-ilb.mjs';

let n = 0;
function check(name, fn) {
  fn();
  n += 1;
  console.log(`  ok ${name}`);
}

function withIlb(fn, options = {}) {
  const fake = makeFakeIlb({ vars: { 金币: 3, 生命: 10, 心情: '平静', 灯: false }, ...options });
  globalThis.ILB = { api: fake.api };
  try {
    fn(fake);
  } finally {
    delete globalThis.ILB;
  }
}

console.log('api.test');

check('探针：没有 ILB 时是 missing', () => {
  delete globalThis.ILB;
  const p = probe();
  assert.equal(p.state, 'missing');
  assert.ok(p.reason.includes('ILB'));
});

check('探针：1.1 是 ok，并带 caps', () => {
  withIlb(() => {
    const p = probe();
    assert.equal(p.state, 'ok');
    assert.equal(p.version, '1.1');
    assert.ok(p.caps.includes('outcome'));
  });
});

check('探针：1.0 是 legacy', () => {
  withIlb(() => {
    const p = probe();
    assert.equal(p.state, 'legacy');
    assert.ok(p.reason.includes('旧版'));
  }, { version: '1.0', caps: [] });
});

check('快照：拿得到变量与计数（只数启用的逻辑）', () => {
  withIlb((fake) => {
    const snap = readSnapshot();
    assert.deepEqual(varsOf(snap), fake.vars);
    assert.deepEqual(countsOf(snap), { books: 1, logics: 1 });
  });
});

check('set：原样透传结果', () => {
  withIlb((fake) => {
    const res = setVar('金币', 7);
    assert.equal(res.ok, true);
    assert.equal(res.value, 7);
    assert.equal(fake.vars['金币'], 7);
  });
});

check('set：没有 ILB 时不抛，返回 ok:false', () => {
  delete globalThis.ILB;
  const res = setVar('金币', 1);
  assert.equal(res.ok, false);
});

check('add：正常加减', () => {
  withIlb((fake) => {
    assert.equal(addVar('金币', 2).ok, true);
    assert.equal(fake.vars['金币'], 5);
    assert.equal(addVar('金币', -5).ok, true);
    assert.equal(fake.vars['金币'], 0);
  });
});

check('add：变量不存在时拒绝，不会凭空创建', () => {
  withIlb((fake) => {
    const res = addVar('不存在', 1);
    assert.equal(res.ok, false);
    assert.ok(res.reason.includes('不存在'));
    assert.equal(Object.prototype.hasOwnProperty.call(fake.vars, '不存在'), false);
  });
});

check('add：变量不是数字时拒绝', () => {
  withIlb(() => {
    const res = addVar('心情', 1);
    assert.equal(res.ok, false);
    assert.ok(res.reason.includes('不是数字'));
  });
});

check('add：步长不合法时拒绝', () => {
  withIlb(() => {
    assert.equal(addVar('金币', NaN).ok, false);
    assert.equal(addVar('金币', 'x').ok, false);
  });
});

check('toggle：读反写回，返回布尔', () => {
  withIlb((fake) => {
    assert.equal(toggleVar('灯').ok, true);
    assert.equal(fake.vars['灯'], true);
    assert.equal(toggleVar('灯').ok, true);
    assert.equal(fake.vars['灯'], false);
  });
});

check('toggle：变量不存在时拒绝', () => {
  withIlb((fake) => {
    assert.equal(toggleVar('没有').ok, false);
    assert.equal(Object.prototype.hasOwnProperty.call(fake.vars, '没有'), false);
  });
});

check('call：透传 ok / extra / outcome', () => {
  withIlb((fake) => {
    const res = callLogic('抽卡', {});
    assert.equal(res.ok, true);
    assert.equal(outcomeOf(res), 'ok');
    assert.deepEqual(res.extra, ['你抽到了 SSR']);
    assert.deepEqual(fake.state.calls[0][0], '抽卡');
  });
});

check('call：opts 原样传给 ILB（nonce）', () => {
  withIlb((fake) => {
    callLogic('抽卡', { a: 1 }, { nonce: 'n-1' });
    assert.deepEqual(fake.state.calls[0], ['抽卡', { a: 1 }, { nonce: 'n-1' }]);
  });
});

check('outcome：blocked 与 error', () => {
  assert.equal(outcomeOf({ ok: false, outcome: 'blocked' }), 'blocked');
  assert.equal(outcomeOf({ ok: false }), 'error');
  assert.equal(outcomeOf(null), 'error');
});

check('candidates：同名逻辑候选', () => {
  withIlb((fake) => {
    const res = callLogic('同名', {});
    assert.equal(res.ok, false);
    assert.equal(candidatesOf(res).length, 2);
  });
});

check('openIlbPanel：调 api.ui.openPanel', () => {
  withIlb((fake) => {
    assert.equal(openIlbPanel('logic'), true);
    assert.deepEqual(fake.state.panels, ['logic']);
  });
});

check('openIlbPanel：没有 ui 时返回 false', () => {
  globalThis.ILB = { api: { version: '1.1', snapshot: () => ({}) } };
  assert.equal(openIlbPanel('logic'), false);
  delete globalThis.ILB;
});

check('subscribe：ILB 的 subscribe 抛错时返回空函数，不炸', () => {
  globalThis.ILB = {
    api: {
      version: '1.1',
      snapshot: () => ({}),
      subscribe() {
        throw new TypeError('boom');
      },
    },
  };
  const off = subscribe(() => {});
  assert.equal(typeof off, 'function');
  off();
  delete globalThis.ILB;
});

check('subscribe：正常返回可用的退订', () => {
  withIlb((fake) => {
    let hits = 0;
    const off = subscribe(() => {
      hits += 1;
    });
    fake.emit('set', { name: '金币' });
    assert.equal(hits, 1);
    off();
    fake.emit('set', { name: '金币' });
    assert.equal(hits, 1);
  });
});

/**
 * v1.2：异步调用 + 界面指令 + extra 归一化。
 */
async function withIlbAsync(fn, options = {}) {
  const fake = makeFakeIlb({ vars: { 金币: 3, 生命: 10, 心情: '平静', 灯: false }, ...options });
  globalThis.ILB = { api: fake.api };
  try {
    await fn(fake);
  } finally {
    delete globalThis.ILB;
  }
}

await (async () => {
  await withIlbAsync((fake) => {
    assert.equal(hasCallAsync(), true, 'v1.2 要有 callAsync');
  }, { version: '1.2' });
  await withIlbAsync(() => {
    assert.equal(hasCallAsync(), false, 'v1.1 没有 callAsync');
    assert.equal(hasCap('outcome'), true, 'v1.1 有 outcome');
    assert.equal(hasCap('ui'), false, 'v1.1 没有 ui');
  });
  n += 1;
  console.log('  ok hasCallAsync / hasCap 按版本与 caps 判断');

  await withIlbAsync(async () => {
    const res = await callLogicAsync('抽卡', {});
    assert.equal(res.ok, true);
    assert.equal(res.outcome, 'ok');
    assert.equal(typeof res.durationMs, 'number');
  }, { version: '1.2' });
  await withIlbAsync(async () => {
    const res = await callLogicAsync('抽卡', {});
    assert.equal(res.ok, true, 'v1.1 要退回同步 call');
  });
  n += 1;
  console.log('  ok callLogicAsync：v1.2 走 callAsync，老版本退回同步 call');

  await withIlbAsync(async () => {
    const res = await callLogicAsync('抽卡', {}, {});
    assert.equal(res.ui.v, 1);
    assert.equal(res.ui.toast, '好了');
  }, { version: '1.2', uiFor: () => ({ toast: '好了' }) });
  await withIlbAsync(async () => {
    const res = await callLogicAsync('抽卡', {}, {});
    assert.equal(res.ui, null, '没有产出 ui 时是 null');
  }, { version: '1.2' });
  n += 1;
  console.log('  ok ui 指令：有则带 v，无则 null');

  await withIlbAsync(() => {
    assert.equal(uiCommandOf({ ui: { v: 1, toast: 'x' } }).toast, 'x');
    assert.equal(uiCommandOf({ ui: { toast: 'x' } }), null, '缺 v 不认');
    assert.equal(uiCommandOf({ ui: { v: 2 } }), null, '版本不认识就不认');
    assert.equal(uiCommandOf({ ui: null }), null);
    assert.equal(uiCommandOf({}), null);
  }, { version: '1.2' });
  await withIlbAsync(() => {
    assert.equal(uiCommandOf({ ui: { v: 1, toast: 'x' } }), null, 'v1.1 没有 ui 能力位，一律当没有');
  });
  n += 1;
  console.log('  ok uiCommandOf：只认 v=1，且必须先有 ui 能力位');

  await withIlbAsync(() => {
    assert.deepEqual(extraList(['a', 'b']), ['a', 'b']);
    assert.deepEqual(extraList('正文'), ['正文']);
    assert.deepEqual(extraList({ 卡: 'SSR' }), ['卡：SSR']);
    assert.deepEqual(extraList(null), []);
    assert.deepEqual(extraList(['', 'x']), ['x'], '空串要丢掉');
  });
  n += 1;
  console.log('  ok extraList：string[] / 字符串 / 对象 / null 都归一化成数组');
})();

console.log(`api.test: ${n} passed`);
