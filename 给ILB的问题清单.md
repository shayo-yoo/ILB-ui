# 给 ILB 的问题清单（来自 UI 扩展侧）

> **写给**：负责 ILB 开发维护的智能体（或人）
> **来自**：声明式 UI 扩展的开发者（这个扩展只经 `window.ILB.api` 使用 ILB，不 import 任何内部文件）
> **核对对象**：ILB **v0.11.1**，commit `07d4096`，接口 `API_VERSION = '1.0'`
> **运行环境**：SillyTavern 1.19.0，`D:\1\APP\SillyTavern\public\scripts\extensions\third-party\ILB`（与 `D:\文档\1\DSH\ILB\github` 的 `runtime/api.js` 哈希一致）
> **核对方式**：读 `runtime/api.js`、`core/flow.js`、`adapters/repository.js`、`runtime/pipeline.js`、`tests/api.test.mjs`；未读 `core/evaluate.js` 全文
> **范围**：只列**会挡住 UI 扩展**或**会误导 UI 扩展开发者**的问题，不是对 ILB 的全面评审
> **原则**：不动内部架构，只动接口层与文档；所有建议都向后兼容（1.0 → 1.1）

---

## 0. 一页结论

| 编号 | 一句话 | 严重度 | 类型 |
|---|---|---|---|
| ILB-UI-01 | `ok:false` 把「找不到逻辑 / 逻辑主动不通过 / 流程出错」混成一种，界面无法区分“正常拦下”和“坏了” | **高** | 接口语义 |
| ILB-UI-02 | 同一楼层的重复 `call` 随机结果完全相同（种子固定），按钮连点两次得到同一张卡 | **高** | 接口语义 |
| ILB-UI-03 | `call` 只按逻辑名查找，跨书同名时静默取第一个，界面无法精确指定 | **高** | 接口能力 |
| ILB-UI-04 | `call` 传进去的 `text/messages/userInput` 全是空，带文本条件的逻辑从界面调用必然失败 | **高** | 接口语义 |
| ILB-UI-05 | 参数名拼错、多余参数被静默忽略，界面传错参数毫无提示 | 中 | 接口语义 |
| ILB-UI-06 | `snapshot()` 不含逻辑的参数表，界面无法渲染“带参数的按钮” | 中 | 接口能力 |
| ILB-UI-07 | `set` 接受 `NaN`/`Infinity`，落盘后变成 `null` | 低 | 接口缺陷 |
| ILB-UI-08 | `subscribe(非函数)` 抛 `TypeError`，与“失败不抛异常”的契约相反 | 低 | 接口缺陷 |
| ILB-UI-09 | 交接文档说 `call` 参数“按顺序绑定”，代码是按**参数名**绑定 —— 照文档写必然全绑不上 | **高** | 文档错误 |
| ILB-UI-10 | `area` 从 0 数还是从 1 数，两份文档互相矛盾 | 中 | 文档冲突 |
| ILB-UI-11 | 动作是三种还是四种（`add` 在接口里不存在），两份文档互相矛盾 | 中 | 文档冲突 |
| ILB-UI-12 | 方案草稿说“subscribe 去抖 100ms”，实现没有去抖；事件名也和实现不一致 | 中 | 文档错误 |
| ILB-UI-13 | 接口文档没写 `args` 的形状，也没写 `set` 会把 `"5"` 变成数字 `5` | 中 | 文档缺失 |
| ILB-UI-14 | 接口文档没写“UI 调用是无上下文调用”（见 04） | 中 | 文档缺失 |

**为什么这些值得改**：UI 是“点一下按钮”的界面。用户对三件事极度敏感——点了没反应、点了报错、点两次结果一样。接口层任何“静默”或“混在一起”，到了界面上都会变成“这个扩展坏了”，而 UI 侧无法自己修。

---

## 1. 接口语义问题（需要动代码）

### ILB-UI-01 · `ok:false` 混淆了三种完全不同的情况

**证据**

