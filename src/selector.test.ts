import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSelector } from './selector';

describe('元素选择交互', () => {
  let selector: ReturnType<typeof createSelector>;
  let target: HTMLElement;
  let pip: Window;
  const requestWindow = vi.fn<() => Promise<Window>>();

  function ui(): ShadowRoot {
    const root = document.querySelector('[data-pip-any-ui]')?.shadowRoot;
    if (!root) throw new Error('缺少选择 UI。');
    return root;
  }

  function move(): void {
    target.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 30, clientY: 30 }));
  }

  function lock(): void {
    target.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 30, clientY: 30 }),
    );
  }

  function slider(): HTMLInputElement {
    const input = ui().querySelector('input');
    if (!input) throw new Error('缺少选区滑块。');
    return input;
  }

  function setLevel(level: number): void {
    slider().value = String(level);
    slider().dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  }

  async function confirm(): Promise<void> {
    const button = ui().querySelector<HTMLButtonElement>('.confirm');
    if (!button) throw new Error('缺少打开浮窗按钮。');
    button.click();
    await vi.waitFor(() => expect(button.disabled).toBe(false));
  }

  async function open(): Promise<void> {
    lock();
    await confirm();
  }

  beforeEach(() => {
    document.body.innerHTML =
      '<article id="article"><section id="section"><a id="target" href="https://example.com">目标链接</a></section></article>';
    const element = document.getElementById('target');
    const popup = window.open('about:blank');
    if (!element || !popup) throw new Error('测试环境初始化失败。');
    target = element;
    pip = popup;
    requestWindow.mockReset().mockResolvedValue(pip);
    vi.stubGlobal('documentPictureInPicture', { requestWindow });
    vi.stubGlobal('isSecureContext', true);
    vi.spyOn(document, 'elementFromPoint').mockImplementation(() => target);
    selector = createSelector(window);
  });

  afterEach(() => {
    selector.dispose();
    vi.unstubAllGlobals();
  });

  it('插件点击切换选择，Esc 退出且不打开浮窗', () => {
    selector.toggle();
    expect(ui().querySelector('section')?.hidden).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(ui().querySelector('section')?.hidden).toBe(true);
    selector.toggle();
    selector.toggle();
    expect(ui().querySelector('section')?.hidden).toBe(true);
    expect(requestWindow).not.toHaveBeenCalled();
  });

  it('方向键扩大至父元素并可返回之前的子元素', () => {
    selector.toggle();
    move();
    expect(ui().querySelector('.target')?.textContent).toContain('a#target');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect(ui().querySelector('.target')?.textContent).toContain('section#section');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect(ui().querySelector('.target')?.textContent).toContain('article#article');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(ui().querySelector('.target')?.textContent).toContain('section#section');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(ui().querySelector('.target')?.textContent).toContain('a#target');
  });

  it('提示按悬停和锁定状态显示，重选恢复简短说明', () => {
    selector.toggle();
    expect(ui().querySelector('strong')?.textContent).toBe('Pip Any');
    expect(ui().querySelector('.hint')?.textContent).toBe('点击选择对应内容。');
    expect(ui().querySelector<HTMLElement>('.adjustments')?.hidden).toBe(true);
    move();
    lock();
    expect(ui().querySelector('.hint')?.textContent).toBe(
      '滑块或方向键调整：↑ / → 扩大，↓ / ← 缩小。',
    );
    expect(ui().querySelector<HTMLElement>('.adjustments')?.hidden).toBe(false);
    expect(ui().querySelector('.target')?.textContent).toContain('a#target');
    const reselect = Array.from(ui().querySelectorAll('button')).find(
      (button) => button.textContent === '重新选择',
    );
    if (!reselect) throw new Error('缺少重新选择按钮。');
    reselect.click();
    expect(ui().querySelector('.hint')?.textContent).toBe('点击选择对应内容。');
    expect(ui().querySelector<HTMLElement>('.adjustments')?.hidden).toBe(true);
  });

  it('选中链接不会触发网页点击处理器，结束后浮窗内仍可点击', async () => {
    const handler = vi.fn((event: Event) => event.preventDefault());
    target.addEventListener('click', handler);
    selector.toggle();
    move();
    await open();
    expect(handler).not.toHaveBeenCalled();
    expect(pip.document.getElementById('target')).toBe(target);
    expect(ui().querySelector('section')?.hidden).toBe(true);
    target.click();
    expect(handler).toHaveBeenCalledOnce();
  });

  it('点击打开键盘扩大后的目标范围', async () => {
    selector.toggle();
    move();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    await open();
    expect(pip.document.body.firstElementChild?.id).toBe('section');
  });

  it('取消重新选择保留原浮窗内容', async () => {
    selector.toggle();
    move();
    await open();
    selector.toggle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(pip.document.getElementById('target')).toBe(target);
    expect(requestWindow).toHaveBeenCalledOnce();
  });

  it('打开失败显示中文提示，保持选择并允许重试', async () => {
    requestWindow.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    selector.toggle();
    move();
    await open();
    expect(ui().querySelector('.status')?.textContent).toContain('再次点击“确定”重试');
    expect(ui().querySelector('section')?.hidden).toBe(false);
    await confirm();
    expect(pip.document.getElementById('target')).toBe(target);
  });

  it('选择面板的取消按钮可操作，不会作为目标', () => {
    selector.toggle();
    ui().querySelector('button')?.click();
    expect(ui().querySelector('section')?.hidden).toBe(true);
    expect(requestWindow).not.toHaveBeenCalled();
  });

  it('源页面离开时移除 UI 并恢复目标', async () => {
    selector.toggle();
    move();
    await open();
    window.dispatchEvent(new Event('pagehide'));
    expect(document.querySelector('[data-pip-any-ui]')).toBeNull();
    expect(document.getElementById('target')).toBe(target);
  });

  it('单击锁定选区后展示滑块，确认前不打开浮窗', () => {
    selector.toggle();
    move();
    expect(ui().querySelector<HTMLElement>('.adjustments')?.hidden).toBe(true);
    lock();
    expect(ui().querySelector<HTMLElement>('.adjustments')?.hidden).toBe(false);
    expect(slider().value).toBe('0');
    expect(slider().max).toBe('2');
    expect(requestWindow).not.toHaveBeenCalled();
    expect(document.getElementById('target')).toBe(target);
  });

  it('锁定后鼠标离开选区或点击其他区域，不会改变当前选区', () => {
    selector.toggle();
    move();
    lock();
    const other = document.createElement('div');
    document.body.append(other);
    vi.mocked(document.elementFromPoint).mockReturnValue(other);
    other.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    other.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(ui().querySelector('.target')?.textContent).toContain('a#target');
    expect(slider().max).toBe('2');
    expect(requestWindow).not.toHaveBeenCalled();
  });

  it('滑块左右调整祖先范围，并按最终选区打开浮窗', async () => {
    selector.toggle();
    move();
    lock();
    setLevel(2);
    expect(ui().querySelector('.target')?.textContent).toContain('article#article');
    setLevel(0);
    expect(ui().querySelector('.target')?.textContent).toContain('a#target');
    setLevel(1);
    expect(ui().querySelector('.target')?.textContent).toContain('section#section');
    expect(requestWindow).not.toHaveBeenCalled();
    await confirm();
    expect(pip.document.body.firstElementChild?.id).toBe('section');
  });

  it('上下左右方向键与滑块同步，超出范围时停在边界', () => {
    selector.toggle();
    move();
    lock();
    const press = (key: string): void => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
    };
    press('ArrowRight');
    expect(slider().value).toBe('1');
    press('ArrowUp');
    expect(slider().value).toBe('2');
    press('ArrowRight');
    expect(slider().value).toBe('2');
    press('ArrowLeft');
    expect(slider().value).toBe('1');
    press('ArrowDown');
    expect(slider().value).toBe('0');
    press('ArrowLeft');
    expect(slider().value).toBe('0');
    expect(ui().querySelector('.target')?.textContent).toContain('a#target');
  });

  it('滑块获得焦点时，方向键只调整一级并阻止原生重复处理', () => {
    selector.toggle();
    move();
    lock();
    expect(ui().activeElement).toBe(slider());
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    slider().dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(slider().value).toBe('1');
    expect(ui().querySelector('.target')?.textContent).toContain('section#section');
  });

  it('重新选择回到悬停模式，并为新目标重新计算滑块范围', () => {
    selector.toggle();
    move();
    lock();
    setLevel(2);
    const reselect = [...ui().querySelectorAll('button')].find(
      (button) => button.textContent === '重新选择',
    );
    reselect?.click();
    expect(ui().querySelector<HTMLElement>('.adjustments')?.hidden).toBe(true);
    expect(ui().querySelector('.target')?.textContent).toBe('尚未选择区域');
    const other = document.createElement('div');
    other.id = 'other';
    document.body.append(other);
    vi.mocked(document.elementFromPoint).mockReturnValue(other);
    other.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    other.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(ui().querySelector('.target')?.textContent).toContain('div#other');
    expect(slider().value).toBe('0');
    expect(slider().max).toBe('0');
    expect(slider().disabled).toBe(true);
    expect(ui().querySelector<HTMLButtonElement>('.confirm')?.disabled).toBe(false);
  });

  it('锁定选区后按 Esc 取消，不打开或搬移目标', () => {
    selector.toggle();
    move();
    lock();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(ui().querySelector<HTMLElement>('.adjustments')?.hidden).toBe(true);
    expect(ui().querySelector('section')?.hidden).toBe(true);
    expect(document.getElementById('target')).toBe(target);
    expect(requestWindow).not.toHaveBeenCalled();
    selector.toggle();
    expect(ui().querySelector<HTMLElement>('.adjustments')?.hidden).toBe(true);
  });

  it('选区的子元素被页面删除后，不通过滑块选择失效节点', () => {
    selector.toggle();
    move();
    lock();
    setLevel(1);
    target.remove();
    setLevel(0);
    expect(ui().querySelector<HTMLElement>('.adjustments')?.hidden).toBe(true);
    expect(ui().querySelector('.status')?.textContent).toContain('重新选择');
    expect(requestWindow).not.toHaveBeenCalled();
  });

  describe('iframe 禁选反馈', () => {
    let iframe: HTMLIFrameElement;

    beforeEach(() => {
      iframe = document.createElement('iframe');
      iframe.id = 'embedded';
      document.getElementById('section')?.append(iframe);
    });

    it('悬停 iframe 显示禁选样式、原因及禁止光标', () => {
      target = iframe;
      selector.toggle();
      move();
      expect(ui().querySelector('.outline')?.classList.contains('blocked')).toBe(true);
      expect(ui().querySelector<HTMLElement>('.picker')?.style.cursor).toBe('not-allowed');
      expect(ui().querySelector('.target')?.textContent).toContain('不可选');
      expect(ui().querySelector<HTMLElement>('.restriction')?.hidden).toBe(false);
      expect(ui().querySelector('.restriction')?.textContent).toContain('不支持 iframe');
    });

    it('透明选择层拦住 iframe 点击，且不锁定选区或打开浮窗', () => {
      target = iframe;
      const handler = vi.fn();
      iframe.addEventListener('click', handler);
      selector.toggle();
      const picker = ui().querySelector('.picker');
      if (!picker) throw new Error('缺少选择层。');
      picker.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          composed: true,
          clientX: 30,
          clientY: 30,
        }),
      );
      picker.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          composed: true,
          cancelable: true,
          clientX: 30,
          clientY: 30,
        }),
      );
      expect(ui().querySelector('.target')?.textContent).toContain('iframe#embedded');
      expect(ui().querySelector<HTMLElement>('.adjustments')?.hidden).toBe(true);
      expect(ui().querySelector<HTMLButtonElement>('.confirm')?.disabled).toBe(true);
      expect(handler).not.toHaveBeenCalled();
      expect(requestWindow).not.toHaveBeenCalled();
    });

    it('点击含 iframe 的外层区域也不能锁定', () => {
      const parent = document.getElementById('section');
      if (!parent) throw new Error('缺少父区域。');
      target = parent;
      selector.toggle();
      move();
      lock();
      expect(ui().querySelector<HTMLElement>('.adjustments')?.hidden).toBe(true);
      expect(ui().querySelector('.outline')?.classList.contains('blocked')).toBe(true);
      expect(requestWindow).not.toHaveBeenCalled();
    });

    it('方向键扩大到含 iframe 区域时禁用，缩小后可打开普通元素', async () => {
      selector.toggle();
      move();
      lock();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
      expect(ui().querySelector('.target')?.textContent).toContain('section#section');
      expect(ui().querySelector<HTMLButtonElement>('.confirm')?.disabled).toBe(true);
      expect(ui().querySelector('.outline')?.classList.contains('blocked')).toBe(true);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      expect(ui().querySelector<HTMLButtonElement>('.confirm')?.disabled).toBe(false);
      expect(ui().querySelector('.outline')?.classList.contains('blocked')).toBe(false);
      expect(ui().querySelector<HTMLElement>('.restriction')?.hidden).toBe(true);
      await confirm();
      expect(pip.document.getElementById('target')).toBe(target);
    });

    it('滑块进入禁选父区域时禁止打开，回到普通元素后恢复', () => {
      selector.toggle();
      move();
      lock();
      setLevel(1);
      expect(ui().querySelector<HTMLButtonElement>('.confirm')?.disabled).toBe(true);
      expect(ui().querySelector('.confirm')?.textContent).toBe('该区域不可选');
      ui().querySelector<HTMLButtonElement>('.confirm')?.click();
      expect(requestWindow).not.toHaveBeenCalled();
      setLevel(0);
      expect(ui().querySelector<HTMLButtonElement>('.confirm')?.disabled).toBe(false);
      expect(ui().querySelector('.confirm')?.textContent).toBe('确定');
    });

    it('离开禁选区域后恢复普通样式并可锁定', () => {
      const ordinary = target;
      target = iframe;
      selector.toggle();
      move();
      lock();
      target = ordinary;
      move();
      expect(ui().querySelector('.outline')?.classList.contains('blocked')).toBe(false);
      expect(ui().querySelector<HTMLElement>('.picker')?.style.cursor).toBe('crosshair');
      expect(ui().querySelector<HTMLElement>('.restriction')?.hidden).toBe(true);
      lock();
      expect(ui().querySelector<HTMLElement>('.adjustments')?.hidden).toBe(false);
      expect(ui().querySelector<HTMLButtonElement>('.confirm')?.disabled).toBe(false);
    });

    it('锁定之后新增 iframe，会标红并禁用打开按钮', async () => {
      selector.toggle();
      move();
      lock();
      const nested = document.createElement('iframe');
      target.append(nested);
      await vi.waitFor(() =>
        expect(ui().querySelector<HTMLButtonElement>('.confirm')?.disabled).toBe(true),
      );
      expect(ui().querySelector('.outline')?.classList.contains('blocked')).toBe(true);
      expect(requestWindow).not.toHaveBeenCalled();
    });
  });
});
