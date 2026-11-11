import { createSelector } from './selector';

declare global {
  interface Window {
    /** 隔离世界内的页面级单例，重复注入只切换选择状态。 */
    __pipAnyController?: ReturnType<typeof createSelector>;
  }
}

if (!window.__pipAnyController) {
  window.__pipAnyController = createSelector(window);
  // BFCache 恢复后下次点击会创建全新控制器。
  window.addEventListener(
    'pagehide',
    () => {
      delete window.__pipAnyController;
    },
    { once: true },
  );
}
window.__pipAnyController.toggle();
