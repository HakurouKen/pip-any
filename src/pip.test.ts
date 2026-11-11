import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPipSession, getPipSize } from './pip';

function getElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Fixture 缺少元素：${id}`);
  return element;
}

function createWindow(): Window {
  const pip = window.open('about:blank', '_blank');
  if (!pip) throw new Error('无法创建测试窗口。');
  vi.spyOn(pip, 'close').mockImplementation(() => {
    pip.dispatchEvent(new Event('pagehide'));
    Object.defineProperty(pip, 'closed', { value: true, configurable: true });
  });
  return pip;
}

describe('浮窗会话', () => {
  let session: ReturnType<typeof createPipSession>;
  let pip: Window;
  const notify = vi.fn();
  const requestWindow = vi.fn<() => Promise<Window>>();

  beforeEach(() => {
    document.body.innerHTML =
      '<main id="parent"><button id="one" style="color: red">原按钮</button><div id="two">另一个目标</div><p id="tail">结尾</p></main>';
    document.head.replaceChildren();
    notify.mockReset();
    pip = createWindow();
    requestWindow.mockReset().mockResolvedValue(pip);
    vi.stubGlobal('documentPictureInPicture', { requestWindow });
    session = createPipSession(window, notify);
  });

  afterEach(() => {
    session.dispose();
    vi.unstubAllGlobals();
  });

  it('移动原节点、保留直接绑定的事件，关闭时恢复位置与原样式', async () => {
    const target = getElement('one');
    const handler = vi.fn();
    target.addEventListener('click', handler);
    const original = getElement('parent').innerHTML;
    await session.open(target);
    expect(requestWindow).toHaveBeenCalledOnce();
    expect(pip.document.getElementById('one')).toBe(target);
    expect(document.querySelector('[data-pip-any-placeholder]')).not.toBeNull();
    target.click();
    expect(handler).toHaveBeenCalledOnce();
    pip.close();
    expect(getElement('parent').innerHTML).toBe(original);
    expect(target.style.color).toBe('red');
  });

  it('复用窗口替换元素，先还原旧目标，最后恢复新目标', async () => {
    const one = getElement('one');
    const two = getElement('two');
    const parent = getElement('parent');
    const original = parent.innerHTML;
    await session.open(one);
    await session.open(two);
    expect(requestWindow).toHaveBeenCalledOnce();
    expect(one.parentNode).toBe(parent);
    expect(pip.document.getElementById('two')).toBe(two);
    expect(document.querySelectorAll('[data-pip-any-placeholder]')).toHaveLength(1);
    pip.close();
    expect(parent.innerHTML).toBe(original);
    expect(two.hasAttribute('style')).toBe(false);
  });

  it('目标在浮窗中自适应宽度和内容高度，关闭后恢复原有尺寸约束', async () => {
    const target = getElement('two');
    target.style.cssText =
      'width: 1400px; height: 900px; min-width: 1200px; min-height: 800px; display: inline-block; padding: 24px; border: 2px solid red';
    const original = target.getAttribute('style');
    await session.open(target);
    expect(target.style.width).toBe('100%');
    expect(target.style.height).toBe('auto');
    expect(Number.parseFloat(target.style.minWidth)).toBe(0);
    expect(Number.parseFloat(target.style.minHeight)).toBe(0);
    expect(target.style.display).toBe('block');
    expect(target.style.boxSizing).toBe('border-box');
    expect(target.style.padding).toBe('24px');
    const root = pip.getComputedStyle(pip.document.documentElement);
    const body = pip.getComputedStyle(pip.document.body);
    expect(root.overflow).toBe('hidden');
    expect(body.overflow).toBe('auto');
    expect(body.width).toBe('100%');
    expect(body.height).toBe('100%');
    expect(Number.parseFloat(body.padding)).toBe(0);
    expect(Number.parseFloat(body.margin)).toBe(0);
    pip.close();
    expect(target.getAttribute('style')).toBe(original);
  });

  it('非法新目标不影响当前浮窗', async () => {
    const target = getElement('one');
    await session.open(target);
    await expect(session.open(document.body)).rejects.toThrow('具体区域');
    expect(pip.document.getElementById('one')).toBe(target);
    expect(pip.closed).toBe(false);
  });

  it('拒绝 iframe 及其父区域，原节点保持在页面中', async () => {
    const parent = getElement('two');
    const iframe = document.createElement('iframe');
    parent.append(iframe);
    const original = document.body.innerHTML;
    await expect(session.open(iframe)).rejects.toThrow('不支持 iframe');
    await expect(session.open(parent)).rejects.toThrow('不支持 iframe');
    expect(requestWindow).not.toHaveBeenCalled();
    expect(document.body.innerHTML).toBe(original);
  });

  it('尝试替换为含 iframe 区域时保留已有浮窗内容', async () => {
    const one = getElement('one');
    const parent = getElement('two');
    parent.append(document.createElement('iframe'));
    await session.open(one);
    await expect(session.open(parent)).rejects.toThrow('不支持 iframe');
    expect(pip.document.getElementById('one')).toBe(one);
    expect(pip.closed).toBe(false);
    expect(requestWindow).toHaveBeenCalledOnce();
  });

  it('窗口请求被拒绝时，页面没有占位或样式变更', async () => {
    const original = document.body.innerHTML;
    requestWindow.mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    await expect(session.open(getElement('one'))).rejects.toThrow('denied');
    expect(document.body.innerHTML).toBe(original);
  });

  it('原容器被删除时恢复到页面底部并告知用户', async () => {
    const target = getElement('one');
    await session.open(target);
    getElement('parent').remove();
    pip.close();
    expect(target.parentNode).toBe(document.body);
    expect(notify).toHaveBeenCalledWith('原容器已被页面移除，元素已放回页面底部。');
  });

  it('占位被移除但原容器仍在时，按原相邻节点还原', async () => {
    const target = getElement('one');
    await session.open(target);
    document.querySelector('[data-pip-any-placeholder]')?.remove();
    pip.close();
    expect(target.nextElementSibling?.id).toBe('two');
    expect(notify).not.toHaveBeenCalled();
  });

  it('等待窗口时取消，不搬移元素并关闭新窗口', async () => {
    let resolveWindow: ((value: Window) => void) | undefined;
    requestWindow.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveWindow = resolve;
        }),
    );
    const target = getElement('one');
    const cancel = new AbortController();
    const opening = session.open(target, cancel.signal);
    cancel.abort();
    resolveWindow?.(pip);
    await expect(opening).rejects.toThrow('已取消选择');
    expect(target.parentElement?.id).toBe('parent');
    expect(pip.close).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-pip-any-placeholder]')).toBeNull();
  });

  it('等待窗口时目标被删除，不向浮窗插入失效元素', async () => {
    let resolveWindow: ((value: Window) => void) | undefined;
    requestWindow.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveWindow = resolve;
        }),
    );
    const target = getElement('one');
    const opening = session.open(target);
    target.remove();
    resolveWindow?.(pip);
    await expect(opening).rejects.toThrow('已被页面移除');
    expect(pip.close).toHaveBeenCalledOnce();
    expect(target.isConnected).toBe(false);
  });

  it('等待窗口时区域新增 iframe，不再按普通元素搬移', async () => {
    let grant: ((value: Window) => void) | undefined;
    requestWindow.mockImplementation(
      () =>
        new Promise((resolve) => {
          grant = resolve;
        }),
    );
    const target = getElement('two');
    const opening = session.open(target);
    const frame = document.createElement('iframe');
    target.append(frame);
    grant?.(pip);
    await expect(opening).rejects.toThrow('选区新增了 iframe');
    expect(frame.ownerDocument).toBe(document);
    expect(target.parentElement?.id).toBe('parent');
    expect(document.querySelector('[data-pip-any-placeholder]')).toBeNull();
    expect(pip.close).toHaveBeenCalledOnce();
  });

  it('复制内联样式，并保留外链样式表和资源基准 URL', async () => {
    const style = document.createElement('style');
    style.textContent = '#one { background: teal; }';
    document.head.append(style);
    await session.open(getElement('one'));
    expect(pip.document.head.querySelector('style')?.textContent).toContain('background: teal');
    expect(pip.document.head.querySelector('base')?.href).toBe(document.baseURI);
  });

  it('清理会话恢复节点并关闭窗口', async () => {
    const target = getElement('one');
    await session.open(target);
    session.dispose();
    expect(target.parentElement?.id).toBe('parent');
    expect(pip.close).toHaveBeenCalledOnce();
    await expect(session.open(target)).rejects.toThrow('页面已离开');
  });

  it('SVG 根元素可搬移，并在关闭后恢复', async () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    getElement('parent').append(svg);
    await session.open(svg);
    expect(pip.document.body.firstElementChild).toBe(svg);
    pip.close();
    expect(svg.parentElement?.id).toBe('parent');
    expect(svg.getAttribute('viewBox')).toBe('0 0 100 100');
  });

  it('没有画中画 API 时给出可恢复的中文错误', async () => {
    vi.stubGlobal('documentPictureInPicture', undefined);
    const original = document.body.innerHTML;
    await expect(session.open(getElement('one'))).rejects.toThrow('不支持画中画');
    expect(document.body.innerHTML).toBe(original);
  });

  it('大元素的初始尺寸受可用屏幕限制', () => {
    const size = getPipSize({ width: 5000, height: 3000 }, window.screen);
    expect(size.width).toBeLessThanOrEqual((window.screen.availWidth || 1280) - 80);
    expect(size.height).toBeLessThanOrEqual((window.screen.availHeight || 800) - 100);
    expect(size.width).toBeGreaterThan(0);
  });
});
