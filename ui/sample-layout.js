/**
 * 内置示例布局。只在“布局库里什么都没有”时用于预览，不落盘。
 * 数据格式与用户手写的完全一致，顺便当活文档：七个控件各出现一次，还演示多页面。
 *
 * 需要先点变量板里的“写入示例变量”写入 金币 / 生命 / 心情 / 灯。
 * “抽卡”按钮要求 ILB 里有一条叫「抽卡」的已启用逻辑；没有就只是报错，不会崩。
 */
export default {
  schema: 'dshui/1',
  id: 'sample',
  title: '示例面板',
  grid: { cols: 6, rows: 4, gap: 8, padding: 10 },
  pages: [
    {
      id: 'main',
      title: '主界面',
      cells: [
        {
          id: 'gold',
          kind: 'stat',
          label: '金币',
          var: '金币',
          suffix: ' G',
          area: [0, 0, 1, 1],
          onClick: { kind: 'add', var: '金币', by: 1 },
        },
        {
          id: 'hp',
          kind: 'bar',
          label: '生命',
          var: '生命',
          max: 10,
          area: [1, 0, 2, 1],
        },
        {
          id: 'mood',
          kind: 'stat',
          label: '心情',
          var: '心情',
          area: [3, 0, 2, 1],
        },
        {
          id: 'lamp',
          kind: 'toggle',
          label: '灯',
          var: '灯',
          onLabel: '开',
          offLabel: '关',
          area: [5, 0, 1, 1],
        },
        {
          id: 'hint',
          kind: 'text',
          text: '点金币 +1；点灯切换开关；点“背包”切页；列表项和按钮共用同一套动作。',
          area: [0, 1, 6, 1],
        },
        {
          id: 'quick',
          kind: 'list',
          label: '快捷动作',
          area: [0, 2, 3, 2],
          items: [
            { label: '金币 +1', action: { kind: 'add', var: '金币', by: 1 } },
            { label: '生命 -1', action: { kind: 'add', var: '生命', by: -1 } },
            { label: '金币清零', action: { kind: 'set', var: '金币', value: 0 } },
            { label: '心情 → 平静', action: { kind: 'set', var: '心情', value: '平静' } },
          ],
        },
        {
          id: 'to-bag',
          kind: 'button',
          label: '背包 →',
          area: [3, 2, 3, 1],
          onClick: { kind: 'open', page: 'bag' },
        },
        {
          id: 'roll',
          kind: 'button',
          label: '抽卡（调「抽卡」逻辑）',
          area: [3, 3, 3, 1],
          onClick: { kind: 'call', logic: '抽卡', args: {} },
        },
      ],
    },
    {
      id: 'bag',
      title: '背包',
      cells: [
        {
          id: 'bag-tip',
          kind: 'text',
          text: '这是一页独立的网格：页面可以有自己的 cols/rows，不给就继承顶层。',
          area: [0, 0, 4, 1],
        },
        {
          id: 'bag-list',
          kind: 'list',
          label: '物品',
          area: [0, 1, 4, 2],
          items: [
            { label: '铜钥匙 ×1', action: { kind: 'set', var: '物品', value: '铜钥匙' } },
            { label: '药水 ×2' },
          ],
        },
        {
          id: 'back',
          kind: 'button',
          label: '← 返回主界面',
          area: [0, 3, 4, 1],
          onClick: { kind: 'open', page: 'main' },
        },
      ],
    },
  ],
};
