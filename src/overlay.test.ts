import { afterEach, describe, expect, it, vi } from 'vitest';

import { createOverlayView } from './overlay-view';
import css from './overlay.css?raw';
import html from './overlay.html?raw';
import { createOverlay } from './overlay';

const overlays: ReturnType<typeof createOverlay>[] = [];

function actions() {
  return {
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
    onReselect: vi.fn(),
    onLevelChange: vi.fn(),
  };
}

afterEach(() => {
  for (const overlay of overlays.splice(0)) overlay.destroy();
  vi.doUnmock('./overlay.html?raw');
  vi.resetModules();
});

describe('选择 UI 静态模板', () => {
  it('模板无脚本、内联事件和外部资源，样式可直接嵌入', () => {
    const view = createOverlayView(document);
    expect(view.fragment.querySelector('script, link, iframe, [src], [href]')).toBeNull();
    for (const element of view.fragment.querySelectorAll('*')) {
      expect(
        Array.from(element.attributes).some((attribute) => attribute.name.startsWith('on')),
      ).toBe(false);
    }
    expect(css).not.toMatch(/@import\b|url\s*\(/i);
  });

  it('创建尚未挂载的结构，保留节点顺序、初始状态与 ARIA', () => {
    const view = createOverlayView(document);
    expect(view.panel.isConnected).toBe(false);
    expect(Array.from(view.fragment.children, (element) => element.tagName)).toEqual([
      'STYLE',
      'DIV',
      'DIV',
      'SECTION',
      'DIV',
    ]);
    expect(view.fragment.children[1]).toBe(view.picker);
    expect(view.fragment.children[2]).toBe(view.outline);
    expect(view.fragment.children[3]).toBe(view.panel);
    expect(view.fragment.children[4]).toBe(view.toast);
    for (const element of [
      view.picker,
      view.outline,
      view.panel,
      view.adjustments,
      view.restriction,
      view.toast,
    ]) {
      expect(element.hidden).toBe(true);
    }
    expect(view.panel.getAttribute('aria-label')).toBe('Pip Any 元素选择');
    expect(view.hint.textContent).toBe('点击选择对应内容。');
    expect(view.confirm.textContent).toBe('确定');
    expect(view.slider.getAttribute('aria-label')).toBe('选区范围');
    expect(view.slider.type).toBe('range');
    expect(view.slider.min).toBe('0');
    expect(view.slider.max).toBe('0');
    expect(view.slider.step).toBe('1');
    expect(view.slider.value).toBe('0');
    for (const element of [view.status, view.toast]) {
      expect(element.getAttribute('role')).toBe('status');
      expect(element.getAttribute('aria-live')).toBe('polite');
    }
  });

  it('节点属于传入文档，不依赖全局 Document 或 Window 构造器', () => {
    const other = document.implementation.createHTMLDocument('另一个文档');
    expect(other.defaultView).toBeNull();
    const view = createOverlayView(other);
    for (const element of view.fragment.querySelectorAll('*')) {
      expect(element.ownerDocument).toBe(other);
    }
    const overlay = createOverlay(other, actions());
    overlays.push(overlay);
    expect(overlay.host.ownerDocument).toBe(other);
    expect(other.querySelector('[data-pip-any-ui]')).toBe(overlay.host);
    expect(document.querySelector('[data-pip-any-ui]')).toBeNull();
  });

  it('动态目标说明、通知和错误只作为文本展示', () => {
    const overlay = createOverlay(document, actions());
    overlays.push(overlay);
    const target = document.createElement('article');
    const text = '<img src=x onerror="alert(1)"><script>alert(1)</script>';
    target.id = text;
    overlay.highlight(target);
    overlay.notify(text);
    overlay.error(text);
    const root = overlay.host.shadowRoot;
    expect(root?.querySelector('[data-ui="target"]')?.textContent).toContain(text);
    expect(root?.querySelector('[data-ui="toast"]')?.textContent).toBe(text);
    expect(root?.querySelector('[data-ui="status"]')?.textContent).toBe(text);
    expect(root?.querySelector('img, script')).toBeNull();
  });

  it('实例引用与事件隔离，样式 class 不作为绑定契约', () => {
    const firstActions = actions();
    const secondActions = actions();
    const first = createOverlay(document, firstActions);
    const second = createOverlay(document, secondActions);
    overlays.push(first, second);
    const firstRoot = first.host.shadowRoot;
    const secondRoot = second.host.shadowRoot;
    const confirm = firstRoot?.querySelector('button[data-ui="confirm"]');
    expect(confirm).toBeInstanceOf(HTMLButtonElement);
    if (!(confirm instanceof HTMLButtonElement)) throw new Error('缺少确认按钮。');
    confirm.className = 'renamed';
    confirm.click();
    expect(firstActions.onConfirm).toHaveBeenCalledOnce();
    expect(secondActions.onConfirm).not.toHaveBeenCalled();
    first.setSelecting(true);
    first.setAdjustment(1, 2, true, false);
    const slider = firstRoot?.querySelector('input');
    if (!slider) throw new Error('缺少范围滑块。');
    slider.value = '2';
    slider.dispatchEvent(new Event('input'));
    expect(firstActions.onLevelChange).toHaveBeenCalledWith(2);
    expect(secondActions.onLevelChange).not.toHaveBeenCalled();
    expect(secondRoot?.querySelector('input')?.value).toBe('0');
    first.destroy();
    expect(second.host.isConnected).toBe(true);
    second.notify('第二个实例');
    expect(secondRoot?.querySelector('[data-ui="toast"]')?.textContent).toBe('第二个实例');
  });

  const malformed = [
    ['缺少控件', html.replace('data-ui="confirm"', 'data-ui="removed"'), 'confirm'],
    ['重复控件', html + '<button type="button" data-ui="cancel"></button>', 'cancel'],
    [
      '错误标签',
      html.replace('data-ui="slider"', 'data-ui="removed"') + '<div data-ui="slider"></div>',
      'slider',
    ],
    ['错误输入类型', html.replace('type="range"', 'type="text"'), 'slider'],
    [
      '错误按钮类型',
      html.replace('type="button" class="confirm"', 'type="submit" class="confirm"'),
      'confirm',
    ],
    [
      '错误命名空间',
      html.replace('data-ui="picker"', 'data-ui="removed"') +
        '<svg><div data-ui="picker"></div></svg>',
      'picker',
    ],
  ];

  it.each(malformed)('%s 时明确报错且不挂载 UI', async (_, source, control) => {
    vi.doMock('./overlay.html?raw', () => ({ default: source }));
    vi.resetModules();
    const { createOverlay: createInvalidOverlay } = await import('./overlay');
    expect(() => createInvalidOverlay(document, actions())).toThrow(control);
    expect(document.querySelector('[data-pip-any-ui]')).toBeNull();
  });
});
