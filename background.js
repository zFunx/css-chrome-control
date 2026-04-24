// Extract domain from URL
function getDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch (e) {
    return null;
  }
}

// Inject CSS into a specific tab
function injectCSSForTab(tabId, url) {
  const domain = getDomain(url);
  if (!domain) return;

  const storageKey = `css_${domain}`;
  
  chrome.storage.local.get([storageKey], (result) => {
    const cssList = result[storageKey] || [];
    
    // Sort by order and filter enabled
    const activeCss = cssList
      .filter(css => css.enabled)
      .sort((a, b) => a.order - b.order)
      .map(css => `/* Source: ${css.name} */\n${css.content}`)
      .join('\n\n');

    chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: (cssText) => {
        let styleEl = document.getElementById('css-chrome-control-style');
        if (!styleEl) {
          styleEl = document.createElement('style');
          styleEl.id = 'css-chrome-control-style';
          document.head.appendChild(styleEl);
        }
        styleEl.textContent = cssText;
      },
      args: [activeCss]
    }).catch(err => console.error("CSS Injection Error:", err));
  });
}

// Listen for tab navigation/updates to inject CSS automatically
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' && tab.url) {
    injectCSSForTab(tabId, tab.url);
  }
});