- `runtime/api.js:121-169`：`call` 的返回是 `ok: result.passed !== false`。
- `core/flow.js:467`：`const passed = result?.status !== 'fail';`
- `core/flow.js:530`：走到「不通过」节点 → `status:'fail'`
- `core/flow.js:636`：条件不成立且没写“不成立时做什么” → `status:'fail'`
- `core/flow.js:438/452/458`：跳转超限、跳转目标不存在 → 也是 `status:'fail'`

**三种情况现在都是 `{ok:false, reason}`**

1. 找不到逻辑、名字为空 → 调用错误；
2. 逻辑主动「不通过」（次数不够、药水为 0）→ **这是正常的业务结果**；
3. 流程写错、跳转目标被删、嵌套太深 → 真错误。

**复现**

```js
// 一条带「不通过」节点的逻辑：剩余次数为 0 时拦下
ILB.api.set('抽卡次数', 0);
ILB.api.call('抽卡');
// → { ok:false, reason:'走到「不通过」节点', ... }
```

**影响**：界面只能把 `ok:false` 画成红字“失败”。玩家点了“喝药水”而药水为 0，界面会显示一条错误——看起来像 bug。UI 侧目前只能靠 `reason` 的中文文本猜，这是不可接受的耦合。

**建议（1.1，加字段不破坏旧调用）**

```js
return {
  ok,          // 保持不变，兼容现有调用
  ran: true,   // 流程确实执行了
  passed,      // 流程的门过没过（对应 evaluateFlow 的 passed）
  outcome: 'ok' | 'blocked' | 'error',  // 三态，UI 直接照这个画
  reason, writes, extra, steps,
};
```

`outcome` 的判定：找不到逻辑/参数越界 → `error`；`status:'fail'` 且原因是「不通过」或条件不成立 → `blocked`；其余 → `ok`。

**代价**：`evaluateFlow` 需要把“主动不通过”和“真错误”分开标记（比如返回 `status:'blocked'`），改动集中在 `core/flow.js` 几处 `return {status:'fail'}`。不做这一步，UI 永远只能猜。

---

### ILB-UI-02 · 同一楼层重复 `call`，随机结果完全相同

**证据**

- `runtime/api.js:143`：`const seed = \`api:${chatId()}:${tick()}:${found.id}\`;`
- `core/flow.js:552`：`const unit = seededUnit(\`${ctx.seed ?? ''}:${node.id}\`);`
- `core/ids.js:6`：注释写得很清楚——“同一 seed 两次调用结果完全一致（ILB-4.8.2）”，这是**有意设计**。

**复现**

```js
// 一条只含 random 节点、不消耗变量的逻辑（例如「掷骰」）
const a = ILB.api.call('掷骰');
const b = ILB.api.call('掷骰');   // 同一楼层
// a.writes['骰子'] === b.writes['骰子']
```

注意边界：如果逻辑自己消耗了一个计数器（`抽卡次数 -1`），第二次调用看到的变量已变，结果会不同——所以这个问题在“消耗型抽卡”上不明显，但在“掷骰/暴击/掉落”这类**不改变输入的随机**上 100% 复现。

**影响**：界面上“再抽一次”按钮在同一楼层等于没按；更糟的是第二次结果会覆盖第一次，玩家看起来像“抽卡坏了”。

**建议**：给 `call` 加可选的第三参数 `opts`：

```js
api.call(name, args, { nonce: 'ui:1700000000:7' });  // seed 追加 nonce
```

- 不传 `nonce` → 行为**完全不变**（保住“同层重放一致”的承诺，给重放/测试用）；
- 传了 → `seed` 变成 `api:chatId:tick:logicId:nonce`，UI 每次点击生成新的 nonce。

**为什么不让 UI 侧自己修**：种子在 `api.call` 内部拼死，UI 拿不到，也没有别的口子。

---

### ILB-UI-03 · 跨书同名逻辑，`call` 静默取第一个

**证据**：`runtime/api.js:125-132`

