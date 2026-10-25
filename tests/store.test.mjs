import assert from 'node:assert/strict';
import { createStore, KEYS, scopeKey } from '../src/store.js';
import { memoryStorage } from './dom-stub.mjs';

let n = 0;
function check(name, fn) {
  fn();
  n += 1;
  console.log(`  ok ${name}`);
}

console.log('store.test');

check('布局库：存进去再读出来', () => {
  const s = memoryStorage();
  const store = createStore(s);
  assert.deepEqual(store.loadLibrary(), []);
  store.saveLibrary([
    { id: 'a', title: 'A', layout: { title: 'A' } },
    { id: 'b', title: 'B', layout: { title: 'B' } },
  ]);
  assert.deepEqual(store.loadLibrary().map((x) => x.id), ['a', 'b']);
});

check('布局库：过滤掉数组、null 和没有 layout 的条目', () => {
  const s = memoryStorage();
  const store = createStore(s);
  s.setItem(KEYS.layouts, JSON.stringify([null, [1, 2], { id: 'old' }, { id: 'ok', layout: {} }]));
  assert.deepEqual(store.loadLibrary().map((x) => x.id), ['ok']);
});

check('坏 JSON：不崩，备份原串并清空', () => {
  const s = memoryStorage();
  const store = createStore(s);
  s.setItem(KEYS.layouts, '{坏的');
  assert.deepEqual(store.loadLibrary(), []);
  assert.equal(s.getItem(KEYS.backup), '{坏的');
  assert.equal(s.getItem(KEYS.layouts), null);
});

check('选中项：空串等于清空，按作用域分开记', () => {
  const s = memoryStorage();
  const store = createStore(s);
  store.setSelectedId('a');
  assert.equal(store.getSelectedId(), 'a');
  store.setSelectedId('c', 'char:Alice.png');
  assert.equal(store.getSelectedId('char:Alice.png'), 'c');
  assert.equal(store.getSelectedId('global'), 'a');
  store.setSelectedId('');
  assert.equal(store.getSelectedId(), null);
  assert.equal(store.getSelectedId('char:Alice.png'), 'c');
});

check('UI 状态：patch 合并而不是覆盖', () => {
  const s = memoryStorage();
  const store = createStore(s);
  store.saveUi({ open: true });
  store.saveUi({ scroll: 12 });
  assert.deepEqual(store.loadUi(), { open: true, scroll: 12 });
});

check('saveLayout：新布局生成 id，示例 id 不占用库里 id', () => {
  const s = memoryStorage();
  const store = createStore(s);
  const first = store.saveLayout({ title: 'A', scope: 'global', layout: { title: 'A' } });
  assert.ok(first.id);
  assert.notEqual(first.id, 'sample');

  const again = store.saveLayout({ title: 'A2', id: first.id });
  assert.equal(again.id, first.id);
  assert.equal(store.loadLibrary().length, 1);

  const fromSample = store.saveLayout({ title: '改过的示例', id: 'sample' });
  assert.notEqual(fromSample.id, 'sample');
  assert.equal(store.loadLibrary().length, 2);
});

check('saveLayout：角色卡作用域带 avatar', () => {
  const s = memoryStorage();
  const store = createStore(s);
  const entry = store.saveLayout({ title: 'C', scope: 'character', avatar: 'Alice.png' });
  assert.equal(entry.scope, 'character');
  assert.equal(entry.avatar, 'Alice.png');
});

check('deleteLayout：删掉后不再返回', () => {
  const s = memoryStorage();
  const store = createStore(s);
  const entry = store.saveLayout({ title: 'A' });
  assert.equal(store.getLayout(entry.id).title, 'A');
  store.deleteLayout(entry.id);
  assert.equal(store.getLayout(entry.id), null);
  assert.equal(store.loadLibrary().length, 0);
});

check('v1 旧库：一次迁成 v2 条目', () => {
  const s = memoryStorage();
  s.setItem(KEYS.legacyLayouts, JSON.stringify([{ title: '旧布局', cells: [] }]));
  const store = createStore(s);
  const list = store.loadLibrary();
  assert.equal(list.length, 1);
  assert.equal(list[0].title, '旧布局');
  assert.equal(list[0].scope, 'global');
  assert.ok(Array.isArray(JSON.parse(s.getItem(KEYS.layouts))));
});

check('scopeKey：全局与角色卡', () => {
  assert.equal(scopeKey(null), 'global');
  assert.equal(scopeKey({ scope: 'global' }), 'global');
  assert.equal(scopeKey({ scope: 'character', avatar: 'A.png' }), 'char:A.png');
  assert.equal(scopeKey({ scope: 'character' }), 'global');
});

check('storage 完全不可用时也不抛', () => {
  const store = createStore({
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
    removeItem() {},
  });
  assert.deepEqual(store.loadLibrary(), []);
  assert.equal(store.saveLibrary([]), false);
  assert.deepEqual(store.loadUi(), {});
  assert.equal(store.saveUi({ open: true }), false);
});

console.log(`store.test: ${n} passed`);
