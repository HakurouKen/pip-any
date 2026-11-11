import { containsIframe } from './iframe';

/** Document PiP 创建窗口时使用的初始尺寸。 */
export interface PipSize {
  width: number;
  height: number;
}

/** 可搬移到浮窗且具有内联样式接口的网页元素。 */
export type TargetElement = HTMLElement | SVGElement;

interface PipApi {
  requestWindow(options: PipSize): Promise<Window>;
}

interface Placement {
  element: TargetElement;
  placeholder: HTMLElement;
  parent: Node;
  nextSibling: ChildNode | null;
  style: string | null;
}

function isPipApi(value: unknown): value is PipApi {
  return (
    typeof value === 'object' &&
    value !== null &&
    'requestWindow' in value &&
    typeof value.requestWindow === 'function'
  );
}

/**
 * 根据目标尺寸和可用屏幕计算浮窗初始尺寸，留出窗口边框空间。
 * @param rect 目标元素的可见尺寸。
 * @param screen 可用屏幕尺寸。
 * @returns 同时受目标和屏幕大小约束的窗口尺寸。
 */
export function getPipSize(rect: Pick<DOMRect, 'width' | 'height'>, screen: Screen): PipSize {
  const maxWidth = Math.max(1, (screen.availWidth || 1280) - 80);
  const maxHeight = Math.max(1, (screen.availHeight || 800) - 100);
  const scale = Math.min(
    1,
    maxWidth / Math.max(1, rect.width),
    maxHeight / Math.max(1, rect.height),
  );
  return {
    width: Math.min(maxWidth, Math.max(240, Math.round(rect.width * scale))),
    height: Math.min(maxHeight, Math.max(160, Math.round(rect.height * scale))),
  };
}

function prepareHead(source: Document): DocumentFragment {
  const fragment = source.createDocumentFragment();
  const base = source.createElement('base');
  base.href = source.baseURI;
  fragment.append(base);

  for (const sheet of [...source.styleSheets, ...source.adoptedStyleSheets]) {
    if (sheet.disabled) continue;
    // 保留外链样式表自身的基准 URL，避免图片、字体的相对路径失效。
    if (sheet.href) {
      const link = source.createElement('link');
      link.rel = 'stylesheet';
      link.href = sheet.href;
      link.media = sheet.media.mediaText;
      fragment.append(link);
      continue;
    }
    try {
      const style = source.createElement('style');
      style.textContent = [...sheet.cssRules].map((rule) => rule.cssText).join('\n');
      style.media = sheet.media.mediaText;
      fragment.append(style);
    } catch {
      /* 无法读取的无来源样式表跳过。 */
    }
  }
  const style = source.createElement('style');
  style.textContent =
    'html, body { display: block !important; position: static !important; inset: auto !important; transform: none !important; box-sizing: border-box !important; margin: 0 !important; padding: 0 !important; border: 0 !important; width: 100% !important; height: 100% !important; min-width: 0 !important; min-height: 0 !important; max-width: none !important; max-height: none !important; } html { overflow: hidden !important; } body { overflow: auto !important; }';
  fragment.append(style);
  const title = source.createElement('title');
  title.textContent = `Pip Any · ${source.title}`;
  fragment.append(title);
  return fragment;
}

function createPlacement(source: Window, element: TargetElement): Placement {
  if (!element.parentNode) throw new Error('目标元素已被页面移除，请重新选择。');
  const rect = element.getBoundingClientRect();
  const computed = source.getComputedStyle(element);
  const placeholder = source.document.createElement('div');
  placeholder.dataset.pipAnyPlaceholder = '';
  placeholder.setAttribute('aria-hidden', 'true');
  placeholder.style.cssText =
    'visibility: hidden !important; pointer-events: none !important; box-sizing: border-box !important;';
  const layoutProperties = [
    'display',
    'margin-top',
    'margin-right',
    'margin-bottom',
    'margin-left',
    'flex',
    'align-self',
    'order',
    'grid-area',
    'position',
    'top',
    'right',
    'bottom',
    'left',
  ];
  for (const property of layoutProperties) {
    placeholder.style.setProperty(property, computed.getPropertyValue(property), 'important');
  }
  placeholder.style.setProperty('width', `${rect.width}px`, 'important');
  placeholder.style.setProperty('height', `${rect.height}px`, 'important');
  if (computed.display === 'inline')
    placeholder.style.setProperty('display', 'inline-block', 'important');
  return {
    element,
    placeholder,
    parent: element.parentNode,
    nextSibling: element.nextSibling,
    style: element.getAttribute('style'),
  };
}

/**
 * 管理一个页面的浮窗和目标原位置，支持替换及关闭恢复。
 * @param source 发起画中画的源页面窗口。
 * @param notify 向源页面展示恢复异常的提示函数。
 * @returns 可在真实点击处理器中直接调用的浮窗控制器。
 */