```js
for (const book of booksOf()) {
  if (book.enabled === false) continue;
  const hit = (Array.isArray(book.logic) ? book.logic : []).find((l) => l.enabled !== false && l.name === target);
  if (hit) { found = hit; break; }
}
```

**影响**：界面上给用户一个“调哪个逻辑”的下拉，选项里会显示“书 / 逻辑”（因为 `snapshot().books[].logics[]` 有 `id`、`name`）。用户选的是 B 书的「抽卡」，执行的是 A 书的「抽卡」——顺序取决于 `repository.listBooks()`，用户无法感知。这是很难排查的一类 bug。

**建议（二选一，都向后兼容）**

1. `api.call` 的 `name` 允许传逻辑 **id**（`'B1::L::1'`，`snapshot` 里已经有了）：传 id 时精确命中，不再按名字扫；
2. 或新增 `api.callById(id, args, opts)`，`call` 保持原样。

推荐 1（少一个方法），并在找不到时报 `没有 id 为「…」的已启用逻辑`。

---

### ILB-UI-04 · UI 调用的逻辑看不到聊天上下文

**证据**：`runtime/api.js:144-153`

```js
evaluateFlow(found.flow, {
  text: '',
  messages: [],
  userInput: '',
  messageCount: tick(),
  ...
});
```

**影响**：任何依赖 `text` / `messages` / `userInput` 的条件（关键词、正则、`消息数`）从界面调用时**必然不成立**，然后落进 ILB-UI-01 的 `ok:false`。用户看到的是一句“条件不成立”，而真实原因是“UI 没把聊天内容传进去”。

例如一条“只有玩家最近说过‘休息’才回血”的逻辑，从按钮点永远不生效。

**建议**

1. 加可选 `opts.text` / `opts.messages`，传了就替代默认空串；
2. 或默认就用 `getContext()` 里的最后一条用户消息与最近 N 条（这会改变现有行为，需谨慎，建议配合 1.1 说明）；
3. 至少**在文档里写明**：`api.call` 目前是“无上下文调用”，带文本条件的逻辑不要指望从 UI 触发。

UI 侧会怎么做：如果有了 `opts.text`，UI 会在点击时把当前输入框或最后一条消息传进去，这比 ILB 自己猜更可控。

---

### ILB-UI-05 · 参数名拼错被静默忽略

**证据**：`runtime/api.js:137-141`

```js
params.forEach((param, index) => {
  const value = args && Object.prototype.hasOwnProperty.call(args, param) ? args[param] : undefined;
  if (value !== undefined) bound[param] = coerceValue(value);
});
```

- `args` 里**多余的键**被忽略，不报错；
- `params` 里**缺失的键**不报错，流程里拿到 `undefined`；
- 参数名拼错 = 静默失效。

**影响**：UI 的声明里写 `"args": {"次数": 1}`，逻辑参数其实叫 `抽卡次数`，点击后毫无反应，也没有任何提示。UI 侧只能靠“参数表”（见 ILB-UI-06）来校验，但接口目前不给参数表。

**建议**：返回里加 `unusedArgs: ['次数']`、`missingParams: ['抽卡次数']`；或给 `opts.strict = true` 时直接 `{ok:false, outcome:'error', reason:'参数「次数」不属于这条逻辑'}`。

---

### ILB-UI-06 · `snapshot()` 不含逻辑参数表

**证据**：`runtime/api.js:85-90`，`logics[]` 只有 `id / name / enabled / exposed`。

**影响**：UI 想做一个“通用按钮”：用户选一条逻辑，界面按参数表自动生成输入框（例如 `次数`、`目标`）。没有 `params` 就只能做“无参按钮”，或者让用户手写参数名——手写就撞上 ILB-UI-05。

**建议**：`logics[].params = ['次数', '目标']`（只要名字，不要类型）。加字段，向后兼容。

---

### ILB-UI-07 · `set` 接受 `NaN` / `Infinity`

**证据**

