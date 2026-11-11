import { createOverlay } from './overlay';
import { createPipSession } from './pip';
import type { TargetElement } from './pip';
import { containsIframe } from './iframe';

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    if (error.name === 'NotAllowedError') return '浏览器拒绝打开画中画，请再次点击“确定”重试。';
    if (error.name === 'NotSupportedError') return '当前页面或浏览器不支持画中画。';
    return error.message;
  }
  return '无法打开浮窗，请重新选择或按 Esc 退出。';
}

/**
 * 创建页面级元素选择器，拦截选择点击并管理浮窗生命周期。
 * @param source 要选择元素的顶层窗口。
 * @returns 可切换选择状态及清理资源的控制器。
 */
export function createSelector(source: Window) {
  const document = source.document;
  let selecting = false;
  let busy = false;
  let generation = 0;
  let hovered: TargetElement | null = null;
  let selected: TargetElement | null = null;
  let levels: TargetElement[] = [];
  let level = 0;
  let locked = false;
  let frame = 0;
  const lifetime = new AbortController();
  let selectionEvents: AbortController | null = null;
  let pending: AbortController | null = null;
  let blocked = false;
  let iframeCheckAt = 0;
  const overlay = createOverlay(document, {
    onCancel: stop,
    onConfirm: openSelected,
    onReselect: reselect,
    onLevelChange: changeLevel,
  });
  const session = createPipSession(source, overlay.notify);

  function selectable(element: Element | null): element is TargetElement {
    return (
      (element instanceof HTMLElement || element instanceof SVGElement) &&
      element !== document.body &&
      element !== document.documentElement &&
      !overlay.host.contains(element) &&
      !element.closest('[data-pip-any-placeholder]') &&
      !element.matches('script, style, link, meta, head, title')
    );
  }

  function fromPointer(event: MouseEvent): TargetElement | null {
    if (overlay.isControlEvent(event)) return null;
    // 不进入 iframe 或 Shadow DOM；开放组件可选择其宿主。
    let element = overlay.pickElement(event.clientX, event.clientY);
    // path、circle 等图元离开 SVG 容器后不能单独显示，选择其 SVG 根元素。
    if (element instanceof SVGElement) element = element.closest('svg');
    return selectable(element) ? element : null;
  }

  function paint(): void {
    if (!selecting) return;
    if (selected && !selected.isConnected) {
      reselect();
      overlay.error('目标元素已被页面移除，请重新选择。');
    }
    // 边框每帧跟随位置；子树检测限频，避免大页面中反复扫描开放组件。
    const now = source.performance.now();
    if (now >= iframeCheckAt) {
      const nextBlocked = selected !== null && containsIframe(selected);
      if (nextBlocked !== blocked) updateAdjustment();
      iframeCheckAt = now + 200;
    }
    overlay.highlight(selected, blocked);
    frame = source.requestAnimationFrame(paint);
  }

  function stop(): void {
    selecting = false;
    generation++;
    pending?.abort();
    selectionEvents?.abort();
    selectionEvents = null;
    source.cancelAnimationFrame(frame);
    selected = null;
    hovered = null;
    levels = [];
    level = 0;
    locked = false;
    overlay.setSelecting(false);
    updateAdjustment();
  }

  function move(event: MouseEvent): void {
    if (busy || locked || overlay.isControlEvent(event)) return;
    const element = fromPointer(event);
    if (element === hovered) return;
    hovered = element;
    selected = element;
    levels = [];
    level = 0;
    let ancestor = element;
    while (ancestor) {
      levels.push(ancestor);
      const parent = ancestor.parentElement;
      ancestor = selectable(parent) ? parent : null;
    }
    overlay.error('');
    updateAdjustment();
    overlay.highlight(selected, blocked);
  }

  function updateAdjustment(): void {
    blocked = selected !== null && containsIframe(selected);
    overlay.setAdjustment(level, Math.max(0, levels.length - 1), locked, busy, blocked);
  }

  function changeLevel(nextLevel: number): void {
    if (!selecting || busy || !Number.isInteger(nextLevel)) return;
    const next = levels[nextLevel];
    if (!next) return;
    if (!next.isConnected || next.ownerDocument !== document) {
      reselect();
      overlay.error('目标区域已被页面更新，请重新选择。');
      return;
    }
    level = nextLevel;
    selected = next;
    overlay.error('');
    updateAdjustment();
    overlay.highlight(selected, blocked);
  }

  function reselect(): void {
    if (busy) return;
    locked = false;
    selected = null;
    hovered = null;
    levels = [];
    level = 0;
    overlay.error('');
    overlay.highlight(null);
    updateAdjustment();
  }

  function swallow(event: Event): void {
    if (overlay.isControlEvent(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function key(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      swallow(event);
      stop();
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const expand = event.key === 'ArrowUp' || event.key === 'ArrowRight';
    const shrink = event.key === 'ArrowDown' || event.key === 'ArrowLeft';
    if (!expand && !shrink) return;
    // 包括滑块获得焦点的情况：阻止原生 range 再处理一次方向键。
    event.preventDefault();
    event.stopImmediatePropagation();
    if (busy || !selected) return;
    changeLevel(level + (expand ? 1 : -1));
  }

  function click(event: MouseEvent): void {
    if (overlay.isControlEvent(event)) return;
    swallow(event);
    if (event.button !== 0 || busy || locked) return;
    // 点击事件用于无 mousemove 的触控输入；键盘调整过的层级优先保留。
    const pointerTarget = fromPointer(event);
    const target = pointerTarget === hovered && selected ? selected : pointerTarget;
    if (!target) {
      overlay.error('请点击网页中的具体元素。');
      return;
    }
    if (pointerTarget !== hovered) move(event);
    if (containsIframe(target)) {
      updateAdjustment();
      overlay.highlight(target, true);
      overlay.error('该区域包含 iframe，无法选定，请选择其他元素。');
      return;
    }
    selected = target;
    locked = true;
    overlay.error('');
    updateAdjustment();
    overlay.highlight(selected, blocked);
    overlay.focusAdjustment();
  }

  function openSelected(): void {
    if (!selecting || !locked || !selected || busy) return;
    if (!selected.isConnected) {
      reselect();
      overlay.error('目标元素已被页面移除，请重新选择。');
      return;
    }
    const target = selected;
    if (containsIframe(target)) {
      updateAdjustment();
      overlay.highlight(target, true);
      overlay.error('该区域包含 iframe，无法放入浮窗。');
      return;
    }
    busy = true;
    pending = new AbortController();
    const attempt = generation;
    overlay.error('正在打开浮窗…');
    updateAdjustment();
    // 直接使用“确定”按钮的真实点击申请 PiP，不经过消息或定时器。
    void session
      .open(target, pending.signal)
      .then(() => {
        if (generation === attempt) stop();
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === 'AbortError') return;
        if (generation === attempt) overlay.error(errorMessage(error));
        else overlay.notify(errorMessage(error));
      })
      .finally(() => {
        busy = false;
        pending = null;
        updateAdjustment();
      });
  }

  function toggle(): void {
    if (selecting) {
      stop();
      return;
    }
    if (busy) {
      overlay.notify('正在打开浮窗，请稍候。');
      return;
    }
    if (!source.isSecureContext || !('documentPictureInPicture' in source)) {
      overlay.notify('此页面不支持画中画，请使用桌面版 Chrome 116 或更新版本访问 HTTPS 网页。');
      return;
    }
    selecting = true;
    generation++;
    overlay.setSelecting(true);
    selectionEvents = new AbortController();
    const options = { capture: true, signal: selectionEvents.signal };
    source.addEventListener('mousemove', move, options);
    source.addEventListener('click', click, options);
    source.addEventListener('auxclick', swallow, options);
    source.addEventListener('pointerdown', swallow, options);
    source.addEventListener('mousedown', swallow, options);
    source.addEventListener('pointerup', swallow, options);
    source.addEventListener('mouseup', swallow, options);
    source.addEventListener('keydown', key, options);
    paint();
  }

  function dispose(): void {
    stop();
    lifetime.abort();
    session.dispose();
    overlay.destroy();
  }

  source.addEventListener('pagehide', dispose, { once: true, signal: lifetime.signal });
  return {
    toggle,
    dispose,
    /** 供工具栏面板读取当前页面是否正在选择，避免仅查询就切换状态。 */
    isSelecting(): boolean {
      return selecting;
    },
  };
}
