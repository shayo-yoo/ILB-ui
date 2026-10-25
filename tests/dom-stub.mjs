/**
 * 最小 DOM 桩：只实现 panel.js 真正用到的那点 API。
 * 够用来断言“点了之后标签变了”“按钮藏起来了”这类行为。
 */

class ClassList {
  constructor(el) {
    this.el = el;
  }
  _list() {
    return this.el.className ? this.el.className.split(/\s+/).filter(Boolean) : [];
  }
  _set(list) {
    this.el.className = list.join(' ');
  }
  add(...names) {
    const list = this._list();
    for (const n of names) if (n && !list.includes(n)) list.push(n);
    this._set(list);
  }
  remove(...names) {
    this._set(this._list().filter((x) => !names.includes(x)));
  }
  contains(name) {
    return this._list().includes(name);
  }
  toggle(name, force) {
    const has = this.contains(name);
    const want = force === undefined ? !has : Boolean(force);
    if (want && !has) this.add(name);
    if (!want && has) this.remove(name);
    return want;
  }
}

class El {
  constructor(tag) {
    this.tagName = String(tag).toLowerCase();
    this.className = '';
    this.children = [];
    this.parent = null;
    this.attrs = new Map();
    this.listeners = new Map();
    this.style = {};
    this.dataset = {};
    this.hidden = false;
    this.classList = new ClassList(this);
    this._text = '';
  }

  get firstChild() {
    return this.children.length ? this.children[0] : null;
  }

  get textContent() {
    if (this.children.length === 0) return this._text;
    return this._text + this.children.map((c) => c.textContent).join('');
  }

  set textContent(value) {
    this._text = value === null || value === undefined ? '' : String(value);
    for (const child of this.children) child.parent = null;
    this.children = [];
  }

  append(...nodes) {
    for (const node of nodes) {
      if (node === null || node === undefined) continue;
      const child = typeof node === 'string' ? new El('#text').withText(node) : node;
      child.parent = this;
      this.children.push(child);
    }
    return this;
  }

  appendChild(node) {
    return this.append(node);
  }

  removeChild(node) {
    const i = this.children.indexOf(node);
    if (i >= 0) {
      this.children.splice(i, 1);
      node.parent = null;
    }
    return node;
  }

  remove() {
    if (this.parent) this.parent.removeChild(this);
  }

  setAttribute(name, value) {
    this.attrs.set(String(name), String(value));
  }

  getAttribute(name) {
    return this.attrs.has(name) ? this.attrs.get(name) : null;
  }

  hasAttribute(name) {
    return this.attrs.has(name);
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }

  removeEventListener(type, fn) {
    const list = this.listeners.get(type);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  withText(text) {
    this._text = text;
    return this;
  }

  /** 触发一次点击（测试用）。 */
  click() {
    const list = this.listeners.get('click') ?? [];
    const event = { type: 'click', target: this, currentTarget: this, preventDefault() {}, stopPropagation() {} };
    for (const fn of list) fn(event);
    return this;
  }
}

export function createDocument() {
  const doc = {
    body: new El('body'),
    createElement: (tag) => new El(tag),
    createTextNode: (text) => new El('#text').withText(String(text)),
  };
  return doc;
}

export function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(String(key), String(value));
    },
    removeItem(key) {
      map.delete(String(key));
    },
  };
}

export function walk(root, visit) {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    visit(node);
    for (const child of node.children) stack.push(child);
  }
}

export function findAll(root, predicate) {
  const out = [];
  walk(root, (node) => {
    if (node !== root && predicate(node)) out.push(node);
  });
  return out;
}

export function findByClass(root, cls) {
  return findAll(root, (node) => node.classList.contains(cls))[0] ?? null;
}

export function findAllByClass(root, cls) {
  return findAll(root, (node) => node.classList.contains(cls));
}

export function findButtonByText(root, text) {
  return findAll(root, (node) => node.tagName === 'button' && node.textContent.includes(text))[0] ?? null;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
