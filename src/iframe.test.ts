import { describe, expect, it } from 'vitest';

import { containsIframe } from './iframe';

describe('iframe 禁选检测', () => {
  it('识别 iframe、frame 及其父区域', () => {
    const container = document.createElement('section');
    const iframe = document.createElement('iframe');
    container.append(iframe);
    expect(containsIframe(iframe)).toBe(true);
    expect(containsIframe(container)).toBe(true);
    expect(containsIframe(document.createElement('frame'))).toBe(true);
  });

  it('识别嵌套开放 Shadow DOM 中的 iframe', () => {
    const container = document.createElement('section');
    const host = document.createElement('div');
    const nested = document.createElement('div');
    container.append(host);
    host.attachShadow({ mode: 'open' }).append(nested);
    nested.attachShadow({ mode: 'open' }).append(document.createElement('iframe'));
    expect(containsIframe(container)).toBe(true);
    expect(containsIframe(host)).toBe(true);
  });

  it('不阻止只有普通内容的区域', () => {
    const container = document.createElement('section');
    container.innerHTML = '<h2>标题</h2><button>按钮</button>';
    expect(containsIframe(container)).toBe(false);
  });

  it('内容动态变化后重新计算结果', () => {
    const container = document.createElement('section');
    const iframe = document.createElement('iframe');
    expect(containsIframe(container)).toBe(false);
    container.append(iframe);
    expect(containsIframe(container)).toBe(true);
    iframe.remove();
    expect(containsIframe(container)).toBe(false);
  });
});