- `runtime/api.js:20-23`：`asScalar` 只判断 `typeof`，`NaN` 是 `number`，直接通过；
- `runtime/api.js:101`：`coerceValue(NaN)` 返回 `NaN`；
- 落盘走 `JSON.stringify`，`NaN` 会变成 `null`。

**复现**

```js
ILB.api.set('金币', NaN);   // → { ok:true, name:'金币', value:NaN }
// 刷新页面后：金币 === null
```

**影响**：界面上的数字输入框清空时很容易产生 `NaN`/空串，用户会看到“金币变成了空白”，而且刷新后还是坏的。

**建议**：`asScalar` 里对 `number` 加 `Number.isFinite` 判断，不合法返回 `{ok:false, reason:'数字不合法'}`。

---

### ILB-UI-08 · `subscribe` 对非函数抛异常

**证据**：`runtime/api.js:172`：`if (typeof fn !== 'function') throw new TypeError(...)`；同文件注释（第 8-10 行）写着“任何失败都返回 `{ok:false}`，不把异常抛进调用方”。

**影响**：很小，但和契约相反；UI 侧初始化时传错参数会直接打断整个面板。

**建议**：`console.warn` + 返回一个空的退订函数；或在 `docs/UI扩展接口.md` 里明确写“`subscribe` 是唯一会抛异常的方法”。

---

## 2. 文档与代码不一致（改文档即可）

### ILB-UI-09 · `call` 的参数是**按名字**，不是按顺序（最危险的一条）

- 文档：`docs/交接-UI扩展.md` 第 74 行——“`args` 按该逻辑的 `call.params` **顺序**绑定”。
- 代码：`runtime/api.js:139`——`Object.prototype.hasOwnProperty.call(args, param) ? args[param] : undefined`，**按参数名**取。

**后果**：照文档写的 `"args": [1]` 一个都绑不上（数组没有 `"次数"` 这个键），而且因为 ILB-UI-05，会**静默失败**。UI 扩展的第一版很容易整夜卡在这里。

**建议**：文档改成 `args` 是对象，键是 `call.params` 里的参数名，例如 `{"次数": 1}`；顺便写清多余/缺失参数的处理。

### ILB-UI-10 · `area` 从 0 数还是从 1 数

- `docs/交接-UI扩展.md` 第 168 行：「`area: [列, 行, 跨列, 跨行]`，从 0 开始」
- `docs/下一阶段-UI扩展方案.md` 第 76 行：「`area: [col, row, colSpan, rowSpan]`（从 1 数）」

两份都给 UI 开发者看，必须统一。建议统一为**从 0 开始**（和 CSS Grid 的 `grid-column-start` 一致，实现时不用到处 `-1`），并在示例里写 `[0, 0, 2, 1]`。

### ILB-UI-11 · 动作三种还是四种；`add` 在接口里不存在

- `docs/交接-UI扩展.md` 第 169 行：「`action.kind` 先只支持三种：`set`、`call`、`open`」
- `docs/下一阶段-UI扩展方案.md` 第 86-89 行：四种，多一个 `{ "type": "add", "name": "金币", "by": -1 }`

`add` 在 `runtime/api.js` 里没有对应方法，只能在 UI 里“读 snapshot → 算 → set”。这本身可行（因为 API 是同步的，中间不会插入别的写），但必须在文档里写清楚是谁实现的，否则两边都以为对方做了。

**建议**：文档明确“`add` 由 UI 侧读改写实现，不是 ILB 接口”，或者干脆在 1.1 里加 `api.add(name, by)`（原子加减，省掉 UI 重复实现 `coerceValue` 的规则）。

### ILB-UI-12 · “subscribe 去抖 100ms”与事件名都与实现不符

