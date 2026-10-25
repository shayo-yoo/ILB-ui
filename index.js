import { init } from './src/panel.js';

/**
 * 入口只做一件事：等 DOM 就绪后交给 panel.init()。
 * 任何初始化异常都在 panel.init() 里兜住，这里不再 try/catch，
 * 免得吞掉真正的错误信息。
 */
function start() {
  const ui = init();

  // 视口变化（手机横竖屏、窗口缩放）后把手要重新贴边；节流一下避免连续重排。
  let timer = 0;
  const reposition = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        ui.reposition?.();
      } catch {
        /* 位置算不出来不影响主流程 */
      }
    }, 120);
  };
  window.addEventListener('resize', reposition);
  window.addEventListener('orientationchange', reposition);
  // 面板/布局变化后，别处也可以主动喊一声
  window.addEventListener('dshui:reposition', () => ui.reposition?.());
  return ui;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
