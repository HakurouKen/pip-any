import css from './overlay.css?raw';
import html from './overlay.html?raw';

function requireControl<K extends keyof HTMLElementTagNameMap>(
  root: DocumentFragment,
  name: string,
  tag: K,
): HTMLElementTagNameMap[K] {
  const selector = `[data-ui="${name}"]`;
  const matches = root.querySelectorAll(selector);
  const element = root.querySelector<HTMLElementTagNameMap[K]>(`${tag}${selector}`);
  // 按实际标签及命名空间校验，不依赖全局构造器，兼容其他 Document 的节点。
  if (matches.length !== 1 || !element || element.namespaceURI !== 'http://www.w3.org/1999/xhtml') {
    throw new Error(`选择 UI 模板控件 ${name} 必须是唯一的 <${tag}>。`);
  }
  return element;
}

/**
 * 同步实例化扩展自有静态模板，校验控件并返回尚未挂载的节点引用。
 * @param document 创建并持有 UI 节点的源页面文档。
 * @returns 包含样式与结构的片段，以及该实例独有的控件引用。
 * @throws 模板缺少控件、控件重复或标签及输入类型不符合约定时抛出错误。
 */
export function createOverlayView(document: Document) {
  const template = document.createElement('template');
  // 仅解析打包进扩展的固定结构；网页数据与动态文案不得传入此处。
  template.innerHTML = html;
  const fragment = document.importNode(template.content, true);
  const controls = {
    picker: requireControl(fragment, 'picker', 'div'),
    outline: requireControl(fragment, 'outline', 'div'),
    panel: requireControl(fragment, 'panel', 'section'),
    hint: requireControl(fragment, 'hint', 'div'),
    target: requireControl(fragment, 'target', 'div'),
    restriction: requireControl(fragment, 'restriction', 'div'),
    adjustments: requireControl(fragment, 'adjustments', 'div'),
    slider: requireControl(fragment, 'slider', 'input'),
    cancel: requireControl(fragment, 'cancel', 'button'),
    reselect: requireControl(fragment, 'reselect', 'button'),
    confirm: requireControl(fragment, 'confirm', 'button'),
    status: requireControl(fragment, 'status', 'div'),
    toast: requireControl(fragment, 'toast', 'div'),
  };
  if (controls.slider.type !== 'range') {
    throw new Error('选择 UI 模板控件 slider 必须是 range 输入框。');
  }
  for (const name of ['cancel', 'reselect', 'confirm'] as const) {
    if (controls[name].type !== 'button') {
      throw new Error(`选择 UI 模板控件 ${name} 必须使用 button 类型。`);
    }
  }
  const style = document.createElement('style');
  style.textContent = css;
  fragment.prepend(style);
  return { fragment, ...controls };
}