- `docs/下一阶段-UI扩展方案.md` 第 47 行：`subscribe(fn) { /* 返回取消函数 */ }`，注释写“去抖 100ms，一次事件合并”。
- 实现：`runtime/api.js:171-175` 同步逐个回调，无去抖。
- 同文件第 54 行说四个时机：`chat_changed`、`vars_changed`、`turn_end`、`tick`；实现里实际是 `set` / `remove` / `call` / `run` / `chat_changed`（`runtime/api.js:102/158`，`index.js:239/270`）。

**影响**：UI 开发者会以为有去抖而少写节流，结果一次 `call` 触发两层重画；也会去监听不存在的事件名。

**建议**：文档按实现写，并把 reason 的枚举固定下来（这就是契约）：

| reason | 何时 |
|---|---|
| `set` / `remove` | 通过接口写变量 |
| `call` | 通过接口跑逻辑 |
| `run` | 一轮判定跑完（`index.js:239`） |
| `chat_changed` | 切聊天（`index.js:270`） |

### ILB-UI-13 · 接口文档没写 `args` 的形状与 `set` 的强制转换

- `docs/UI扩展接口.md` 第 31 行只有 `call(name, args)`，没有参数形状（见 ILB-UI-09）。
- 同一份文档没写：`set('金币', '5')` 会把字符串 `"5"` 转成数字 `5`（`core/vars.js` 的 `coerceValue`），也没写 `"true"` 会变布尔。UI 必须用返回值显示，否则界面上“5”和 `5` 的差异会造成“输入什么就被改了什么”的错觉。

### ILB-UI-14 · 接口文档没写“UI 调用是无上下文调用”

`docs/UI扩展接口.md` 第 71 行只说“跑完把 `writes` 落盘”，没提 `text/messages` 为空。建议在 §3 边界里加一句，并链接到 ILB-UI-04。

### 顺带 · 控件类型叫法不统一

`docs/交接-UI扩展.md` 用 `stat` / `text` / `button`，`docs/下一阶段-UI扩展方案.md` 用 `bar` / `number` / `list` / `toggle`。两份都是“UI 扩展自有格式”，但既然由 ILB 仓库托管，建议一起统一，免得下一个接手的智能体再猜一遍。

---

## 3. 建议补的能力（1.1，可选，向后兼容）

1. **`api.caps`**：`['snapshot','set','remove','call','subscribe','nonce','outcome']`。UI 可以据此降级，而不是靠 `version` 猜。方案草稿 §3 本来就写了 `caps`，实现里没有。
2. **`call` 的 `opts.nonce`**（见 ILB-UI-02）。
3. **`call` 返回写后变量**：`vars: {...}`。UI 现在每次收到 `call` 事件都要再 `snapshot()` 一次；返回里带上能省一半调用。注意别直接给内部对象，拷贝。
4. **事件里带变化**：`emit('set', { name, value })` 已经有了，很好；如果能加 `changes: { key: { from, to } }`，UI 的 diff 会更省事（非必须）。
5. **入口协调（可选，但会撞车）**：ILB 的悬浮球 `.ilb-fab` 默认就在**右下角**——`ui/layout.js` 里 `FAB_SIZE=52`、`FAB_MARGIN=12`、`FAB_BOTTOM_OFFSET=96`，即 `x ≈ viewport.width-70`、`y ≈ viewport.height-148`；可拖动，位置存进 `uiState.fab`；`z-index:3900`，而 ILB 自己的浮窗是 `4500`。UI 扩展的抽屉贴右侧，不避让就会压在一起。UI 侧的处理：抽屉内容底部留 ≥ 96px 空白，或把入口放左下角；如果 ILB 以后想把第三方入口收进自己的球里，请给一个注册方法（例如 `api.ui.addEntry({label, onClick})`）；否则两边各放各的角标即可，不必为此改代码。

---

## 4. 我核对过、确认没问题、请不要改的

这些是我一度怀疑、验证后确认正确的，写出来是为了避免“过度修改”：

