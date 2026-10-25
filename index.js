import { init } from './src/panel.js';

/**
 * 入口只做一件事：等 DOM 就绪后交给 panel.init()。
 * 任何初始化异常都在 panel.init() 里兜住，这里不再 try/catch，
 * 免得吞掉真正的错误信息。
 */
function start() {
  init();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
