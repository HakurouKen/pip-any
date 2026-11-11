import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import fsp from 'node:fs/promises';
import path from 'node:path';

const html = await fsp.readFile(path.resolve('public/popup.html'), 'utf8');

describe('工具栏 popup 入口', () => {
  const query = vi.fn(async () => [{ id: 42, url: 'https://example.com/' }]);
  const executeScript = vi.fn(async () => [{ result: false }]);

  function button(): HTMLButtonElement {
    const element = document.querySelector<HTMLButtonElement>('#toggle-selection');
    if (!element) throw new Error('缺少 popup 操作按钮。');
    return element;
  }

  beforeEach(() => {
    vi.resetModules();
    document.documentElement.innerHTML = html;
    query.mockReset().mockResolvedValue([{ id: 42, url: 'https://example.com/' }]);
    executeScript.mockReset().mockResolvedValue([{ result: false }]);
    vi.stubGlobal('chrome', { tabs: { query }, scripting: { executeScript } });
    vi.spyOn(window, 'close').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('工具栏默认入口指向含操作按钮与外部脚本的 popup', async () => {
    const manifest: unknown = JSON.parse(
      await fsp.readFile(path.resolve('public/manifest.json'), 'utf8'),
    );
    expect(manifest).toMatchObject({ action: { default_popup: 'popup.html' } });
    expect(document.querySelector('script')?.getAttribute('src')).toBe('popup.js');
    expect(document.querySelector('link[rel="stylesheet"]')?.getAttribute('href')).toBe(
      'popup.css',
    );
    expect(document.querySelector('style')).toBeNull();
    expect(await fsp.readFile(path.resolve('public/popup.css'), 'utf8')).toContain(
      '--primary: #2563eb',
    );
    expect(button()).not.toBeNull();
    expect(document.querySelector('h1')?.textContent).toBe('Pip Any');
    expect(document.querySelector('.heading span')?.textContent).toBe('将任意页面元素转为画中画');
    expect(document.querySelector('.instructions')).toBeNull();
    expect(document.querySelector('#status')?.getAttribute('aria-live')).toBe('polite');
  });

  it('打开面板只读取状态，点击后才注入选择脚本并关闭面板', async () => {
    await import('./popup');
    await vi.waitFor(() => expect(button().disabled).toBe(false));
    expect(button().textContent).toBe('选择内容');
    expect(document.querySelector('#status')?.textContent).toBe('');
    expect(executeScript).toHaveBeenCalledExactlyOnceWith({
      target: { tabId: 42 },
      world: 'ISOLATED',
      func: expect.any(Function),
    });
    expect(window.close).not.toHaveBeenCalled();
    button().click();
    await vi.waitFor(() => expect(window.close).toHaveBeenCalledOnce());
    expect(executeScript).toHaveBeenLastCalledWith({
      target: { tabId: 42 },
      world: 'ISOLATED',
      files: ['content.js'],
    });
  });

  it('页面已在选择时展示取消入口', async () => {
    executeScript.mockResolvedValue([{ result: true }]);
    await import('./popup');
    await vi.waitFor(() => expect(button().textContent).toBe('取消选择'));
    expect(document.querySelector('#status')?.textContent).toBe(
      '正在选择，可在页面调整范围或取消。',
    );
    button().click();
    await vi.waitFor(() => expect(window.close).toHaveBeenCalledOnce());
    expect(executeScript).toHaveBeenLastCalledWith({
      target: { tabId: 42 },
      world: 'ISOLATED',
      files: ['content.js'],
    });
  });

  it('浏览器内部页面显示原因，不注入脚本', async () => {
    query.mockResolvedValue([{ id: 42, url: 'chrome://extensions/' }]);
    await import('./popup');
    await vi.waitFor(() => expect(button().textContent).toBe('当前页面不支持'));
    expect(button().disabled).toBe(true);
    expect(document.querySelector('#status')?.textContent).toContain('HTTPS');
    expect(executeScript).not.toHaveBeenCalled();
  });

  it('HTTPS 受限页注入被拒绝时显示错误', async () => {
    executeScript.mockRejectedValue(new Error('Cannot access this page'));
    await import('./popup');
    await vi.waitFor(() => expect(button().textContent).toBe('当前页面无法访问'));
    expect(button().disabled).toBe(true);
    expect(document.querySelector('#status')?.textContent).toContain('禁止插件访问');
    expect(window.close).not.toHaveBeenCalled();
  });

  it('操作注入失败时保留面板并允许重试', async () => {
    await import('./popup');
    await vi.waitFor(() => expect(button().disabled).toBe(false));
    executeScript.mockRejectedValueOnce(new Error('Page changed'));
    button().click();
    await vi.waitFor(() => expect(button().disabled).toBe(false));
    expect(document.querySelector('#status')?.textContent).toContain('无法操作此页面');
    expect(window.close).not.toHaveBeenCalled();
    button().click();
    await vi.waitFor(() => expect(window.close).toHaveBeenCalledOnce());
  });

  it('没有活动标签页时保持禁用并说明原因', async () => {
    query.mockResolvedValue([]);
    await import('./popup');
    await vi.waitFor(() => expect(button().textContent).toBe('当前页面不支持'));
    expect(button().disabled).toBe(true);
    expect(executeScript).not.toHaveBeenCalled();
  });
});
