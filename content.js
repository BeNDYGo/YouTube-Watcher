(function () {
  "use strict";

  const PANEL_ID = "yt-temp-playlist-extension";
  const STORAGE_KEY = "ytTempPlaylistVideos";
  const SETTINGS_KEY = "ytTempPlaylistSettings";
  const DEFAULT_VISIBLE_ROWS = 3;
  const MIN_VISIBLE_ROWS = 1;
  const MAX_VISIBLE_ROWS = 9;
  const DEFAULT_CORNER = "bottom-right";
  const PANEL_CORNERS = new Set([
    "top-left",
    "top-right",
    "bottom-left",
    "bottom-right"
  ]);
  const VIDEO_SELECTORS = [
    "ytd-video-renderer",
    "ytd-compact-video-renderer",
    "ytd-rich-item-renderer",
    "ytd-rich-grid-media",
    "ytd-grid-video-renderer",
    "ytd-playlist-video-renderer",
    "ytd-playlist-panel-video-renderer",
    "ytd-reel-item-renderer",
    "yt-lockup-view-model",
    "yt-lockup-view-model-wiz",
    "ytm-video-with-context-renderer"
  ].join(", ");
  const VIDEO_LINK_SELECTOR = [
    'a[href*="/watch?v="]',
    'a[href^="/watch?"]',
    'a[href*="/shorts/"]',
    'a[href^="/shorts/"]'
  ].join(", ");
  const IGNORED_VIDEO_CLICK_SELECTOR = [
    "button",
    '[role="button"]',
    "input",
    "select",
    "textarea",
    "ytd-menu-renderer",
    "tp-yt-paper-icon-button",
    "yt-icon-button",
    "yt-button-shape"
  ].join(", ");
  const PANEL_ANIMATION = {
    duration: 180,
    easing: "cubic-bezier(0.2, 0, 0, 1)"
  };
  const ITEM_ANIMATION = {
    duration: 220,
    easing: "cubic-bezier(0.2, 0, 0, 1)"
  };
  let nextPlaylistItemId = 1;

  const state = {
    addKeyDown: false,
    collapsed: false,
    videos: [],
    visibleRows: DEFAULT_VISIBLE_ROWS,
    corner: DEFAULT_CORNER,
    enteringItemKey: null,
    panel: null,
    animation: null,
    drag: null,
    transitionToken: 0,
    hiddenForFullscreen: false
  };

  loadVideos();
  document.addEventListener("keydown", handleKeyDown, true);
  document.addEventListener("keyup", handleKeyUp, true);
  document.addEventListener("click", handleDocumentClick, true);
  document.addEventListener("fullscreenchange", handleFullscreenChange);
  document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
  listenForExtensionIcon();
  window.addEventListener("blur", () => {
    state.addKeyDown = false;
  });

  function handleKeyDown(event) {
    if (isAddKey(event) && !isEditableTarget(event.target)) {
      state.addKeyDown = true;
    }
  }

  function handleKeyUp(event) {
    if (isAddKey(event)) {
      state.addKeyDown = false;
    }
  }

  function handleDocumentClick(event) {
    if (!state.addKeyDown) {
      return;
    }

    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest(`#${PANEL_ID}`)) {
      return;
    }

    const video = getVideoFromTarget(target);
    if (!video) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    addVideo(video);
  }

  function handleFullscreenChange() {
    if (isFullscreenActive()) {
      if (!state.panel) {
        state.hiddenForFullscreen = false;
        return;
      }

      state.hiddenForFullscreen = !state.panel.classList.contains("yt-tp-hidden");
      cancelPanelAnimation();
      state.panel.classList.add("yt-tp-hidden");
      return;
    }

    if (!state.hiddenForFullscreen) {
      return;
    }

    state.hiddenForFullscreen = false;
    ensurePanel();
    state.panel.classList.remove("yt-tp-hidden");
    renderPanel();
  }

  function isAddKey(event) {
    const key = String(event.key || "").toLowerCase();
    return event.code === "KeyA" || key === "a" || key === "ф";
  }

  function isEditableTarget(target) {
    if (!(target instanceof Element)) {
      return false;
    }

    const tagName = target.tagName.toLowerCase();
    return (
      tagName === "input" ||
      tagName === "textarea" ||
      tagName === "select" ||
      target.isContentEditable ||
      Boolean(target.closest('[contenteditable="true"]'))
    );
  }

  function getVideoFromTarget(target) {
    const directVideoLink = target.closest(VIDEO_LINK_SELECTOR);
    const nearestLink = target.closest("a[href]");

    if (nearestLink && !directVideoLink) {
      return null;
    }

    if (!directVideoLink && target.closest(IGNORED_VIDEO_CLICK_SELECTOR)) {
      return null;
    }

    const container = target.closest(VIDEO_SELECTORS);
    const anchor = directVideoLink || container?.querySelector(VIDEO_LINK_SELECTOR);

    if (!anchor || !anchor.href) {
      return null;
    }

    const url = new URL(anchor.href, location.href);
    const id = getVideoId(url);
    if (!id) {
      return null;
    }

    const videoContainer = container || anchor.closest(VIDEO_SELECTORS) || anchor;
    const title = getVideoTitle(videoContainer, anchor);
    const channel = getChannelName(videoContainer);
    const thumbnail = getThumbnail(videoContainer, id);

    return {
      id,
      title,
      channel,
      thumbnail,
      url: `https://www.youtube.com/watch?v=${id}`
    };
  }

  function getVideoId(url) {
    if (url.pathname === "/watch") {
      return url.searchParams.get("v");
    }

    if (url.pathname.startsWith("/shorts/")) {
      return url.pathname.split("/").filter(Boolean)[1] || null;
    }

    return null;
  }

  function getVideoTitle(container, anchor) {
    const titleElement = container.querySelector(
      "#video-title, yt-formatted-string#video-title, h3, .yt-lockup-metadata-view-model__title"
    );

    return cleanText(
      titleElement?.getAttribute("title") ||
        titleElement?.textContent ||
        anchor.getAttribute("title") ||
        anchor.getAttribute("aria-label") ||
        anchor.textContent ||
        "YouTube video"
    );
  }

  function getChannelName(container) {
    const channelElement = container.querySelector(
      "#channel-name a, ytd-channel-name a, .yt-lockup-metadata-view-model__metadata a"
    );

    return cleanText(channelElement?.textContent || "");
  }

  function getThumbnail(container, videoId) {
    const image = container.querySelector("img");
    const src =
      image?.currentSrc ||
      image?.src ||
      image?.getAttribute("data-thumb") ||
      image?.getAttribute("data-src") ||
      "";

    if (src && !src.startsWith("data:")) {
      return src;
    }

    return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function addVideo(video) {
    const existingIndex = state.videos.findIndex((item) => item.id === video.id);
    const wasVisible = isPanelVisible();
    const wasExpanded = wasVisible && !state.collapsed;

    if (existingIndex !== -1) {
      state.enteringItemKey = state.videos[existingIndex].playlistItemId;

      if (state.panel) {
        renderPanel();

        if (wasExpanded) {
          scrollListToVideo(existingIndex);
        }
      }

      clearEnteringItemKey(state.enteringItemKey);
      return;
    }

    const item = {
      ...video,
      playlistItemId: createPlaylistItemId()
    };

    state.videos.push(item);
    state.enteringItemKey = item.playlistItemId;
    saveVideos();

    if (state.panel) {
      renderPanel();

      if (wasExpanded) {
        scrollListToBottom();
      }

      if (wasVisible) {
        animateCount();
      }
    }

    clearEnteringItemKey(item.playlistItemId);
  }

  function ensurePanel() {
    if (state.panel) {
      return;
    }

    const panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.setAttribute("aria-label", "Temporary YouTube playlist");
    panel.innerHTML = `
      <div class="yt-tp-header">
        <div class="yt-tp-heading">
          <span class="yt-tp-title">Temporary playlist</span>
          <span class="yt-tp-count">0</span>
        </div>
        <div class="yt-tp-limit-control" aria-label="Visible videos limit">
          <span class="yt-tp-limit-label">Видно</span>
          <span class="yt-tp-limit-value">3</span>
          <div class="yt-tp-limit-buttons">
            <button class="yt-tp-step-button yt-tp-step-up" type="button" data-action="limit-up" title="More videos" aria-label="More videos"></button>
            <button class="yt-tp-step-button yt-tp-step-down" type="button" data-action="limit-down" title="Fewer videos" aria-label="Fewer videos"></button>
          </div>
        </div>
        <div class="yt-tp-header-actions">
          <button class="yt-tp-icon-button" type="button" data-action="collapse" title="Collapse" aria-label="Collapse">-</button>
          <button class="yt-tp-icon-button yt-tp-close-button" type="button" data-action="close" title="Close" aria-label="Close"></button>
        </div>
      </div>
      <div class="yt-tp-list" role="list"></div>
    `;

    panel.addEventListener("click", handlePanelClick);
    panel
      .querySelector(".yt-tp-header")
      .addEventListener("pointerdown", handlePanelDragStart);
    document.documentElement.appendChild(panel);
    state.panel = panel;
    applyPanelCorner();
  }

  function handlePanelClick(event) {
    event.stopPropagation();

    const target = event.target instanceof Element ? event.target : null;
    if (!target) {
      return;
    }

    const actionTarget = target.closest("[data-action]");
    const action = actionTarget?.getAttribute("data-action");

    if (action === "close") {
      hidePanel();
      return;
    }

    if (action === "collapse") {
      setCollapsed(!state.collapsed);
      return;
    }

    if (action === "remove") {
      const index = Number(actionTarget.getAttribute("data-index"));
      removeVideo(index);
      return;
    }

    if (action === "limit-up") {
      changeVisibleRows(1);
      return;
    }

    if (action === "limit-down") {
      changeVisibleRows(-1);
      return;
    }

    const item = target.closest("[data-video-index]");
    if (item) {
      openVideo(Number(item.getAttribute("data-video-index")));
    }
  }

  function handlePanelDragStart(event) {
    if (
      event.button !== 0 ||
      isFullscreenActive() ||
      event.target.closest("button, [data-action], .yt-tp-limit-control")
    ) {
      return;
    }

    const rect = state.panel.getBoundingClientRect();
    state.drag = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height
    };

    cancelPanelAnimation();
    state.panel.classList.add("yt-tp-dragging");
    state.panel.style.width = `${rect.width}px`;
    state.panel.style.left = `${rect.left}px`;
    state.panel.style.top = `${rect.top}px`;
    state.panel.style.right = "auto";
    state.panel.style.bottom = "auto";

    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.addEventListener("pointermove", handlePanelDragMove);
    event.currentTarget.addEventListener("pointerup", handlePanelDragEnd, {
      once: true
    });
    event.currentTarget.addEventListener("pointercancel", handlePanelDragEnd, {
      once: true
    });
    event.preventDefault();
  }

  function handlePanelDragMove(event) {
    if (!state.drag || event.pointerId !== state.drag.pointerId) {
      return;
    }

    const offset = getPanelOffset();
    const maxLeft = Math.max(offset, window.innerWidth - state.drag.width - offset);
    const maxTop = Math.max(offset, window.innerHeight - state.drag.height - offset);
    const nextLeft = clamp(event.clientX - state.drag.offsetX, offset, maxLeft);
    const nextTop = clamp(event.clientY - state.drag.offsetY, offset, maxTop);

    state.panel.style.left = `${nextLeft}px`;
    state.panel.style.top = `${nextTop}px`;
    event.preventDefault();
  }

  function handlePanelDragEnd(event) {
    const header = event.currentTarget;

    header.removeEventListener("pointermove", handlePanelDragMove);
    header.removeEventListener("pointerup", handlePanelDragEnd);
    header.removeEventListener("pointercancel", handlePanelDragEnd);

    if (!state.drag || event.pointerId !== state.drag.pointerId) {
      return;
    }

    const rect = state.panel.getBoundingClientRect();
    state.corner = getNearestCorner(rect);
    state.drag = null;
    saveSettings();
    snapPanelToCorner(rect);

    try {
      header.releasePointerCapture(event.pointerId);
    } catch (_error) {
      return;
    }
  }

  function clearPlaylist() {
    state.videos = [];
    saveVideos();
    renderPanel();
  }

  async function removeVideo(index) {
    if (index < 0 || index >= state.videos.length) {
      return;
    }

    const video = state.videos[index];
    const item = getVideoItem(index);

    if (item && canAnimateElement(item) && !state.collapsed) {
      await animateItemRemoval(item);
    }

    const currentIndex = state.videos.findIndex(
      (entry) => entry.playlistItemId === video.playlistItemId
    );

    if (currentIndex === -1) {
      return;
    }

    state.videos.splice(currentIndex, 1);
    saveVideos();
    renderPanel();
    animateCount();
  }

  async function openVideo(index) {
    if (index < 0 || index >= state.videos.length) {
      return;
    }

    const video = state.videos[index];
    const item = getVideoItem(index);

    if (item && canAnimateElement(item)) {
      await animateItemActivation(item);
    }

    await setCollapsed(true);
    state.panel.classList.remove("yt-tp-hidden");
    window.location.assign(video.url);
  }

  function renderPanel() {
    if (!state.panel) {
      return;
    }

    const panel = state.panel;
    const count = panel.querySelector(".yt-tp-count");
    const list = panel.querySelector(".yt-tp-list");
    const collapseButton = panel.querySelector('[data-action="collapse"]');
    const limitValue = panel.querySelector(".yt-tp-limit-value");
    const limitUp = panel.querySelector('[data-action="limit-up"]');
    const limitDown = panel.querySelector('[data-action="limit-down"]');

    panel.classList.toggle("yt-tp-collapsed", state.collapsed);
    panel.style.setProperty("--yt-tp-visible-rows", String(state.visibleRows));
    count.textContent = String(state.videos.length);
    limitValue.textContent = String(state.visibleRows);
    limitUp.disabled = state.visibleRows >= MAX_VISIBLE_ROWS;
    limitDown.disabled = state.visibleRows <= MIN_VISIBLE_ROWS;
    collapseButton.textContent = state.collapsed ? "+" : "-";
    collapseButton.setAttribute(
      "aria-label",
      state.collapsed ? "Expand" : "Collapse"
    );

    if (state.videos.length === 0) {
      list.replaceChildren(createEmptyItem());
      return;
    }

    list.replaceChildren(...state.videos.map(createVideoItem));
  }

  function createVideoItem(video, index) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "yt-tp-item";
    item.setAttribute("data-video-index", String(index));
    item.setAttribute("data-video-key", video.playlistItemId);
    item.setAttribute("role", "listitem");

    if (video.playlistItemId === state.enteringItemKey) {
      item.classList.add("yt-tp-item-entering");
    }

    const thumbnail = document.createElement("img");
    thumbnail.className = "yt-tp-thumb";
    thumbnail.src = video.thumbnail;
    thumbnail.alt = "";
    thumbnail.loading = "lazy";

    const meta = document.createElement("span");
    meta.className = "yt-tp-meta";

    const title = document.createElement("span");
    title.className = "yt-tp-item-title";
    title.textContent = video.title;

    const channel = document.createElement("span");
    channel.className = "yt-tp-channel";
    channel.textContent = video.channel || "YouTube";

    const remove = document.createElement("span");
    remove.className = "yt-tp-remove";
    remove.setAttribute("data-action", "remove");
    remove.setAttribute("data-index", String(index));
    remove.setAttribute("title", "Remove");
    remove.setAttribute("aria-label", "Remove");
    remove.setAttribute("aria-hidden", "true");

    meta.append(title, channel);
    item.append(thumbnail, meta, remove);
    return item;
  }

  function createEmptyItem() {
    const empty = document.createElement("div");
    empty.className = "yt-tp-empty";
    empty.setAttribute("role", "listitem");
    empty.textContent = "Playlist is empty";
    return empty;
  }

  function showPanel() {
    ensurePanel();

    if (isFullscreenActive()) {
      state.collapsed = false;
      state.hiddenForFullscreen = true;
      renderPanel();
      state.panel.classList.add("yt-tp-hidden");
      return;
    }

    state.transitionToken += 1;
    const wasHidden = state.panel.classList.contains("yt-tp-hidden");
    state.panel.classList.remove("yt-tp-hidden");

    if (wasHidden) {
      state.collapsed = true;
      renderPanel();
      animatePanelAppear();

      requestAnimationFrame(() => {
        setCollapsed(false);
        flashPanel();
      });
      return;
    }

    setCollapsed(false);
    flashPanel();
  }

  function animatePanelAppear() {
    if (!canAnimateElement(state.panel)) {
      return;
    }

    state.panel.animate(
      [
        {
          opacity: 0,
          transform: "translateY(8px) scale(0.96)"
        },
        {
          opacity: 1,
          transform: "translateY(0) scale(1)"
        }
      ],
      {
        duration: 160,
        easing: "cubic-bezier(0.2, 0, 0, 1)"
      }
    );
  }

  function flashPanel() {
    state.panel.classList.remove("yt-tp-flash");
    requestAnimationFrame(() => {
      state.panel.classList.add("yt-tp-flash");
    });
  }

  function scrollListToBottom() {
    const list = state.panel?.querySelector(".yt-tp-list");
    if (!list) {
      return;
    }

    requestAnimationFrame(() => {
      list.scrollTop = list.scrollHeight;
    });
  }

  function scrollListToVideo(index) {
    const item = getVideoItem(index);

    if (!item) {
      return;
    }

    requestAnimationFrame(() => {
      item.scrollIntoView({
        block: "nearest",
        inline: "nearest",
        behavior: "smooth"
      });
    });
  }

  function listenForExtensionIcon() {
    if (
      typeof chrome === "undefined" ||
      !chrome.runtime ||
      !chrome.runtime.onMessage
    ) {
      return;
    }

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== "YT_TP_TOGGLE_PANEL") {
        return false;
      }

      togglePanel();
      scrollListToBottom();
      sendResponse({ ok: true });
      return true;
    });
  }

  function loadVideos() {
    if (!hasStorage()) {
      return;
    }

    chrome.storage.local.get(
      {
        [STORAGE_KEY]: [],
        [SETTINGS_KEY]: {
          visibleRows: DEFAULT_VISIBLE_ROWS,
          corner: DEFAULT_CORNER
        }
      },
      (result) => {
        const videos = Array.isArray(result[STORAGE_KEY])
          ? result[STORAGE_KEY].filter(isStoredVideo).map(ensurePlaylistItemId)
          : [];
        const settings = result[SETTINGS_KEY] || {};

        if (state.videos.length === 0) {
          state.videos = videos;
        }

        state.visibleRows = normalizeVisibleRows(settings.visibleRows);
        state.corner = normalizeCorner(settings.corner);

        if (state.panel) {
          applyPanelCorner();
          renderPanel();
        }

        showCollapsedPanel();
      }
    );
  }

  function saveVideos() {
    if (!hasStorage()) {
      return;
    }

    chrome.storage.local.set({ [STORAGE_KEY]: state.videos });
  }

  function hasStorage() {
    return (
      typeof chrome !== "undefined" &&
      chrome.storage &&
      chrome.storage.local
    );
  }

  function isStoredVideo(video) {
    return (
      video &&
      typeof video.id === "string" &&
      typeof video.title === "string" &&
      typeof video.url === "string"
    );
  }

  function changeVisibleRows(delta) {
    const nextRows = normalizeVisibleRows(state.visibleRows + delta);

    if (nextRows === state.visibleRows) {
      return;
    }

    state.visibleRows = nextRows;
    saveSettings();

    if (
      state.panel &&
      !state.collapsed &&
      !state.panel.classList.contains("yt-tp-hidden")
    ) {
      animatePanelResize(() => renderPanel());
      return;
    }

    renderPanel();
  }

  function saveSettings() {
    if (!hasStorage()) {
      return;
    }

    chrome.storage.local.set({
      [SETTINGS_KEY]: {
        visibleRows: state.visibleRows,
        corner: state.corner
      }
    });
  }

  function normalizeVisibleRows(value) {
    const rows = Number(value);

    if (!Number.isFinite(rows)) {
      return DEFAULT_VISIBLE_ROWS;
    }

    return Math.min(
      MAX_VISIBLE_ROWS,
      Math.max(MIN_VISIBLE_ROWS, Math.round(rows))
    );
  }

  function applyPanelCorner() {
    if (!state.panel) {
      return;
    }

    state.corner = normalizeCorner(state.corner);
    state.panel.dataset.corner = state.corner;
    state.panel.style.left = "";
    state.panel.style.top = "";
    state.panel.style.right = "";
    state.panel.style.bottom = "";
    state.panel.style.width = "";
  }

  function snapPanelToCorner(startRect) {
    applyPanelCorner();
    state.panel.classList.remove("yt-tp-dragging");

    if (!canAnimateElement(state.panel)) {
      return;
    }

    const endRect = state.panel.getBoundingClientRect();
    const translateX = startRect.left - endRect.left;
    const translateY = startRect.top - endRect.top;

    if (Math.abs(translateX) < 1 && Math.abs(translateY) < 1) {
      return;
    }

    state.panel.animate(
      [
        {
          transform: `translate(${translateX}px, ${translateY}px)`
        },
        {
          transform: "translate(0, 0)"
        }
      ],
      {
        duration: 180,
        easing: "cubic-bezier(0.2, 0, 0, 1)"
      }
    );
  }

  function getNearestCorner(rect) {
    const horizontal =
      rect.left + rect.width / 2 < window.innerWidth / 2 ? "left" : "right";
    const vertical =
      rect.top + rect.height / 2 < window.innerHeight / 2 ? "top" : "bottom";

    return `${vertical}-${horizontal}`;
  }

  function getPanelOffset() {
    return window.matchMedia("(max-width: 520px)").matches ? 12 : 24;
  }

  function normalizeCorner(corner) {
    return PANEL_CORNERS.has(corner) ? corner : DEFAULT_CORNER;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function showCollapsedPanel() {
    ensurePanel();
    state.collapsed = true;
    renderPanel();

    if (isFullscreenActive()) {
      state.hiddenForFullscreen = true;
      state.panel.classList.add("yt-tp-hidden");
      return;
    }

    state.panel.classList.remove("yt-tp-hidden");
  }

  function togglePanel() {
    ensurePanel();

    if (isFullscreenActive()) {
      state.hiddenForFullscreen = true;
      state.panel.classList.add("yt-tp-hidden");
      return;
    }

    if (state.panel.classList.contains("yt-tp-hidden")) {
      showPanel();
      return;
    }

    hidePanel();
  }

  function setCollapsed(collapsed, animate = true) {
    ensurePanel();

    if (state.collapsed === collapsed) {
      renderPanel();
      return Promise.resolve();
    }

    const update = () => {
      state.collapsed = collapsed;
      renderPanel();
      animateCollapseButton();
    };

    if (!animate || state.panel.classList.contains("yt-tp-hidden")) {
      update();
      return Promise.resolve();
    }

    return animatePanelResize(update);
  }

  function hidePanel() {
    ensurePanel();

    if (state.panel.classList.contains("yt-tp-hidden")) {
      return;
    }

    const token = state.transitionToken + 1;
    state.transitionToken = token;

    const finish = () => {
      if (state.transitionToken !== token) {
        return;
      }

      state.panel.classList.add("yt-tp-hidden");
    };

    if (state.collapsed) {
      animatePanelDisappear().then(finish);
      return;
    }

    animatePanelResize(() => {
      state.collapsed = true;
      renderPanel();
    }).then(() => {
      if (state.transitionToken !== token) {
        return;
      }

      animatePanelDisappear().then(finish);
    });
  }

  function animatePanelResize(update) {
    const panel = state.panel;

    if (!shouldAnimatePanel()) {
      update();
      return Promise.resolve();
    }

    const start = panel.getBoundingClientRect();
    update();
    const end = panel.getBoundingClientRect();

    if (
      Math.round(start.width) === Math.round(end.width) &&
      Math.round(start.height) === Math.round(end.height)
    ) {
      return Promise.resolve();
    }

    return startPanelAnimation([
      {
        width: `${start.width}px`,
        height: `${start.height}px`
      },
      {
        width: `${end.width}px`,
        height: `${end.height}px`
      }
    ]);
  }

  function animatePanelDisappear() {
    const panel = state.panel;

    if (!shouldAnimatePanel()) {
      return Promise.resolve();
    }

    const rect = panel.getBoundingClientRect();

    return startPanelAnimation(
      [
        {
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          opacity: 1,
          transform: "scale(1)"
        },
        {
          width: "0px",
          height: "0px",
          opacity: 0,
          transform: "scale(0.96)"
        }
      ],
      { duration: 120 }
    );
  }

  function startPanelAnimation(keyframes, options = {}) {
    const panel = state.panel;

    cancelPanelAnimation();

    panel.classList.add("yt-tp-animating");

    const animation = panel.animate(keyframes, {
      ...PANEL_ANIMATION,
      ...options
    });

    state.animation = animation;

    return animation.finished
      .catch(() => undefined)
      .then(() => {
        if (state.animation !== animation) {
          return;
        }

        state.animation = null;
        panel.classList.remove("yt-tp-animating");
      });
  }

  function shouldAnimatePanel() {
    return canAnimateElement(state.panel);
  }

  function isPanelVisible() {
    return Boolean(
      state.panel &&
      !state.panel.classList.contains("yt-tp-hidden") &&
      !isFullscreenActive()
    );
  }

  function getVideoItem(index) {
    return state.panel?.querySelector(`[data-video-index="${index}"]`) || null;
  }

  function animateItemRemoval(item) {
    item.classList.add("yt-tp-item-removing");
    item.style.overflow = "hidden";

    const rect = item.getBoundingClientRect();

    return item
      .animate(
        [
          {
            height: `${rect.height}px`,
            paddingTop: "6px",
            paddingBottom: "6px",
            opacity: 1,
            transform: "translateX(0)",
            filter: "brightness(1)"
          },
          {
            height: `${rect.height}px`,
            paddingTop: "6px",
            paddingBottom: "6px",
            opacity: 0,
            transform: "translateX(-28px)",
            filter: "brightness(0.75)",
            offset: 0.62
          },
          {
            height: "0px",
            paddingTop: "0px",
            paddingBottom: "0px",
            opacity: 0,
            transform: "translateX(-28px)",
            filter: "brightness(0.75)"
          }
        ],
        ITEM_ANIMATION
      )
      .finished.catch(() => undefined)
      .then(() => {
        item.style.height = "0px";
        item.style.paddingTop = "0px";
        item.style.paddingBottom = "0px";
        item.style.opacity = "0";
      });
  }

  function animateItemActivation(item) {
    item.classList.add("yt-tp-item-activating");

    if (!canAnimateElement(item)) {
      return wait(90);
    }

    return item
      .animate(
        [
          {
            backgroundColor: "rgba(234, 51, 62, 0.2)",
            transform: "translateX(0)"
          },
          {
            backgroundColor: "rgba(234, 51, 62, 0.28)",
            transform: "translateX(4px)"
          }
        ],
        {
          duration: 120,
          easing: "cubic-bezier(0.2, 0, 0, 1)"
        }
      )
      .finished.catch(() => undefined);
  }

  function animateCount() {
    const count = state.panel?.querySelector(".yt-tp-count");

    if (!count) {
      return;
    }

    count.classList.remove("yt-tp-count-pop");
    void count.offsetWidth;
    count.classList.add("yt-tp-count-pop");
  }

  function animateCollapseButton() {
    const button = state.panel?.querySelector('[data-action="collapse"]');

    if (!button) {
      return;
    }

    button.classList.remove("yt-tp-toggle-pop");
    void button.offsetWidth;
    button.classList.add("yt-tp-toggle-pop");
  }

  function clearEnteringItemKey(key) {
    window.setTimeout(() => {
      if (state.enteringItemKey === key) {
        state.enteringItemKey = null;
      }
    }, 360);
  }

  function ensurePlaylistItemId(video) {
    if (typeof video.playlistItemId === "string" && video.playlistItemId) {
      return video;
    }

    return {
      ...video,
      playlistItemId: createPlaylistItemId()
    };
  }

  function createPlaylistItemId() {
    const id = `${Date.now()}-${nextPlaylistItemId}`;
    nextPlaylistItemId += 1;
    return id;
  }

  function canAnimateElement(element) {
    return (
      Boolean(element) &&
      typeof element.animate === "function" &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  function wait(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  function cancelPanelAnimation() {
    if (!state.animation) {
      return;
    }

    state.animation.cancel();
    state.animation = null;
    state.panel?.classList.remove("yt-tp-animating");
  }

  function isFullscreenActive() {
    return Boolean(
      document.fullscreenElement || document.webkitFullscreenElement
    );
  }
})();
