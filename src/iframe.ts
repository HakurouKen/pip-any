/**
 * 检查选区是否包含禁止搬移的 iframe 或 frame。
 * @param element 待检查的元素，可包含开放的 Shadow DOM。
 * @returns 元素自身、普通后代或开放 Shadow DOM 中有 frame 时返回 true；封闭组件内部无法检查。
 */
export function containsIframe(element: Element): boolean {
  if (element.matches('iframe, frame') || element.querySelector('iframe, frame')) return true;
  if (element.shadowRoot && rootContainsIframe(element.shadowRoot)) return true;
  return [...element.querySelectorAll('*')].some((child) =>
    child.shadowRoot ? rootContainsIframe(child.shadowRoot) : false,
  );
}

function rootContainsIframe(root: ShadowRoot): boolean {
  if (root.querySelector('iframe, frame')) return true;
  return [...root.querySelectorAll('*')].some((child) =>
    child.shadowRoot ? rootContainsIframe(child.shadowRoot) : false,
  );
}
