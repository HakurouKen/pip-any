export {};

const button = document.querySelector<HTMLButtonElement>('#toggle-selection');
const status = document.querySelector<HTMLElement>('#status');

if (!button || !status) throw new Error('工具栏面板缺少必要控件。');

const toggleButton = button;
const statusMessage = status;
let activeTabId: number | undefined;
let selecting = false;

function showError(message: string): void {
  statusMessage.textContent = message;
  statusMessage.dataset.error = '';
}

function updateButton(): void {
  toggleButton.textContent = selecting ? '取消选择' : '选择内容';
}

async function initialize(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || !tab.url?.startsWith('https://')) {
    toggleButton.textContent = '当前页面不支持';
    showError('请打开普通 HTTPS 网页后重试。浏览器内部页面和扩展页面不支持选择。');
    return;
  }
  activeTabId = tab.id;
  try {
    const [state] = await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      world: 'ISOLATED',
      func: () => window.__pipAnyController?.isSelecting() ?? false,
    });
    selecting = state?.result === true;
    statusMessage.textContent = selecting ? '正在选择，可在页面调整范围或取消。' : '';
    updateButton();
    toggleButton.disabled = false;
  } catch {
    toggleButton.textContent = '当前页面无法访问';
    showError('此页面禁止插件访问。请切换到普通 HTTPS 网页；扩展更新后请刷新网页再试。');
  }
}

toggleButton.addEventListener('click', () => {
  if (activeTabId === undefined || toggleButton.disabled) return;
  toggleButton.disabled = true;
  statusMessage.removeAttribute('data-error');
  statusMessage.textContent = selecting ? '正在取消选择…' : '正在进入选择模式…';
  void chrome.scripting
    .executeScript({
      target: { tabId: activeTabId },
      world: 'ISOLATED',
      files: ['content.js'],
    })
    .then(() => {
      window.close();
    })
    .catch(() => {
      showError('无法操作此页面，请刷新网页或切换到其他 HTTPS 网页后重试。');
      toggleButton.disabled = false;
    });
});

void initialize().catch(() => {
  toggleButton.textContent = '无法读取当前页面';
  showError('请关闭面板后重新打开，或切换到普通 HTTPS 网页后重试。');
});
