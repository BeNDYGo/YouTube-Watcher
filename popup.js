(function () {
  "use strict";

  const VERSION_URL =
    "https://raw.githubusercontent.com/BeNDYGo/YouTube-Watcher/main/version.json";
  const RELEASES_URL = "https://github.com/BeNDYGo/YouTube-Watcher/releases";
  const DONATE_URL = "https://www.donationalerts.com/r/pipodripo";

  const currentVersion = document.getElementById("currentVersion");
  const latestVersion = document.getElementById("latestVersion");
  const latestVersionButton = document.getElementById("latestVersionButton");
  const versionMessage = document.getElementById("versionMessage");
  const donateButton = document.getElementById("donateButton");
  const panelToggle = document.getElementById("panelToggle");

  const manifestVersion = chrome.runtime.getManifest().version;

  currentVersion.textContent = `v${manifestVersion}`;
  latestVersionButton.addEventListener("click", () => openTab(RELEASES_URL));
  donateButton.addEventListener("click", () => openTab(DONATE_URL));
  panelToggle.addEventListener("click", handlePanelToggle);

  loadLatestVersion();
  loadPanelState();

  async function loadLatestVersion() {
    try {
      const response = await fetch(buildVersionUrl(), {
        cache: "no-store",
        headers: {
          "cache-control": "no-cache, no-store, max-age=0",
          pragma: "no-cache"
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const remoteVersion = cleanVersion(data.version);

      if (!remoteVersion) {
        throw new Error("Missing version");
      }

      latestVersion.textContent = `v${remoteVersion}`;
      versionMessage.textContent = buildVersionMessage(
        remoteVersion,
        cleanText(data.message)
      );
      latestVersionButton.classList.toggle(
        "is-outdated",
        normalizeVersion(remoteVersion) !== normalizeVersion(manifestVersion)
      );
    } catch (_error) {
      latestVersion.textContent = "Ошибка";
      versionMessage.textContent = "Не удалось проверить актуальную версию";
    }
  }

  async function loadPanelState() {
    const tab = await getActiveTab();

    if (!tab?.id) {
      setToggleEnabled(false);
      return;
    }

    sendTabMessage(tab.id, { type: "YT_TP_GET_PANEL_STATE" }, (response) => {
      if (!response?.ok) {
        setToggleEnabled(false);
        return;
      }

      setToggleEnabled(true);
      setToggleState(Boolean(response.visible));
    });
  }

  async function handlePanelToggle() {
    if (panelToggle.disabled) {
      return;
    }

    const nextVisible = panelToggle.getAttribute("aria-pressed") !== "true";
    const tab = await getActiveTab();

    if (!tab?.id) {
      setToggleEnabled(false);
      return;
    }

    setToggleState(nextVisible);
    sendTabMessage(
      tab.id,
      { type: "YT_TP_SET_PANEL_VISIBILITY", visible: nextVisible },
      (response) => {
        if (!response?.ok) {
          setToggleEnabled(false);
          return;
        }

        setToggleEnabled(true);
        setToggleState(Boolean(response.visible));
      }
    );
  }

  function getActiveTab() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        resolve(tabs[0] || null);
      });
    });
  }

  function sendTabMessage(tabId, message, callback) {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        callback(null);
        return;
      }

      callback(response);
    });
  }

  function setToggleEnabled(enabled) {
    panelToggle.disabled = !enabled;
  }

  function setToggleState(visible) {
    panelToggle.setAttribute("aria-pressed", visible ? "true" : "false");
  }

  function openTab(url) {
    chrome.tabs.create({ url });
  }

  function buildVersionUrl() {
    const url = new URL(VERSION_URL);
    url.searchParams.set("_", String(Date.now()));
    return url.toString();
  }

  function buildVersionMessage(remoteVersion, remoteMessage) {
    const installedVersion = normalizeVersion(manifestVersion);
    const latestVersionValue = normalizeVersion(remoteVersion);
    const messageVersion = extractVersion(remoteMessage);

    if (installedVersion === latestVersionValue) {
      return "Установлена актуальная версия";
    }

    if (messageVersion && messageVersion !== latestVersionValue) {
      return `Доступна новая версия v${remoteVersion}. Пожалуйста, обновите расширение`;
    }

    return (
      remoteMessage ||
      `Доступна новая версия v${remoteVersion}. Пожалуйста, обновите расширение`
    );
  }

  function cleanVersion(value) {
    return cleanText(value).replace(/^v/i, "");
  }

  function normalizeVersion(value) {
    return cleanVersion(value).toLowerCase();
  }

  function extractVersion(value) {
    const match = cleanText(value).match(/\bv?(\d+(?:\.\d+)+)\b/i);
    return match ? normalizeVersion(match[1]) : "";
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }
})();