| 项 | 结论 |
|---|---|
| `snapshot().vars` 是不是活引用 | 不是。`adapters/repository.js:161-169` 用 `safeClone` 返回副本，UI 改它不会污染存档。**保持**。 |
| `set` 之后下一轮提示词会不会看到 | 会。`runtime/pipeline.js:151` 每次生成时现读 `repository.getVars(chatId)`，没有按 tick 缓存。**保持**。 |
| `call` 是同步的 | 对 UI 反而好：点击处理里可以立刻拿到结果、不会出现“异步回来时聊天已切换”。**保持同步，不要改成 Promise**。 |
| 变量只有标量 | 可以接受；UI 侧用“逗号分隔字符串 + 列表控件”或干脆先不做列表。**不要为此加数组类型**。 |
| 没有表达式语言 | 正确。UI 侧的“条件显示”会做成固定几种比较（=、≠、>、<、有、空），不是表达式求值。**保持 D-0006 红线**。 |
| `call` 不参与注入预算 | 合理。UI 只改变量，叙事由下一轮判定自然带出。**保持边界**。 |
| `set/remove/call` 的 `{ok:false, reason}` 风格 | 除了 ILB-UI-01 的三态问题，这个风格本身很好，`reason` 可以直接显示给用户。**保持**。 |

---

## 5. 建议补的测试（可直接抄进 `tests/api.test.mjs`）

1. **门没过**：一条含「不通过」节点的逻辑，`call` 后断言 `ok === false` **且** `outcome === 'blocked'`（或 `ran === true && passed === false`），`reason` 非空。
2. **nonce**：同一 `tick` 下 `call(name, {}, {nonce:'a'})` 与 `{nonce:'b'}` 的 `writes` 不同；不传 nonce 时两次相同（锁住现有语义，防止以后误改）。
3. **按 id 调用**：两本书各有一条同名逻辑，`call('B2::L::1')` 必须命中 B2 而不是 B1。
4. **上下文**：一条要求 `text` 含关键词的逻辑，`call(name, {}, {text:'抽卡'})` 通过，不传 `text` 时不通过。
5. **参数**：`call(name, {错名: 1})` 返回非空 `unusedArgs`；`call(name, {})` 返回 `missingParams`。
6. **坏数字**：`set('金币', NaN)` 与 `set('金币', Infinity)` 都返回 `{ok:false}`。
7. **订阅**：`subscribe('x')` 不抛异常（或明确断言 `TypeError` 并同步写进接口文档）。
8. **快照**：`snapshot().books[0].logics[0].params` 是数组。

现有 `tests/api.test.mjs:17` 已经用 `random` 节点构造了「掷骰」，第 78 行也 `call('掷骰')` 了——补第 2 条测试的成本很低。

---

## 6. 验收清单（改完后我会照这个验）

- [ ] `docs/交接-UI扩展.md:74` 改成“按参数名绑定”，并给出对象示例；
- [ ] 两份文档的 `area` 起点、动作种类、控件类型名一致；
- [ ] 接口文档补：`args` 形状、`set` 的强制转换、`subscribe` 的异常、`call` 无上下文；
- [ ] `call` 返回能区分 `ok / blocked / error`；
- [ ] 同一楼层连点两次带 nonce 的 `call`，结果不同；
- [ ] 跨书同名逻辑可以精确调用；
- [ ] `snapshot` 里有 `params`；
- [ ] `set(NaN)` 被拒；
- [ ] `API_VERSION` 仍是 `1.0` 或升到 `1.1`（**不要**升 2.0，这些都是加字段/加可选参数）；
- [ ] `CHANGELOG.md` 顶部一条，`docs/决策记录.md` 新增 `D-xxxx` 说明“为什么区分 blocked 与 error”“为什么 nonce 可选”。

---

## 7. 一句话总结

ILB 的接口方向是对的（四个入口、只写变量、失败给人话），**不需要重构**。
真正挡路的只有三件：**`ok:false` 说不清是哪种失败**、**重复调用拿到同一个随机数**、**调用时看不到聊天内容**；其余都是文档没跟上代码。
这三件修好，UI 扩展才能把“点了没反应”变成“点了知道为什么”。
