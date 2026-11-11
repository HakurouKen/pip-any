import { defineConfig } from 'vitest/config';

/** 使用独立 DOM 环境验证选择及节点恢复，不访问外部网络。 */
export default defineConfig({
  test: {
    environment: 'happy-dom',
    // 外链样式仅检查资源契约，不访问网络；实际加载和视觉效果由浏览器验证。
    environmentOptions: {
      happyDOM: {
        settings: { disableCSSFileLoading: true, handleDisabledFileLoadingAsSuccess: true },
      },
    },
    include: ['src/**/*.test.ts'],
    restoreMocks: true,
  },
});
