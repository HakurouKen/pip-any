import { createOverlayView } from './overlay-view';
import type { TargetElement } from './pip';

interface OverlayActions {
  onCancel(): void;
  onConfirm(): void;
  onReselect(): void;
  onLevelChange(level: number): void;
}

/**
 * 创建与网页样式隔离的选择框、操作提示及通知。
 * @param document 源页面文档。
 * @param actions 取消、打开浮窗、重新选择及调整选区时执行的回调。
 * @returns 选择框与提示的操作接口。
 * @throws 静态模板的必要控件不符合约定时抛出错误，且不挂载 UI。
 */
export function createOverlay(document: Document, actions: OverlayActions) {
  const host = document.createElement('div');
  host.dataset.pipAnyUi = '';
  host.style.cssText =
    'all: initial !important; position: fixed !important; inset: 0 !important; z-index: 2147483647 !important; pointer-events: none !important;';
  const shadow = host.attachShadow({ mode: 'open' });
  const {
    fragment,
    outline,
    picker,
    panel,
    hint,
    target,
    restriction,
    status,
    adjustments,
    slider,
    cancel,
    reselect,
    confirm,
    toast,
  } = createOverlayView(document);
  cancel.addEventListener('click', actions.onCancel);
  reselect.addEventListener('click', actions.onReselect);
  confirm.addEventListener('click', actions.onConfirm);
  slider.addEventListener('input', () => actions.onLevelChange(slider.valueAsNumber));
  shadow.append(fragment);
  document.documentElement.append(host);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  function setSelecting(selecting: boolean): void {
    panel.hidden = !selecting;
    picker.hidden = !selecting;
    if (!selecting) outline.hidden = true;
    status.textContent = '';
    target.textContent = '尚未选择区域';
  }

  function setAdjustment(
    level: number,
    maxLevel: number,
    locked: boolean,
    busy: boolean,
    blocked = false,
  ): void {
    adjustments.hidden = !locked;
    hint.textContent = locked ? '滑块或方向键调整：↑ / → 扩大，↓ / ← 缩小。' : '点击选择对应内容。';
    slider.max = String(maxLevel);
    slider.value = String(level);
    slider.disabled = busy || maxLevel === 0;
    slider.setAttribute('aria-valuetext', `第 ${level + 1} 级，共 ${maxLevel + 1} 级`);
    confirm.disabled = busy || blocked;
    restriction.hidden = !blocked;
    confirm.textContent = busy ? '正在打开…' : blocked ? '该区域不可选' : '确定';
    reselect.disabled = busy;
  }

  function highlight(element: TargetElement | null, blocked = false): void {
    outline.hidden = !element;
    outline.classList.toggle('blocked', blocked);
    picker.style.cursor = blocked ? 'not-allowed' : 'crosshair';
    if (!element) {
      target.textContent = '尚未选择区域';
      return;
    }
    const rect = element.getBoundingClientRect();
    outline.style.left = `${rect.left}px`;
    outline.style.top = `${rect.top}px`;
    outline.style.width = `${rect.width}px`;
    outline.style.height = `${rect.height}px`;
    const label = `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}`;
    target.textContent = `${label} · ${Math.round(rect.width)} × ${Math.round(rect.height)}${blocked ? ' · 不可选' : ''}`;
  }

  function notify(message: string): void {
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, 6000);
  }

  function destroy(): void {
    clearTimeout(toastTimer);
    host.remove();
  }

  return {
    host,
    isControlEvent(event: Event): boolean {
      return event.composedPath().includes(panel);
    },
    pickElement(x: number, y: number): Element | null {
      // 暂时穿透透明选择层做命中测试，随后恢复；iframe 内部事件无需跨框架传播。
      picker.style.pointerEvents = 'none';
      try {
        return document.elementFromPoint(x, y);
      } finally {
        picker.style.removeProperty('pointer-events');
      }
    },
    setSelecting,
    setAdjustment,
    focusAdjustment(): void {
      (slider.disabled ? confirm : slider).focus({ preventScroll: true });
    },
    highlight,
    notify,
    destroy,
    error(message: string): void {
      status.textContent = message;
    },
  };
}
