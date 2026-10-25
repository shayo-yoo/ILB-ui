/**
 * 本地存储层：布局库、当前选中、界面开关。
 *
 * 不碰 ILB 的 extension_settings（ILB 不让写），用我们自己的命名空间。
 * storage 可注入，测试里用假的。
 *
 * P2：布局条目带作用域（global / character:<avatar>），选中项也按作用域分开记。
 */

export const KEYS = {
  layouts: 'dshui.layouts.v2',
  selected: 'dshui.selected.v2',
  ui: 'dshui.ui.v1',
  backup: 'dshui.backup.v1',
  legacyLayouts: 'dshui.layouts.v1',
};

export function scopeKey(layout) {
  if (!layout) return 'global';
  return layout.scope === 'character' && layout.avatar ? `char:${layout.avatar}` : 'global';
}

export function createStore(storage) {
  const s = storage ?? globalThis.localStorage;

  /** 读 JSON；坏数据不丢，备份一份，然后返回 fallback。 */
  function read(key, fallback) {
    if (!s || typeof s.getItem !== 'function') return fallback;
    let raw;
    try {
      raw = s.getItem(key);
    } catch {
      return fallback;
    }
    if (raw === null || raw === undefined || raw === '') return fallback;
    try {
      const value = JSON.parse(raw);
      return value === null || value === undefined ? fallback : value;
    } catch (err) {
      console.warn(`[dsh-ui] ${key} 不是合法 JSON，已备份并重置`, err);
      try {
        s.setItem(KEYS.backup, raw);
        s.removeItem(key);
      } catch {
        /* 存不下就算了，界面不崩 */
      }
      return fallback;
    }
  }

  function write(key, value) {
    if (!s || typeof s.setItem !== 'function') return false;
    try {
      s.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      console.warn(`[dsh-ui] 写入 ${key} 失败`, err);
      return false;
    }
  }

  /** 把 v1 的裸布局数组迁成 v2 条目。只做一次，不删旧键。 */
  function loadLibrary() {
    const list = read(KEYS.layouts, null);
    if (Array.isArray(list)) {
      return list.filter((x) => x && typeof x === 'object' && !Array.isArray(x) && x.layout);
    }
    const legacy = read(KEYS.legacyLayouts, []);
    const entries = (Array.isArray(legacy) ? legacy : [])
      .filter((x) => x && typeof x === 'object' && !Array.isArray(x))
      .map((layout) => ({
        id: typeof layout.id === 'string' && layout.id ? layout.id : `legacy-${Math.random().toString(36).slice(2, 8)}`,
        title: typeof layout.title === 'string' ? layout.title : '未命名面板',
        scope: layout.scope === 'character' ? 'character' : 'global',
        avatar: typeof layout.avatar === 'string' ? layout.avatar : '',
        updatedAt: 0,
        layout,
      }));
    if (entries.length) write(KEYS.layouts, entries);
    return entries;
  }

  function saveLibrary(list) {
    return write(KEYS.layouts, Array.isArray(list) ? list : []);
  }

  /** 新增或覆盖一条；返回条目。示例布局永远不占库里的 id。 */
  function saveLayout(layout) {
    const list = loadLibrary();
    const wantId = layout.id && layout.id !== 'sample' ? layout.id : '';
    const known = wantId && list.some((x) => x.id === wantId);
    const id = known ? wantId : wantId || `layout-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const entry = {
      id,
      title: layout.title || '未命名面板',
      scope: layout.scope === 'character' ? 'character' : 'global',
      avatar: layout.avatar || '',
      updatedAt: Date.now(),
      layout: { ...layout, id },
    };
    const i = list.findIndex((x) => x.id === id);
    if (i >= 0) list[i] = entry;
    else list.push(entry);
    saveLibrary(list);
    return entry;
  }

  function deleteLayout(id) {
    const list = loadLibrary().filter((x) => x.id !== id);
    return saveLibrary(list);
  }

  function getLayout(id) {
    return loadLibrary().find((x) => x && x.id === id) ?? null;
  }

  function loadSelectedMap() {
    const map = read(KEYS.selected, {});
    return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
  }

  function getSelectedId(key = 'global') {
    const id = loadSelectedMap()[key];
    return typeof id === 'string' && id ? id : null;
  }

  function setSelectedId(id, key = 'global') {
    const map = loadSelectedMap();
    if (!id) delete map[key];
    else map[key] = id;
    return write(KEYS.selected, map);
  }

  function loadUi() {
    const ui = read(KEYS.ui, {});
    return ui && typeof ui === 'object' && !Array.isArray(ui) ? ui : {};
  }

  function saveUi(patch) {
    if (!patch || typeof patch !== 'object') return false;
    return write(KEYS.ui, { ...loadUi(), ...patch });
  }

  return {
    read,
    write,
    loadLibrary,
    saveLibrary,
    saveLayout,
    deleteLayout,
    getLayout,
    getSelectedId,
    setSelectedId,
    loadUi,
    saveUi,
  };
}
