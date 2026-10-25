# 声明式 UI（dsh-ui）

SillyTavern 扩展：把聊天变量渲染成一张**可看、可点**的网格界面，点击只会改变量，不懂代码也能用表单搭出来。

它本身几乎不执行逻辑——只负责"显示"和"把点击翻译成 set / add / call"，真正的规则交给 [ILB](https://github.com/shayo-yoo/ILB)（Immersive Logic Board）的逻辑或下一轮 AI。

- 依赖：ILB **0.12.0+**，`window.ILB.api` 接口 **v1.1**
- 形态：右下角 ▦ 浮窗 + 右侧抽屉；窄屏自适应
- 存储：`localStorage`（全局 / 角色卡两种作用域），不写 `extension_settings`，不改 prompt

## 安装

把整个目录放进 SillyTavern 的第三方扩展目录：

```
SillyTavern/public/scripts/extensions/third-party/dsh-ui
```

然后刷新页面（脚本是 ES module，改过代码要 **Ctrl+Shift+R**）。右下角出现 ▦ 即加载成功。

## 三分钟上手

1. 先让变量存在。在聊天里发一条让 ILB 写入变量的消息，或在 ILB 面板里手动设：
   `金币=10`、`生命=100`、`心情=平静`。
2. 点 ▦ → 「载入示例布局」→ 预览里出现示例面板（金币/生命/心情 + 喝药水）。
3. 点 ▦ → 「编辑」：默认就是表单。改标题、点「＋控件」、选类型、填变量与动作，点「应用」看效果。
4. 满意后「保存（全局）」或「保存（角色卡）」。刷新页面仍然在。
5. 「导出」得到一份 JSON，发给别人；对方「导入」→ 校验 → 进入预览 → 自己保存。

## 声明格式（速查）

```json
{
  "schema": "dshui/1",
  "title": "示例面板",
  "grid": { "cols": 6, "rows": 4, "gap": 8, "padding": 12, "minCellWidth": 44, "minCellHeight": 28 },
  "pages": [
    {
      "id": "main",
      "title": "主界面",
      "cells": [
        { "id": "hp", "kind": "stat", "label": "生命", "var": "生命", "area": [0, 0, 3, 1] },
        { "id": "drink", "kind": "button", "label": "喝药水", "area": [3, 0, 3, 1],
          "when": { "var": "生命", "op": "<", "value": 100 },
          "onClick": [
            { "kind": "add", "var": "生命", "by": 20 },
            { "kind": "set", "var": "心情", "value": "恢复" }
          ] }
      ]
    },
    { "id": "bag", "title": "背包", "cells": [
      { "id": "back", "kind": "button", "label": "← 返回", "area": [0, 2, 6, 1],
        "onClick": { "kind": "open", "page": "main" } }
    ] }
  ]
}
```

- `area: [col, row, colSpan, rowSpan]`，**从 0 开始**；越界/重叠会校验（重叠只警告）。
- 控件：`stat` / `text` / `button` / `bar` / `number` / `toggle` / `list`。
- 动作：`set` / `add` / `call` / `open`；`call` 走 ILB 的 logic 候选，三种结果（成功/拒绝/空结果）都有回执。
- 条件显示：`when: { var, op, value }`，`op` 支持 `== != < <= > >= 含 不含 为空 非空`。
- 旧写法（`widgets` / `type` / `bind` / `action` / `items[].onClick: "step"`）继续兼容。

完整约定见 `docs/`：`P1-骨架计划.md`、`P2-完成记录.md`、`P3P4-完成记录.md`、`决策记录.md`。

## 开发

纯静态、无构建、无第三方依赖（浏览器侧）：

```
node tests/run.mjs     # 91 条断言，纯 Node + 自制 DOM 桩
```

目录：

```
index.js            入口（挂载/卸载、resize）
src/api.js          ILB api v1.1 适配层（探测、caps、call、openPanel）
src/schema.js       声明归一化（别名折叠、默认值、页面）
src/validate.js     校验（网格、动作、页面、引用）
src/plan.js         声明 + 变量 → 渲染数据（纯函数）
src/store.js        localStorage（布局库 v2、界面状态、作用域选中）
src/share.js        导出/导入
src/panel.js        抽屉、页签、表单编辑器、拖动条
style.css           全部样式，前缀 dshui-
ui/sample-layout.js 内置示例（两页）
tests/              Node 测试（dom-stub / fake-ilb）
```

`tmp/` 是本地截图与 CDP 检查脚本，不入库。

## 边界

- 不执行任意表达式/脚本；没有 `eval`、没有 `innerHTML`。
- `add` 只做 UI 侧读改写；变量不存在时拒绝，不凭空创建。
- 页面之间没有返回栈，「返回」是作者自己放的 `open` 按钮。
- 导入只进预览，需要手动保存；导出不含角色卡头像名。
- 失效角色卡名下的布局只列出、不自动删。

## 致谢

接口契约来自 ILB（Immersive Logic Board）的 `docs/UI扩展接口.md`；本扩展只消费 `window.ILB.api`，不读它的核心源码。
