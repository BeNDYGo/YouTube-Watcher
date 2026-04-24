chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) {
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: "YT_TP_TOGGLE_PANEL" }, () => {
    void chrome.runtime.lastError;
  });
});