export function createPipSession(source: Window, notify: (message: string) => void) {
  let pipWindow: Window | null = null;
  let placement: Placement | null = null;
  let opening = false;
  let disposed = false;

  function restore(): void {
    const current = placement;
    if (!current) return;
    placement = null;
    // 先恢复原始内联样式，避免把浮窗专用尺寸带回网页。
    if (current.style === null) current.element.removeAttribute('style');
    else current.element.setAttribute('style', current.style);
    if (current.placeholder.isConnected) {
      current.placeholder.replaceWith(current.element);
    } else if (current.parent.isConnected && current.parent.ownerDocument === source.document) {
      const next = current.nextSibling?.parentNode === current.parent ? current.nextSibling : null;
      current.parent.insertBefore(current.element, next);
    } else {
      source.document.body.append(current.element);
      if (!disposed) notify('原容器已被页面移除，元素已放回页面底部。');
    }
    current.placeholder.remove();
  }

  async function open(element: TargetElement, signal?: AbortSignal): Promise<void> {
    if (opening) throw new Error('正在打开浮窗，请稍候。');
    if (disposed) throw new Error('当前页面已离开，请刷新后重试。');
    if (!element.isConnected || element.ownerDocument !== source.document) {
      throw new Error('目标元素已被页面移除，请重新选择。');
    }
    if (element === source.document.body || element === source.document.documentElement) {
      throw new Error('请选择页面中的具体区域，不支持整个页面。');
    }
    if (containsIframe(element)) {
      throw new Error('不支持 iframe 或包含 iframe 的区域，请选择其他元素。');
    }
    const api = 'documentPictureInPicture' in source ? source.documentPictureInPicture : undefined;
    if (!isPipApi(api))
      throw new Error('当前页面不支持画中画，请使用桌面版 Chrome 116 或更新版本。');

    const rect = element.getBoundingClientRect();
    const head = prepareHead(source.document);
    const next = createPlacement(source, element);
    const inherited = source.getComputedStyle(element);
    const font = inherited.font;
    const color = inherited.color;
    const background = source.getComputedStyle(source.document.body).backgroundColor;
    const windowExisted = pipWindow !== null && !pipWindow.closed;
    opening = true;
    try {
      // 在第一次 await 前请求窗口，保留目标点击带来的 transient activation。
      const window =
        windowExisted && pipWindow
          ? pipWindow
          : await api.requestWindow(getPipSize(rect, source.screen));
      if (disposed || signal?.aborted || !element.isConnected) {
        if (!windowExisted) window.close();
        if (signal?.aborted) throw new DOMException('已取消选择。', 'AbortError');
        throw new Error('目标元素已被页面移除，请重新选择。');
      }
      if (containsIframe(element)) {
        if (!windowExisted) window.close();
        throw new Error('选区新增了 iframe，无法放入浮窗，请重新选择。');
      }
      if (!windowExisted) {
        pipWindow = window;
        window.addEventListener(
          'pagehide',
          () => {
            if (pipWindow !== window) return;
            restore();
            pipWindow = null;
          },
          { once: true },
        );
      }
      restore();
      // restore() 可能改变相邻节点的位置，重新获取当前插入位置。
      next.parent = element.parentNode ?? next.parent;
      next.nextSibling = element.nextSibling;
      element.before(next.placeholder);
      placement = next;
      window.document.head.replaceChildren(head);
      window.document.documentElement.lang = source.document.documentElement.lang;
      window.document.documentElement.className = source.document.documentElement.className;
      window.document.body.className = source.document.body.className;
      window.document.body.style.cssText = '';
      window.document.body.style.font = font;
      window.document.body.style.color = color;
      window.document.body.style.backgroundColor = background;
      for (const [property, value] of Object.entries({
        position: 'relative',
        inset: 'auto',
        transform: 'none',
        margin: '0',
        display: 'block',
        width: '100%',
        height: 'auto',
        'box-sizing': 'border-box',
        'min-width': '0',
        'min-height': '0',
        'max-width': 'none',
        'max-height': 'none',
      }))
        element.style.setProperty(property, value, 'important');
      window.document.body.replaceChildren(element);
    } catch (error) {
      // 仅回滚已经开始搬移的新目标；窗口请求失败时保留旧目标。
      if (placement === next) restore();
      if (!windowExisted && pipWindow) {
        pipWindow.close();
        pipWindow = null;
      }
      throw error;
    } finally {
      opening = false;
    }
  }

  function dispose(): void {
    disposed = true;
    restore();
    pipWindow?.close();
    pipWindow = null;
  }

  return { open, dispose };
}
