import {
  bridgeRequestMessageSchema,
  type BridgeRequestMessage,
  type BridgeResponseMessage,
  tabSchema,
  tabInfoSchema,
  windowInfoSchema,
} from "@brave-mcp/protocol";

const DEFAULT_DAEMON_URL = "ws://127.0.0.1:39200/extension/connect";
const EXTENSION_VERSION = "0.10.0";
const RECONNECT_ALARM_NAME = "bridgeReconnect";
const RECONNECT_DELAY_MINUTES = 0.5;

type WaitUntil = "load" | "domcontentloaded" | "networkidle";
type SelectorType = "css" | "xpath" | "text";

type BridgeState = "disconnected" | "connecting" | "connected";

interface ExtensionSettings {
  daemonUrl: string;
  authToken: string;
}

interface BridgeStatus {
  state: BridgeState;
  daemonUrl: string;
  authConfigured: boolean;
  lastAttemptAt: string | null;
  lastConnectedAt: string | null;
  lastError: string | null;
}

interface HeaderEntry {
  name: string;
  value: string;
}

interface RequestInterceptRule {
  kind: "intercept";
  urlPattern: string;
  resourceTypes?: string[];
  action: "continue" | "fail";
  failReason: string;
  method?: string;
  headers?: HeaderEntry[];
  postDataBase64?: string;
}

interface MockResponseRule {
  kind: "mock";
  urlPattern: string;
  resourceTypes?: string[];
  statusCode: number;
  headers: HeaderEntry[];
  bodyBase64?: string;
}

interface NetworkThrottlePolicy {
  enabled: boolean;
  offline: boolean;
  latencyMs: number;
  downloadThroughput: number;
  uploadThroughput: number;
  connectionType?: string;
}

interface UserAgentOverridePolicy {
  enabled: boolean;
  userAgent: string;
  acceptLanguage?: string;
  platform?: string;
}

interface MediaFeature {
  name: string;
  value: string;
}

interface MediaOverridePolicy {
  enabled: boolean;
  media: string;
  features: MediaFeature[];
}

interface GeolocationOverridePolicy {
  enabled: boolean;
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude?: number;
  altitudeAccuracy?: number;
  heading?: number;
  speed?: number;
}

interface TabAutomationState {
  requestRules: RequestInterceptRule[];
  mockRules: MockResponseRule[];
  throttle: NetworkThrottlePolicy | null;
  userAgentOverride: UserAgentOverridePolicy | null;
  mediaOverride: MediaOverridePolicy | null;
  geolocationOverride: GeolocationOverridePolicy | null;
  debuggerAttached: boolean;
  fetchEnabled: boolean;
  networkEnabled: boolean;
}

let socket: WebSocket | null = null;
let bridgeState: BridgeState = "disconnected";
let lastAttemptAt: string | null = null;
let lastConnectedAt: string | null = null;
let lastError: string | null = null;
const tabAutomationState = new Map<number, TabAutomationState>();
const defaultBrowserIdentity = {
  userAgent: navigator.userAgent,
  acceptLanguage: navigator.language,
  platform: navigator.platform,
};

function isLiveSocket(candidate: WebSocket): boolean {
  return socket === candidate;
}

function safeSend(candidate: WebSocket, payload: unknown): void {
  if (!isLiveSocket(candidate) || candidate.readyState !== WebSocket.OPEN) {
    return;
  }

  candidate.send(JSON.stringify(payload));
}

function getStorage(): chrome.storage.StorageArea {
  return chrome.storage.local;
}

async function loadSettings(): Promise<ExtensionSettings> {
  const result = await getStorage().get(["daemonUrl", "authToken"]);
  return {
    daemonUrl:
      typeof result.daemonUrl === "string" && result.daemonUrl.length > 0
        ? result.daemonUrl
        : DEFAULT_DAEMON_URL,
    authToken: typeof result.authToken === "string" ? result.authToken : "",
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

async function clearReconnectAlarm(): Promise<void> {
  await chrome.alarms.clear(RECONNECT_ALARM_NAME);
}

async function ensureReconnectAlarm(): Promise<void> {
  const existing = await chrome.alarms.get(RECONNECT_ALARM_NAME);
  if (existing) {
    return;
  }

  await chrome.alarms.create(RECONNECT_ALARM_NAME, {
    delayInMinutes: RECONNECT_DELAY_MINUTES,
    periodInMinutes: RECONNECT_DELAY_MINUTES,
  });
}

async function persistBridgeStatus(
  settings?: ExtensionSettings,
): Promise<BridgeStatus> {
  const resolvedSettings = settings ?? (await loadSettings());
  const status: BridgeStatus = {
    state: bridgeState,
    daemonUrl: resolvedSettings.daemonUrl,
    authConfigured: resolvedSettings.authToken.length > 0,
    lastAttemptAt,
    lastConnectedAt,
    lastError,
  };

  await getStorage().set({
    bridgeStatus: status,
  });

  return status;
}

function withAuth(url: string, authToken: string): string {
  const resolved = new URL(url);
  resolved.searchParams.set("authToken", authToken);
  return resolved.toString();
}

function mapChromeTab(tab: chrome.tabs.Tab) {
  return tabSchema.parse({
    tabId: tab.id ?? -1,
    windowId: tab.windowId ?? -1,
    title: tab.title ?? "",
    url: tab.url ?? "",
    active: tab.active ?? false,
  });
}

function mapChromeTabInfo(tab: chrome.tabs.Tab) {
  return tabInfoSchema.parse({
    tabId: tab.id ?? -1,
    windowId: tab.windowId ?? -1,
    title: tab.title ?? "",
    url: tab.url ?? "",
    active: tab.active ?? false,
    status:
      tab.status === "loading" || tab.status === "complete"
        ? tab.status
        : undefined,
    favIconUrl: tab.favIconUrl,
    audible: tab.audible,
    discarded: tab.discarded,
    pinned: tab.pinned,
    incognito: tab.incognito,
  });
}

function mapChromeWindow(window: chrome.windows.Window) {
  const normalizedType = window.type === "popup" ? "popup" : "normal";
  return windowInfoSchema.parse({
    windowId: window.id ?? -1,
    focused: window.focused ?? false,
    incognito: window.incognito ?? false,
    type: normalizedType,
    top: window.top,
    left: window.left,
    width: window.width,
    height: window.height,
    tabIds: Array.isArray(window.tabs)
      ? window.tabs
          .map((tab) => tab.id ?? -1)
          .filter((tabId) => Number.isInteger(tabId) && tabId >= 0)
      : [],
  });
}

function getTabAutomationPolicy(tabId: number): TabAutomationState {
  let state = tabAutomationState.get(tabId);
  if (!state) {
    state = {
      requestRules: [],
      mockRules: [],
      throttle: null,
      userAgentOverride: null,
      mediaOverride: null,
      geolocationOverride: null,
      debuggerAttached: false,
      fetchEnabled: false,
      networkEnabled: false,
    };
    tabAutomationState.set(tabId, state);
  }
  return state;
}

function hasPersistentDebuggerWork(state: TabAutomationState): boolean {
  return (
    state.requestRules.length > 0 ||
    state.mockRules.length > 0 ||
    (state.throttle !== null && state.throttle.enabled) ||
    (state.userAgentOverride !== null && state.userAgentOverride.enabled) ||
    (state.mediaOverride !== null && state.mediaOverride.enabled) ||
    (state.geolocationOverride !== null && state.geolocationOverride.enabled)
  );
}

function normalizeHeaders(headers: unknown): HeaderEntry[] | undefined {
  if (!Array.isArray(headers)) {
    return undefined;
  }

  const normalized = headers
    .filter(
      (entry): entry is { name: string; value: string } =>
        typeof entry === "object" &&
        entry !== null &&
        "name" in entry &&
        "value" in entry &&
        typeof entry.name === "string" &&
        typeof entry.value === "string",
    )
    .map((entry) => ({
      name: entry.name,
      value: entry.value,
    }));

  return normalized.length > 0 ? normalized : undefined;
}

function matchesWildcardPattern(value: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(value);
}

function matchesResourceType(resourceTypes: string[] | undefined, resourceType: unknown): boolean {
  if (!resourceTypes || resourceTypes.length === 0) {
    return true;
  }

  return typeof resourceType === "string" && resourceTypes.includes(resourceType);
}

function originToContentSettingPattern(rawUrl: string): string {
  const url = new URL(rawUrl);
  return `${url.protocol}//${url.host}/*`;
}

async function listTabs() {
  const tabs = await chrome.tabs.query({});
  return {
    tabs: tabs.map((tab) => mapChromeTab(tab)),
  };
}

async function listWindows(populateTabs: boolean, windowTypes: Array<"normal" | "popup">) {
  const windows = await chrome.windows.getAll({
    populate: populateTabs,
    windowTypes,
  });
  return {
    windows: windows.map((window) => mapChromeWindow(window)),
  };
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  const tab = tabs[0];
  return {
    tab: mapChromeTab(
      tab ??
        ({
          id: -1,
          windowId: -1,
          title: "",
          url: "",
          active: false,
        } satisfies chrome.tabs.Tab),
    ),
  };
}

async function getTabInfo(tabId: number) {
  const tab = await chrome.tabs.get(tabId);
  return {
    tab: mapChromeTabInfo(tab),
  };
}

async function getWindowInfo(windowId: number, populateTabs: boolean) {
  const window = await chrome.windows.get(windowId, {
    populate: populateTabs,
  });
  return {
    window: mapChromeWindow(window),
  };
}

async function openTab(url: string, active: boolean) {
  const tab = await chrome.tabs.create({
    url,
    active,
  });

  return {
    tabId: tab.id ?? -1,
  };
}

async function newWindow(options: {
  url?: string;
  focused: boolean;
  incognito: boolean;
  type: "normal" | "popup";
  top?: number;
  left?: number;
  width?: number;
  height?: number;
}) {
  const createdWindow = await chrome.windows.create({
    url: options.url,
    focused: options.focused,
    incognito: options.incognito,
    type: options.type,
    top: options.top,
    left: options.left,
    width: options.width,
    height: options.height,
  });

  return {
    window: mapChromeWindow(createdWindow),
    tab: createdWindow.tabs?.[0] ? mapChromeTab(createdWindow.tabs[0]) : undefined,
  };
}

async function waitForTabNavigation(
  tabId: number,
  waitUntil: WaitUntil,
  timeoutMs: number,
): Promise<"ok" | "timeout"> {
  return new Promise((resolve) => {
    let settled = false;
    const timeoutId = self.setTimeout(() => {
      cleanup();
      resolve("timeout");
    }, timeoutMs);

    const completeForTab = (
      updatedTabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
    ) => {
      if (settled || updatedTabId !== tabId) {
        return;
      }

      if (waitUntil === "load" || waitUntil === "networkidle") {
        if (changeInfo.status === "complete") {
          cleanup();
          resolve("ok");
        }
      }
    };

    const domContentLoadedForTab = (details: chrome.webNavigation.WebNavigationFramedCallbackDetails) => {
      if (settled || details.tabId !== tabId || details.frameId !== 0) {
        return;
      }

      if (waitUntil === "domcontentloaded") {
        cleanup();
        resolve("ok");
      }
    };

    const cleanup = () => {
      if (settled) {
        return;
      }

      settled = true;
      self.clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(completeForTab);
      chrome.webNavigation.onDOMContentLoaded.removeListener(domContentLoadedForTab);
    };

    chrome.tabs.onUpdated.addListener(completeForTab);
    chrome.webNavigation.onDOMContentLoaded.addListener(domContentLoadedForTab);
  });
}

async function waitForNavigation(
  tabId: number,
  waitUntil: WaitUntil,
  timeoutMs: number,
  urlIncludes?: string,
) {
  const initialUrl = await getTabUrl(tabId);
  const status = await new Promise<"ok" | "timeout">((resolve) => {
    let settled = false;
    const timeoutId = self.setTimeout(() => {
      cleanup();
      resolve("timeout");
    }, timeoutMs);

    function matchesUrl(candidate: string | undefined): boolean {
      if (!candidate) {
        return false;
      }

      if (candidate === initialUrl) {
        return false;
      }

      return urlIncludes ? candidate.includes(urlIncludes) : true;
    }

    const completeForTab = (
      updatedTabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
      tab: chrome.tabs.Tab,
    ) => {
      if (settled || updatedTabId !== tabId) {
        return;
      }

      const candidateUrl =
        typeof changeInfo.url === "string" ? changeInfo.url : tab.url;
      if (!matchesUrl(candidateUrl)) {
        return;
      }

      if (waitUntil === "load" || waitUntil === "networkidle") {
        if (changeInfo.status === "complete") {
          cleanup();
          resolve("ok");
        }
      }
    };

    const domContentLoadedForTab = async (
      details: chrome.webNavigation.WebNavigationFramedCallbackDetails,
    ) => {
      if (settled || details.tabId !== tabId || details.frameId !== 0) {
        return;
      }

      if (waitUntil !== "domcontentloaded") {
        return;
      }

      const currentUrl = await getTabUrl(tabId);
      if (!matchesUrl(currentUrl)) {
        return;
      }

      cleanup();
      resolve("ok");
    };

    const cleanup = () => {
      if (settled) {
        return;
      }

      settled = true;
      self.clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(completeForTab);
      chrome.webNavigation.onDOMContentLoaded.removeListener(domContentLoadedForTab);
    };

    chrome.tabs.onUpdated.addListener(completeForTab);
    chrome.webNavigation.onDOMContentLoaded.addListener(domContentLoadedForTab);
  });

  return {
    url: await getTabUrl(tabId),
    status,
  };
}

async function navigateTab(
  tabId: number,
  url: string,
  waitUntil: WaitUntil,
  timeoutMs: number,
) {
  const waiter = waitForTabNavigation(tabId, waitUntil, timeoutMs);
  await chrome.tabs.update(tabId, { url });
  const status = await waiter;

  return {
    url,
    status,
  };
}

function resolveWaitUntil(value: unknown): WaitUntil {
  return value === "domcontentloaded" || value === "networkidle" ? value : "load";
}

function resolveTimeoutMs(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function resolveSelectorType(value: unknown): SelectorType {
  return value === "xpath" || value === "text" ? value : "css";
}

async function closeTab(tabId: number) {
  await chrome.tabs.remove(tabId);

  return {
    closed: true,
  };
}

async function closeWindow(windowId: number) {
  await chrome.windows.remove(windowId);

  return {
    closed: true,
  };
}

async function attachDebugger(tabId: number): Promise<void> {
  const state = getTabAutomationPolicy(tabId);
  if (state.debuggerAttached) {
    return;
  }

  const debuggee: chrome.debugger.Debuggee = { tabId };
  try {
    await chrome.debugger.attach(debuggee, "1.3");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("Another debugger is already attached")) {
      throw error;
    }
  }
  state.debuggerAttached = true;
}

async function detachDebuggerIfIdle(tabId: number): Promise<void> {
  const state = tabAutomationState.get(tabId);
  if (!state || !state.debuggerAttached || hasPersistentDebuggerWork(state)) {
    return;
  }

  const debuggee: chrome.debugger.Debuggee = { tabId };
  try {
    if (state.fetchEnabled) {
      await chrome.debugger.sendCommand(debuggee, "Fetch.disable");
      state.fetchEnabled = false;
    }
    if (state.networkEnabled) {
      await chrome.debugger.sendCommand(debuggee, "Network.disable");
      state.networkEnabled = false;
    }
  } catch {
    // Best effort cleanup.
  }

  try {
    await chrome.debugger.detach(debuggee);
  } catch {
    // Ignore detach errors; the session may already be gone.
  }
  state.debuggerAttached = false;

  if (!hasPersistentDebuggerWork(state)) {
    tabAutomationState.delete(tabId);
  }
}

async function applyPersistentDebuggerPolicies(tabId: number): Promise<void> {
  const state = getTabAutomationPolicy(tabId);
  if (!hasPersistentDebuggerWork(state) && !state.debuggerAttached) {
    await detachDebuggerIfIdle(tabId);
    return;
  }

  await attachDebugger(tabId);
  const debuggee: chrome.debugger.Debuggee = { tabId };
  const sendCommand = <R = unknown>(method: string, params?: object) =>
    chrome.debugger.sendCommand(debuggee, method, params) as Promise<R>;

  const fetchPatterns = [
    ...state.requestRules.flatMap((rule) =>
      (rule.resourceTypes ?? [undefined]).map((resourceType) => ({
        urlPattern: rule.urlPattern,
        requestStage: "Request" as const,
        ...(resourceType ? { resourceType } : {}),
      })),
    ),
    ...state.mockRules.flatMap((rule) =>
      (rule.resourceTypes ?? [undefined]).map((resourceType) => ({
        urlPattern: rule.urlPattern,
        requestStage: "Request" as const,
        ...(resourceType ? { resourceType } : {}),
      })),
    ),
  ];

  if (fetchPatterns.length > 0) {
    await sendCommand("Fetch.enable", { patterns: fetchPatterns });
    state.fetchEnabled = true;
  } else if (state.fetchEnabled) {
    await sendCommand("Fetch.disable");
    state.fetchEnabled = false;
  }

  const shouldEnableNetwork =
    (state.throttle !== null && state.throttle.enabled) ||
    (state.userAgentOverride !== null && state.userAgentOverride.enabled);

  if (shouldEnableNetwork) {
    await sendCommand("Network.enable");
    state.networkEnabled = true;
    await sendCommand("Network.setUserAgentOverride", {
      userAgent: state.userAgentOverride?.userAgent ?? defaultBrowserIdentity.userAgent,
      acceptLanguage:
        state.userAgentOverride?.acceptLanguage ?? defaultBrowserIdentity.acceptLanguage,
      platform: state.userAgentOverride?.platform ?? defaultBrowserIdentity.platform,
    });
    if (state.throttle && state.throttle.enabled) {
      await sendCommand("Network.emulateNetworkConditions", {
        offline: state.throttle.offline,
        latency: state.throttle.latencyMs,
        downloadThroughput: state.throttle.downloadThroughput,
        uploadThroughput: state.throttle.uploadThroughput,
        ...(state.throttle.connectionType
          ? { connectionType: state.throttle.connectionType }
          : {}),
      });
    } else {
      await sendCommand("Network.emulateNetworkConditions", {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      });
    }
  } else if (state.networkEnabled) {
    await sendCommand("Network.setUserAgentOverride", {
      userAgent: defaultBrowserIdentity.userAgent,
      acceptLanguage: defaultBrowserIdentity.acceptLanguage,
      platform: defaultBrowserIdentity.platform,
    });
    await sendCommand("Network.disable");
    state.networkEnabled = false;
  }

  if (state.mediaOverride && state.mediaOverride.enabled) {
    await sendCommand("Emulation.setEmulatedMedia", {
      media: state.mediaOverride.media,
      features: state.mediaOverride.features,
    });
  } else {
    await sendCommand("Emulation.setEmulatedMedia", {
      media: "",
      features: [],
    });
  }

  if (state.geolocationOverride && state.geolocationOverride.enabled) {
    await sendCommand("Emulation.setGeolocationOverride", {
      latitude: state.geolocationOverride.latitude,
      longitude: state.geolocationOverride.longitude,
      accuracy: state.geolocationOverride.accuracy,
      ...(typeof state.geolocationOverride.altitude === "number"
        ? { altitude: state.geolocationOverride.altitude }
        : {}),
      ...(typeof state.geolocationOverride.altitudeAccuracy === "number"
        ? { altitudeAccuracy: state.geolocationOverride.altitudeAccuracy }
        : {}),
      ...(typeof state.geolocationOverride.heading === "number"
        ? { heading: state.geolocationOverride.heading }
        : {}),
      ...(typeof state.geolocationOverride.speed === "number"
        ? { speed: state.geolocationOverride.speed }
        : {}),
    });
  } else {
    await sendCommand("Emulation.clearGeolocationOverride");
  }

  if (!hasPersistentDebuggerWork(state)) {
    await detachDebuggerIfIdle(tabId);
  }
}

async function withDebuggerSession<T>(
  tabId: number,
  action: (
    debuggee: chrome.debugger.Debuggee,
    sendCommand: <R = unknown>(method: string, params?: object) => Promise<R>,
  ) => Promise<T>,
): Promise<T> {
  const state = getTabAutomationPolicy(tabId);
  const attachedBefore = state.debuggerAttached;
  await attachDebugger(tabId);

  const debuggee: chrome.debugger.Debuggee = { tabId };
  const sendCommand = <R = unknown>(method: string, params?: object) =>
    chrome.debugger.sendCommand(debuggee, method, params) as Promise<R>;

  try {
    return await action(debuggee, sendCommand);
  } finally {
    if (!attachedBefore) {
      await detachDebuggerIfIdle(tabId);
    }
  }
}

async function handlePausedRequest(
  source: chrome.debugger.Debuggee,
  params: Record<string, unknown>,
): Promise<void> {
  const tabId = source.tabId;
  if (typeof tabId !== "number") {
    return;
  }

  const state = tabAutomationState.get(tabId);
  if (!state) {
    await chrome.debugger.sendCommand(source, "Fetch.continueRequest", {
      requestId: params.requestId,
    });
    return;
  }

  const url = String((params.request as { url?: unknown } | undefined)?.url ?? "");
  const resourceType = params.resourceType;
  const requestId = String(params.requestId ?? "");

  const mockRule = state.mockRules.find(
    (rule) =>
      matchesWildcardPattern(url, rule.urlPattern) &&
      matchesResourceType(rule.resourceTypes, resourceType),
  );
  if (mockRule) {
    const bodyBase64 =
      typeof mockRule.bodyBase64 === "string"
        ? mockRule.bodyBase64
        : btoa(unescape(encodeURIComponent("")));
    await chrome.debugger.sendCommand(source, "Fetch.fulfillRequest", {
      requestId,
      responseCode: mockRule.statusCode,
      responseHeaders: mockRule.headers.map((header) => ({
        name: header.name,
        value: header.value,
      })),
      body: bodyBase64,
    });
    return;
  }

  const interceptRule = state.requestRules.find(
    (rule) =>
      matchesWildcardPattern(url, rule.urlPattern) &&
      matchesResourceType(rule.resourceTypes, resourceType),
  );
  if (interceptRule?.action === "fail") {
    await chrome.debugger.sendCommand(source, "Fetch.failRequest", {
      requestId,
      errorReason: interceptRule.failReason,
    });
    return;
  }

  await chrome.debugger.sendCommand(source, "Fetch.continueRequest", {
    requestId,
    ...(interceptRule?.method ? { method: interceptRule.method } : {}),
    ...(interceptRule?.headers
      ? {
          headers: interceptRule.headers.map((header) => ({
            name: header.name,
            value: header.value,
          })),
        }
      : {}),
    ...(interceptRule?.postDataBase64 ? { postData: interceptRule.postDataBase64 } : {}),
  });
}

async function reloadTab(
  tabId: number,
  bypassCache: boolean,
  waitUntil: WaitUntil,
  timeoutMs: number,
) {
  const waiter = waitForTabNavigation(tabId, waitUntil, timeoutMs);
  await chrome.tabs.reload(tabId, { bypassCache });
  const status = await waiter;

  return {
    status,
  };
}

async function getTabUrl(tabId: number): Promise<string> {
  const tab = await chrome.tabs.get(tabId);
  return tab.url ?? "";
}

async function switchToTab(options: {
  tabId?: number;
  urlIncludes?: string;
  titleIncludes?: string;
  windowId?: number;
}) {
  let tab: chrome.tabs.Tab | undefined;

  if (typeof options.tabId === "number") {
    tab = await chrome.tabs.get(options.tabId);
  } else {
    const tabs = await chrome.tabs.query(
      typeof options.windowId === "number" ? { windowId: options.windowId } : {},
    );
    tab = tabs.find((candidate) => {
      const urlMatches =
        typeof options.urlIncludes === "string"
          ? (candidate.url ?? "").includes(options.urlIncludes)
          : true;
      const titleMatches =
        typeof options.titleIncludes === "string"
          ? (candidate.title ?? "").includes(options.titleIncludes)
          : true;
      return urlMatches && titleMatches;
    });
  }

  if (!tab?.id) {
    throw new Error("No tab matched the switch_to_tab criteria.");
  }

  const updatedTab = await chrome.tabs.update(tab.id, { active: true });
  if (typeof updatedTab.windowId === "number") {
    await chrome.windows.update(updatedTab.windowId, { focused: true });
  }

  return {
    tab: mapChromeTab(updatedTab),
  };
}

async function focusTab(tabId: number) {
  return switchToTab({ tabId });
}

async function setViewport(
  tabId: number,
  options: {
    width: number;
    height: number;
    left?: number;
    top?: number;
    focused: boolean;
    timeoutMs: number;
  },
) {
  const tab = await chrome.tabs.get(tabId);
  if (typeof tab.windowId !== "number") {
    throw new Error(`No window for tab id: ${String(tabId)}`);
  }

  await chrome.windows.update(tab.windowId, {
    width: options.width,
    height: options.height,
    left: options.left,
    top: options.top,
    focused: options.focused,
  });

  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() <= deadline) {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      }),
    });

    if (
      typeof result?.result === "object" &&
      result.result !== null &&
      "viewportWidth" in result.result &&
      "viewportHeight" in result.result &&
      typeof result.result.viewportWidth === "number" &&
      typeof result.result.viewportHeight === "number"
    ) {
      return {
        windowId: tab.windowId,
        viewportWidth: result.result.viewportWidth,
        viewportHeight: result.result.viewportHeight,
      };
    }

    await new Promise((resolve) => self.setTimeout(resolve, 100));
  }

  throw new Error("Timed out while waiting for the viewport resize to settle.");
}

async function runTabHistoryMutation(
  direction: "back" | "forward",
  tabId: number,
): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (nextDirection) => {
      if (nextDirection === "back") {
        history.back();
        return;
      }

      history.forward();
    },
    args: [direction],
  });
}

async function goBackOrForward(
  direction: "back" | "forward",
  tabId: number,
  waitUntil: WaitUntil,
  timeoutMs: number,
) {
  const waiter = waitForTabNavigation(tabId, waitUntil, timeoutMs);
  await runTabHistoryMutation(direction, tabId);
  const status = await waiter;

  return {
    url: await getTabUrl(tabId),
    status,
  };
}

async function runSelectorTask(
  tabId: number,
  payload: {
    action: "click" | "hover" | "type" | "select" | "queryElements";
    selector: string;
    selectorType: SelectorType;
    timeoutMs: number;
    text?: string;
    clearFirst?: boolean;
    value?: string;
    label?: string;
    index?: number;
    limit?: number;
  },
): Promise<Record<string, unknown>> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (args) => {
      const {
        action,
        selector,
        selectorType,
        timeoutMs,
        text,
        clearFirst,
        value,
        label,
        index,
        limit,
      } = args;
      const deadline = Date.now() + timeoutMs;

      function isVisible(element: Element): boolean {
        if (!(element instanceof HTMLElement)) {
          return true;
        }

        return Boolean(
          element.offsetWidth ||
            element.offsetHeight ||
            element.getClientRects().length,
        );
      }

      function serializeElement(element: Element) {
        const htmlElement = element instanceof HTMLElement ? element : null;
        const fieldValue =
          htmlElement instanceof HTMLInputElement ||
          htmlElement instanceof HTMLTextAreaElement ||
          htmlElement instanceof HTMLSelectElement
            ? htmlElement.value
            : undefined;
        const value = fieldValue && fieldValue.length > 0 ? fieldValue : undefined;

        return {
          tagName: element.tagName.toLowerCase(),
          text: element.textContent?.trim().slice(0, 200) || undefined,
          value,
          href: element instanceof HTMLAnchorElement ? element.href : undefined,
          visible: isVisible(element),
        };
      }

      function resolveElements(): Element[] {
        if (selectorType === "xpath") {
          const xpathResult = document.evaluate(
            selector,
            document,
            null,
            XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
            null,
          );
          const elements: Element[] = [];
          for (let index = 0; index < xpathResult.snapshotLength; index += 1) {
            const candidate = xpathResult.snapshotItem(index);
            if (candidate instanceof Element) {
              elements.push(candidate);
            }
          }
          return elements;
        }

        if (selectorType === "text") {
          return Array.from(document.querySelectorAll("body *")).filter((candidate) =>
            candidate.textContent?.includes(selector),
          );
        }

        return Array.from(document.querySelectorAll(selector));
      }

      while (Date.now() <= deadline) {
        const elements = resolveElements();
        const element = elements[0] ?? null;

        if (action === "queryElements" && elements.length > 0) {
          return {
            count: elements.length,
            elements: elements.slice(0, limit ?? 25).map(serializeElement),
          };
        }

        if (element) {
          if ("scrollIntoView" in element) {
            element.scrollIntoView({ block: "center", inline: "center" });
          }

          if (action === "click") {
            if (element instanceof HTMLElement) {
              element.click();
            } else {
              element.dispatchEvent(
                new MouseEvent("click", {
                  bubbles: true,
                  cancelable: true,
                  view: window,
                }),
              );
            }

            return { clicked: true };
          }

          if (action === "hover") {
            element.dispatchEvent(
              new MouseEvent("mouseover", {
                bubbles: true,
                cancelable: true,
                view: window,
              }),
            );
            element.dispatchEvent(
              new MouseEvent("mouseenter", {
                bubbles: true,
                cancelable: true,
                view: window,
              }),
            );
            element.dispatchEvent(
              new MouseEvent("mousemove", {
                bubbles: true,
                cancelable: true,
                view: window,
              }),
            );
            return { hovered: true };
          }

          if (action === "type") {
            const target =
              element instanceof HTMLInputElement ||
              element instanceof HTMLTextAreaElement
                ? element
                : element instanceof HTMLElement && element.isContentEditable
                  ? element
                  : null;

            if (!target) {
              return { typed: false };
            }

            target.focus();

            if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
              target.value = clearFirst ? text ?? "" : `${target.value}${text ?? ""}`;
            } else if (target.isContentEditable) {
              target.textContent = clearFirst
                ? text ?? ""
                : `${target.textContent ?? ""}${text ?? ""}`;
            }

            target.dispatchEvent(new Event("input", { bubbles: true }));
            target.dispatchEvent(new Event("change", { bubbles: true }));
            return { typed: true };
          }

          if (action === "select") {
            if (!(element instanceof HTMLSelectElement)) {
              return { selected: false };
            }

            let selectedIndex = -1;
            if (typeof index === "number") {
              selectedIndex = index;
            } else if (typeof value === "string") {
              selectedIndex = Array.from(element.options).findIndex(
                (option) => option.value === value,
              );
            } else if (typeof label === "string") {
              selectedIndex = Array.from(element.options).findIndex(
                (option) => option.label === label || option.text === label,
              );
            }

            if (selectedIndex < 0 || selectedIndex >= element.options.length) {
              return { selected: false };
            }

            element.selectedIndex = selectedIndex;
            element.dispatchEvent(new Event("input", { bubbles: true }));
            element.dispatchEvent(new Event("change", { bubbles: true }));
            return { selected: true };
          }
        }

        await new Promise((resolve) => self.setTimeout(resolve, 100));
      }

      if (action === "queryElements") {
        return {
          count: 0,
          elements: [],
        };
      }

      if (action === "hover") {
        return { hovered: false };
      }

      if (action === "type") {
        return { typed: false };
      }

      if (action === "select") {
        return { selected: false };
      }

      return { clicked: false };
    },
    args: [payload],
  });

  return typeof result?.result === "object" && result.result !== null ? result.result : {};
}

async function clickElement(
  tabId: number,
  selector: string,
  selectorType: SelectorType,
  timeoutMs: number,
) {
  const result = await runSelectorTask(tabId, {
    action: "click",
    selector,
    selectorType,
    timeoutMs,
  });
  return {
    clicked: result.clicked === true,
  };
}

async function hoverElement(
  tabId: number,
  selector: string,
  selectorType: SelectorType,
  timeoutMs: number,
) {
  const result = await runSelectorTask(tabId, {
    action: "hover",
    selector,
    selectorType,
    timeoutMs,
  });

  return {
    hovered: result.hovered === true,
  };
}

async function typeIntoElement(
  tabId: number,
  selector: string,
  selectorType: SelectorType,
  text: string,
  clearFirst: boolean,
  timeoutMs: number,
) {
  const result = await runSelectorTask(tabId, {
    action: "type",
    selector,
    selectorType,
    text,
    clearFirst,
    timeoutMs,
  });

  return {
    typed: result.typed === true,
  };
}

async function selectOption(
  tabId: number,
  selector: string,
  selectorType: SelectorType,
  timeoutMs: number,
  value?: string,
  label?: string,
  index?: number,
) {
  const result = await runSelectorTask(tabId, {
    action: "select",
    selector,
    selectorType,
    timeoutMs,
    value,
    label,
    index,
  });

  return {
    selected: result.selected === true,
  };
}

async function queryElements(
  tabId: number,
  selector: string,
  selectorType: SelectorType,
  limit: number,
) {
  const result = await runSelectorTask(tabId, {
    action: "queryElements",
    selector,
    selectorType,
    timeoutMs: 100,
    limit,
  });

  return {
    count: typeof result.count === "number" ? result.count : 0,
    elements: Array.isArray(result.elements) ? result.elements : [],
  };
}

async function querySelector(
  tabId: number,
  selector: string,
  selectorType: SelectorType,
) {
  const result = await queryElements(tabId, selector, selectorType, 1);

  return {
    found: result.count > 0,
    element: result.elements[0],
  };
}

async function waitForSelector(
  tabId: number,
  selector: string,
  selectorType: SelectorType,
  state: "attached" | "visible",
  timeoutMs: number,
) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (args) => {
      const { selector, selectorType, state, timeoutMs } = args;
      const deadline = Date.now() + timeoutMs;

      function resolveElements(): Element[] {
        if (selectorType === "xpath") {
          const xpathResult = document.evaluate(
            selector,
            document,
            null,
            XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
            null,
          );
          const elements: Element[] = [];
          for (let index = 0; index < xpathResult.snapshotLength; index += 1) {
            const candidate = xpathResult.snapshotItem(index);
            if (candidate instanceof Element) {
              elements.push(candidate);
            }
          }
          return elements;
        }

        if (selectorType === "text") {
          return Array.from(document.querySelectorAll("body *")).filter((candidate) =>
            candidate.textContent?.includes(selector),
          );
        }

        return Array.from(document.querySelectorAll(selector));
      }

      function isVisible(element: Element): boolean {
        return !(
          element instanceof HTMLElement &&
          !(
            element.offsetWidth ||
            element.offsetHeight ||
            element.getClientRects().length
          )
        );
      }

      while (Date.now() <= deadline) {
        const element = resolveElements()[0];
        if (element && (state === "attached" || isVisible(element))) {
          return { found: true };
        }

        await new Promise((resolve) => self.setTimeout(resolve, 100));
      }

      return { found: false };
    },
    args: [{ selector, selectorType, state, timeoutMs }],
  });

  return {
    found:
      typeof result?.result === "object" &&
      result.result !== null &&
      "found" in result.result &&
      result.result.found === true,
  };
}

async function getVisibleText(
  tabId: number,
  selector: string | undefined,
  selectorType: SelectorType,
  maxChars: number,
) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (args) => {
      const { selector, selectorType, maxChars } = args;

      function resolveElement(): Element | null {
        if (!selector) {
          return document.body;
        }

        if (selectorType === "xpath") {
          const xpathResult = document.evaluate(
            selector,
            document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null,
          );
          return xpathResult.singleNodeValue instanceof Element
            ? xpathResult.singleNodeValue
            : null;
        }

        if (selectorType === "text") {
          return (
            Array.from(document.querySelectorAll("body *")).find((candidate) =>
              candidate.textContent?.includes(selector),
            ) ?? null
          );
        }

        return document.querySelector(selector);
      }

      const element = resolveElement();
      const text =
        element instanceof HTMLElement
          ? element.innerText
          : element?.textContent ?? "";

      return {
        text: text.slice(0, maxChars),
      };
    },
    args: [{ selector, selectorType, maxChars }],
  });

  return {
    text:
      typeof result?.result === "object" &&
      result.result !== null &&
      "text" in result.result &&
      typeof result.result.text === "string"
        ? result.result.text
        : "",
  };
}

async function getDom(
  tabId: number,
  selector: string | undefined,
  selectorType: SelectorType,
  maxChars: number,
) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (args) => {
      const { selector, selectorType, maxChars } = args;

      function resolveElement(): Element | null {
        if (!selector) {
          return document.documentElement;
        }

        if (selectorType === "xpath") {
          const xpathResult = document.evaluate(
            selector,
            document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null,
          );
          return xpathResult.singleNodeValue instanceof Element
            ? xpathResult.singleNodeValue
            : null;
        }

        if (selectorType === "text") {
          return (
            Array.from(document.querySelectorAll("body *")).find((candidate) =>
              candidate.textContent?.includes(selector),
            ) ?? null
          );
        }

        return document.querySelector(selector);
      }

      const element = resolveElement();
      const html =
        element instanceof HTMLElement || element instanceof SVGElement
          ? element.outerHTML
          : element?.textContent ?? "";

      return {
        html: html.slice(0, maxChars),
      };
    },
    args: [{ selector, selectorType, maxChars }],
  });

  return {
    html:
      typeof result?.result === "object" &&
      result.result !== null &&
      "html" in result.result &&
      typeof result.result.html === "string"
        ? result.result.html
        : "",
  };
}

async function scrollToLocation(
  tabId: number,
  options: {
    selector?: string;
    selectorType: SelectorType;
    x?: number;
    y?: number;
    behavior: "auto" | "smooth";
    block: "start" | "center" | "end" | "nearest";
    timeoutMs: number;
  },
) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (args) => {
      const deadline = Date.now() + args.timeoutMs;

      function resolveElement(): Element | null {
        if (!args.selector) {
          return null;
        }

        if (args.selectorType === "xpath") {
          const xpathResult = document.evaluate(
            args.selector,
            document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null,
          );
          return xpathResult.singleNodeValue instanceof Element
            ? xpathResult.singleNodeValue
            : null;
        }

        if (args.selectorType === "text") {
          return (
            Array.from(document.querySelectorAll("body *")).find((candidate) =>
              candidate.textContent?.includes(args.selector ?? ""),
            ) ?? null
          );
        }

        return document.querySelector(args.selector);
      }

      while (Date.now() <= deadline) {
        const element = resolveElement();
        if (element) {
          if ("scrollIntoView" in element) {
            element.scrollIntoView({
              behavior: args.behavior,
              block: args.block,
              inline: "nearest",
            });
          }
          await new Promise((resolve) => self.setTimeout(resolve, 50));
          return {
            scrolled: true,
            x: window.scrollX,
            y: window.scrollY,
          };
        }

        if (typeof args.x === "number" && typeof args.y === "number") {
          window.scrollTo({
            left: args.x,
            top: args.y,
            behavior: args.behavior,
          });
          await new Promise((resolve) => self.setTimeout(resolve, 50));
          return {
            scrolled: true,
            x: window.scrollX,
            y: window.scrollY,
          };
        }

        await new Promise((resolve) => self.setTimeout(resolve, 100));
      }

      return {
        scrolled: false,
        x: window.scrollX,
        y: window.scrollY,
      };
    },
    args: [options],
  });

  return {
    scrolled:
      typeof result?.result === "object" &&
      result.result !== null &&
      "scrolled" in result.result &&
      result.result.scrolled === true,
    x:
      typeof result?.result === "object" &&
      result.result !== null &&
      "x" in result.result &&
      typeof result.result.x === "number"
        ? result.result.x
        : 0,
    y:
      typeof result?.result === "object" &&
      result.result !== null &&
      "y" in result.result &&
      typeof result.result.y === "number"
        ? result.result.y
        : 0,
  };
}

async function elementsFromPoint(
  tabId: number,
  x: number,
  y: number,
  limit: number,
) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (args) => {
      function isVisible(element: Element): boolean {
        if (!(element instanceof HTMLElement)) {
          return true;
        }

        return Boolean(
          element.offsetWidth ||
            element.offsetHeight ||
            element.getClientRects().length,
        );
      }

      function serializeElement(element: Element) {
        const htmlElement = element instanceof HTMLElement ? element : null;
        const fieldValue =
          htmlElement instanceof HTMLInputElement ||
          htmlElement instanceof HTMLTextAreaElement ||
          htmlElement instanceof HTMLSelectElement
            ? htmlElement.value
            : undefined;
        const value = fieldValue && fieldValue.length > 0 ? fieldValue : undefined;

        return {
          tagName: element.tagName.toLowerCase(),
          text: element.textContent?.trim().slice(0, 200) || undefined,
          value,
          href: element instanceof HTMLAnchorElement ? element.href : undefined,
          visible: isVisible(element),
        };
      }

      const elements = document.elementsFromPoint(args.x, args.y).slice(0, args.limit);
      return {
        count: elements.length,
        elements: elements.map(serializeElement),
      };
    },
    args: [{ x, y, limit }],
  });

  return {
    count:
      typeof result?.result === "object" &&
      result.result !== null &&
      "count" in result.result &&
      typeof result.result.count === "number"
        ? result.result.count
        : 0,
    elements:
      typeof result?.result === "object" &&
      result.result !== null &&
      "elements" in result.result &&
      Array.isArray(result.result.elements)
        ? result.result.elements
        : [],
  };
}

async function dragAndDrop(
  tabId: number,
  selector: string,
  selectorType: SelectorType,
  targetSelector: string,
  targetSelectorType: SelectorType,
  timeoutMs: number,
) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (args) => {
      const deadline = Date.now() + args.timeoutMs;

      function resolveElements(selector: string, selectorType: SelectorType): Element[] {
        if (selectorType === "xpath") {
          const xpathResult = document.evaluate(
            selector,
            document,
            null,
            XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
            null,
          );
          const elements: Element[] = [];
          for (let index = 0; index < xpathResult.snapshotLength; index += 1) {
            const candidate = xpathResult.snapshotItem(index);
            if (candidate instanceof Element) {
              elements.push(candidate);
            }
          }
          return elements;
        }

        if (selectorType === "text") {
          return Array.from(document.querySelectorAll("body *")).filter((candidate) =>
            candidate.textContent?.includes(selector),
          );
        }

        return Array.from(document.querySelectorAll(selector));
      }

      while (Date.now() <= deadline) {
        const source = resolveElements(args.selector, args.selectorType)[0];
        const target = resolveElements(args.targetSelector, args.targetSelectorType)[0];
        if (source && target) {
          const transfer = new DataTransfer();
          const eventInit = {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer,
          };

          source.dispatchEvent(new DragEvent("dragstart", eventInit));
          target.dispatchEvent(new DragEvent("dragenter", eventInit));
          target.dispatchEvent(new DragEvent("dragover", eventInit));
          target.dispatchEvent(new DragEvent("drop", eventInit));
          source.dispatchEvent(new DragEvent("dragend", eventInit));
          return { dropped: true };
        }

        await new Promise((resolve) => self.setTimeout(resolve, 100));
      }

      return { dropped: false };
    },
    args: [{ selector, selectorType, targetSelector, targetSelectorType, timeoutMs }],
  });

  return {
    dropped:
      typeof result?.result === "object" &&
      result.result !== null &&
      "dropped" in result.result &&
      result.result.dropped === true,
  };
}

async function uploadFiles(
  tabId: number,
  selector: string,
  selectorType: SelectorType,
  files: Array<{
    name: string;
    mimeType: string;
    base64: string;
    lastModified?: number;
  }>,
  timeoutMs: number,
) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (args) => {
      const deadline = Date.now() + args.timeoutMs;

      function resolveElements(): Element[] {
        if (args.selectorType === "xpath") {
          const xpathResult = document.evaluate(
            args.selector,
            document,
            null,
            XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
            null,
          );
          const elements: Element[] = [];
          for (let index = 0; index < xpathResult.snapshotLength; index += 1) {
            const candidate = xpathResult.snapshotItem(index);
            if (candidate instanceof Element) {
              elements.push(candidate);
            }
          }
          return elements;
        }

        if (args.selectorType === "text") {
          return Array.from(document.querySelectorAll("body *")).filter((candidate) =>
            candidate.textContent?.includes(args.selector),
          );
        }

        return Array.from(document.querySelectorAll(args.selector));
      }

      function decodeBase64(base64: string): Uint8Array {
        const decoded = atob(base64);
        return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
      }

      while (Date.now() <= deadline) {
        const element = resolveElements()[0];
        if (element instanceof HTMLInputElement && element.type === "file") {
          const transfer = new DataTransfer();
          for (const file of args.files) {
            transfer.items.add(
              new File([decodeBase64(file.base64)], file.name, {
                type: file.mimeType,
                lastModified: file.lastModified ?? Date.now(),
              }),
            );
          }

          element.files = transfer.files;
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
          return {
            uploaded: true,
            fileCount: transfer.files.length,
          };
        }

        await new Promise((resolve) => self.setTimeout(resolve, 100));
      }

      return {
        uploaded: false,
        fileCount: 0,
      };
    },
    args: [{ selector, selectorType, files, timeoutMs }],
  });

  return {
    uploaded:
      typeof result?.result === "object" &&
      result.result !== null &&
      "uploaded" in result.result &&
      result.result.uploaded === true,
    fileCount:
      typeof result?.result === "object" &&
      result.result !== null &&
      "fileCount" in result.result &&
      typeof result.result.fileCount === "number"
        ? result.result.fileCount
        : 0,
  };
}

async function waitForIdle(
  tabId: number,
  idleMs: number,
  timeoutMs: number,
) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (args) => {
      let lastActivityAt = Date.now();
      const deadline = Date.now() + args.timeoutMs;

      const observer = new MutationObserver(() => {
        lastActivityAt = Date.now();
      });
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });

      const markActivity = () => {
        lastActivityAt = Date.now();
      };

      for (const eventName of ["scroll", "input", "change", "keydown", "click"]) {
        window.addEventListener(eventName, markActivity, true);
      }

      try {
        while (Date.now() <= deadline) {
          if (
            document.readyState === "complete" &&
            Date.now() - lastActivityAt >= args.idleMs
          ) {
            return {
              idle: true,
              status: "ok",
            };
          }

          await new Promise((resolve) => self.setTimeout(resolve, 100));
        }

        return {
          idle: false,
          status: "timeout",
        };
      } finally {
        observer.disconnect();
        for (const eventName of ["scroll", "input", "change", "keydown", "click"]) {
          window.removeEventListener(eventName, markActivity, true);
        }
      }
    },
    args: [{ idleMs, timeoutMs }],
  });

  return {
    idle:
      typeof result?.result === "object" &&
      result.result !== null &&
      "idle" in result.result &&
      result.result.idle === true,
    status:
      typeof result?.result === "object" &&
      result.result !== null &&
      "status" in result.result &&
      result.result.status === "timeout"
        ? "timeout"
        : "ok",
  };
}

async function downloadAsset(options: {
  url: string;
  tabId?: number;
  timeoutMs: number;
  maxBytes: number;
}) {
  let resolvedUrl = options.url;
  if (typeof options.tabId === "number") {
    const tab = await chrome.tabs.get(options.tabId);
    resolvedUrl = new URL(options.url, tab.url ?? "about:blank").toString();
  }

  const controller = new AbortController();
  const timeout = self.setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await fetch(resolvedUrl, {
      credentials: "include",
      signal: controller.signal,
    });

    const contentLengthHeader = response.headers.get("content-length");
    const expectedLength =
      contentLengthHeader !== null ? Number(contentLengthHeader) : Number.NaN;
    if (Number.isFinite(expectedLength) && expectedLength > options.maxBytes) {
      return {
        finalUrl: response.url || resolvedUrl,
        mimeType: response.headers.get("content-type") ?? "application/octet-stream",
        base64: "",
        sizeBytes: expectedLength,
        status: "too_large" as const,
      };
    }

    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    if (bytes.byteLength > options.maxBytes) {
      return {
        finalUrl: response.url || resolvedUrl,
        mimeType: response.headers.get("content-type") ?? "application/octet-stream",
        base64: "",
        sizeBytes: bytes.byteLength,
        status: "too_large" as const,
      };
    }

    const base64 = btoa(
      Array.from(bytes, (value) => String.fromCharCode(value)).join(""),
    );

    return {
      finalUrl: response.url || resolvedUrl,
      mimeType: response.headers.get("content-type") ?? "application/octet-stream",
      base64,
      sizeBytes: bytes.byteLength,
      status: "ok" as const,
    };
  } finally {
    self.clearTimeout(timeout);
  }
}

async function capturePdf(
  tabId: number,
  options: {
    landscape: boolean;
    printBackground: boolean;
    scale: number;
    paperWidth: number;
    paperHeight: number;
    marginTop: number;
    marginBottom: number;
    marginLeft: number;
    marginRight: number;
    pageRanges?: string;
    preferCSSPageSize: boolean;
    maxBytes: number;
  },
) {
  const result = await withDebuggerSession<{
    data?: string;
  }>(tabId, async (_debuggee, sendCommand) => {
    return sendCommand("Page.printToPDF", {
      landscape: options.landscape,
      printBackground: options.printBackground,
      scale: options.scale,
      paperWidth: options.paperWidth,
      paperHeight: options.paperHeight,
      marginTop: options.marginTop,
      marginBottom: options.marginBottom,
      marginLeft: options.marginLeft,
      marginRight: options.marginRight,
      pageRanges: options.pageRanges,
      preferCSSPageSize: options.preferCSSPageSize,
      transferMode: "ReturnAsBase64",
    });
  });

  const base64 = typeof result.data === "string" ? result.data : "";
  const sizeBytes = Math.floor((base64.length * 3) / 4);
  if (sizeBytes > options.maxBytes) {
    return {
      mimeType: "application/pdf" as const,
      base64: "",
      sizeBytes,
      status: "too_large" as const,
    };
  }

  return {
    mimeType: "application/pdf" as const,
    base64,
    sizeBytes,
    status: "ok" as const,
  };
}

async function captureNetworkLog(
  tabId: number,
  options: {
    durationMs: number;
    maxEntries: number;
    includeBodies: boolean;
    reloadFirst: boolean;
    urlIncludes?: string;
  },
) {
  return withDebuggerSession(tabId, async (debuggee, sendCommand) => {
    type MutableEntry = {
      requestId: string;
      url: string;
      method: string;
      type?: string;
      status?: number;
      statusText?: string;
      mimeType?: string;
      fromCache?: boolean;
      failed?: boolean;
      errorText?: string;
      encodedDataLength?: number;
      bodyBase64?: string;
      startedAt: number;
    };

    const entries = new Map<string, MutableEntry>();
    const orderedIds: string[] = [];

    const onEvent = async (
      source: chrome.debugger.Debuggee,
      method: string,
      params?: Record<string, unknown>,
    ) => {
      if (source.tabId !== debuggee.tabId || !params) {
        return;
      }

      if (method === "Network.requestWillBeSent") {
        const requestId = String(params.requestId);
        const url = String((params.request as { url?: unknown } | undefined)?.url ?? "");
        if (options.urlIncludes && !url.includes(options.urlIncludes)) {
          return;
        }

        entries.set(requestId, {
          requestId,
          url,
          method: String((params.request as { method?: unknown } | undefined)?.method ?? "GET"),
          type: typeof params.type === "string" ? params.type : undefined,
          startedAt: Date.now(),
        });
        orderedIds.push(requestId);
        return;
      }

      const requestId = typeof params.requestId === "string" ? params.requestId : undefined;
      if (!requestId) {
        return;
      }
      const entry = entries.get(requestId);
      if (!entry) {
        return;
      }

      if (method === "Network.responseReceived") {
        const response = params.response as {
          status?: unknown;
          statusText?: unknown;
          mimeType?: unknown;
          fromDiskCache?: unknown;
          fromPrefetchCache?: unknown;
          fromServiceWorker?: unknown;
        };
        entry.status =
          typeof response.status === "number" ? Math.trunc(response.status) : undefined;
        entry.statusText =
          typeof response.statusText === "string" ? response.statusText : undefined;
        entry.mimeType =
          typeof response.mimeType === "string" ? response.mimeType : undefined;
        entry.fromCache =
          response.fromDiskCache === true ||
          response.fromPrefetchCache === true ||
          response.fromServiceWorker === true;
        return;
      }

      if (method === "Network.loadingFinished") {
        entry.encodedDataLength =
          typeof params.encodedDataLength === "number" ? params.encodedDataLength : undefined;
        if (options.includeBodies) {
          try {
            const body = await sendCommand<{ body?: string; base64Encoded?: boolean }>(
              "Network.getResponseBody",
              { requestId },
            );
            if (typeof body.body === "string") {
              entry.bodyBase64 = body.base64Encoded
                ? body.body
                : btoa(unescape(encodeURIComponent(body.body)));
            }
          } catch {
            // Some responses do not expose bodies. Ignore.
          }
        }
        return;
      }

      if (method === "Network.loadingFailed") {
        entry.failed = true;
        entry.errorText =
          typeof params.errorText === "string" ? params.errorText : "Network loading failed";
      }
    };

    chrome.debugger.onEvent.addListener(onEvent);
    try {
      await sendCommand("Network.enable");
      if (options.reloadFirst) {
        await sendCommand("Page.reload", { ignoreCache: false });
      }

      await new Promise((resolve) => self.setTimeout(resolve, options.durationMs));
    } finally {
      chrome.debugger.onEvent.removeListener(onEvent);
      if (hasPersistentDebuggerWork(getTabAutomationPolicy(tabId))) {
        try {
          await applyPersistentDebuggerPolicies(tabId);
        } catch {
          // Best effort restoration of persistent policies.
        }
      } else {
        try {
          await sendCommand("Network.disable");
        } catch {
          // Best effort cleanup.
        }
      }
    }

    return {
      entries: orderedIds
        .map((requestId) => entries.get(requestId))
        .filter((entry): entry is MutableEntry => Boolean(entry))
        .slice(-options.maxEntries)
        .map(({ startedAt: _startedAt, ...entry }) => entry),
    };
  });
}

async function accessCookies(options: {
  tabId?: number;
  url?: string;
  domain?: string;
  name?: string;
  path?: string;
  secure?: boolean;
  session?: boolean;
  storeId?: string;
}) {
  let url = options.url;
  let storeId = options.storeId;

  if (typeof options.tabId === "number") {
    const tab = await chrome.tabs.get(options.tabId);
    url = url ?? tab.url ?? undefined;
    if (!storeId) {
      const stores = await chrome.cookies.getAllCookieStores();
      storeId = stores.find((candidate) => candidate.tabIds.includes(options.tabId!))?.id;
    }
  }

  const cookies = await chrome.cookies.getAll({
    url,
    domain: options.domain,
    name: options.name,
    path: options.path,
    secure: options.secure,
    session: options.session,
    storeId,
  });

  return {
    cookies: cookies.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      session: cookie.session,
      sameSite: String(cookie.sameSite ?? "unspecified"),
      storeId: cookie.storeId,
      expirationDate: cookie.expirationDate,
    })),
  };
}

async function configureRequestInterception(options: {
  tabId: number;
  enabled: boolean;
  urlPattern?: string;
  resourceTypes?: string[];
  action: "continue" | "fail";
  failReason: string;
  method?: string;
  headers?: HeaderEntry[];
  postDataBase64?: string;
}) {
  const state = getTabAutomationPolicy(options.tabId);
  if (!options.enabled) {
    state.requestRules =
      typeof options.urlPattern === "string"
        ? state.requestRules.filter((rule) => rule.urlPattern !== options.urlPattern)
        : [];
    await applyPersistentDebuggerPolicies(options.tabId);
    return {
      configured: false,
      activeRules: state.requestRules.length,
    };
  }

  state.requestRules = [
    ...state.requestRules.filter((rule) => rule.urlPattern !== options.urlPattern),
    {
      kind: "intercept",
      urlPattern: options.urlPattern ?? "*",
      resourceTypes: options.resourceTypes,
      action: options.action,
      failReason: options.failReason,
      method: options.method,
      headers: options.headers,
      postDataBase64: options.postDataBase64,
    },
  ];
  await applyPersistentDebuggerPolicies(options.tabId);
  return {
    configured: true,
    activeRules: state.requestRules.length,
  };
}

async function configureMockResponse(options: {
  tabId: number;
  enabled: boolean;
  urlPattern?: string;
  resourceTypes?: string[];
  statusCode: number;
  headers: HeaderEntry[];
  bodyBase64?: string;
}) {
  const state = getTabAutomationPolicy(options.tabId);
  if (!options.enabled) {
    state.mockRules =
      typeof options.urlPattern === "string"
        ? state.mockRules.filter((rule) => rule.urlPattern !== options.urlPattern)
        : [];
    await applyPersistentDebuggerPolicies(options.tabId);
    return {
      configured: false,
      activeRules: state.mockRules.length,
    };
  }

  state.mockRules = [
    ...state.mockRules.filter((rule) => rule.urlPattern !== options.urlPattern),
    {
      kind: "mock",
      urlPattern: options.urlPattern ?? "*",
      resourceTypes: options.resourceTypes,
      statusCode: options.statusCode,
      headers: options.headers,
      bodyBase64: options.bodyBase64,
    },
  ];
  await applyPersistentDebuggerPolicies(options.tabId);
  return {
    configured: true,
    activeRules: state.mockRules.length,
  };
}

async function configureNetworkThrottle(options: {
  tabId: number;
  enabled: boolean;
  offline: boolean;
  latencyMs: number;
  downloadThroughput: number;
  uploadThroughput: number;
  connectionType?: string;
}) {
  const state = getTabAutomationPolicy(options.tabId);
  state.throttle = options.enabled
    ? {
        enabled: true,
        offline: options.offline,
        latencyMs: options.latencyMs,
        downloadThroughput: options.downloadThroughput,
        uploadThroughput: options.uploadThroughput,
        connectionType: options.connectionType,
      }
    : null;
  await applyPersistentDebuggerPolicies(options.tabId);
  return {
    enabled: Boolean(state.throttle?.enabled),
    offline: state.throttle?.offline ?? false,
    latencyMs: state.throttle?.latencyMs ?? 0,
    downloadThroughput: state.throttle?.downloadThroughput ?? -1,
    uploadThroughput: state.throttle?.uploadThroughput ?? -1,
  };
}

async function resolveTabOrigin(input: { tabId?: number; url?: string }): Promise<{
  origin: string;
  url: string;
  tabId?: number;
}> {
  let resolvedUrl = input.url;
  if (!resolvedUrl && typeof input.tabId === "number") {
    const tab = await chrome.tabs.get(input.tabId);
    resolvedUrl = tab.url ?? undefined;
  }
  if (!resolvedUrl) {
    throw new Error("Unable to resolve a URL for storage access.");
  }
  const origin = new URL(resolvedUrl).origin;
  return {
    origin,
    url: resolvedUrl,
    tabId: input.tabId,
  };
}

async function clearStorageForTarget(options: {
  tabId?: number;
  url?: string;
  clearCookies: boolean;
  clearLocalStorage: boolean;
  clearSessionStorage: boolean;
  clearIndexedDb: boolean;
  clearCacheStorage: boolean;
  clearServiceWorkers: boolean;
}) {
  const resolved = await resolveTabOrigin(options);
  let clearedCookies = 0;

  if (options.clearCookies) {
    const cookies = await chrome.cookies.getAll({ url: resolved.url });
    await Promise.all(
      cookies.map(async (cookie) => {
        const protocol = cookie.secure ? "https:" : "http:";
        const domain = cookie.domain.startsWith(".")
          ? cookie.domain.slice(1)
          : cookie.domain;
        const removalUrl = `${protocol}//${domain}${cookie.path}`;
        try {
          await chrome.cookies.remove({
            url: removalUrl,
            name: cookie.name,
            storeId: cookie.storeId,
          });
          clearedCookies += 1;
        } catch {
          // Ignore individual cookie removal failures.
        }
      }),
    );
  }

  const storageTypes: string[] = [];
  if (options.clearIndexedDb) {
    storageTypes.push("indexeddb");
  }
  if (options.clearCacheStorage) {
    storageTypes.push("cache_storage");
  }
  if (options.clearServiceWorkers) {
    storageTypes.push("service_workers");
  }
  if (options.clearLocalStorage) {
    storageTypes.push("local_storage");
  }

  if (typeof resolved.tabId === "number" && storageTypes.length > 0) {
    await withDebuggerSession(resolved.tabId, async (_debuggee, sendCommand) => {
      await sendCommand("Storage.clearDataForOrigin", {
        origin: resolved.origin,
        storageTypes: storageTypes.join(","),
      });
      return {};
    });
  }

  let localStorageCleared = false;
  let sessionStorageCleared = false;
  if (
    typeof resolved.tabId === "number" &&
    (options.clearLocalStorage || options.clearSessionStorage)
  ) {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: resolved.tabId },
      func: (clearLocal, clearSession) => {
        if (clearLocal) {
          localStorage.clear();
        }
        if (clearSession) {
          sessionStorage.clear();
        }
        return {
          localStorageCleared: clearLocal,
          sessionStorageCleared: clearSession,
        };
      },
      args: [options.clearLocalStorage, options.clearSessionStorage],
    });
    localStorageCleared =
      typeof result?.result === "object" &&
      result.result !== null &&
      "localStorageCleared" in result.result &&
      result.result.localStorageCleared === true;
    sessionStorageCleared =
      typeof result?.result === "object" &&
      result.result !== null &&
      "sessionStorageCleared" in result.result &&
      result.result.sessionStorageCleared === true;
  }

  return {
    origin: resolved.origin,
    clearedCookies,
    clearedStorageTypes: storageTypes,
    localStorageCleared,
    sessionStorageCleared,
  };
}

async function exportSession(options: {
  tabId: number;
  includeCookies: boolean;
  includeLocalStorage: boolean;
  includeSessionStorage: boolean;
  includeHtml: boolean;
  maxHtmlChars: number;
}) {
  const tab = await chrome.tabs.get(options.tabId);
  const url = tab.url ?? "";
  const title = tab.title ?? "";
  const cookies = options.includeCookies
    ? (await accessCookies({ tabId: options.tabId })).cookies
    : [];

  const [result] = await chrome.scripting.executeScript({
    target: { tabId: options.tabId },
    func: (includeLocalStorage, includeSessionStorage, includeHtml, maxHtmlChars) => {
      const localStorageData: Record<string, string> = {};
      const sessionStorageData: Record<string, string> = {};

      if (includeLocalStorage) {
        for (let index = 0; index < localStorage.length; index += 1) {
          const key = localStorage.key(index);
          if (key !== null) {
            localStorageData[key] = localStorage.getItem(key) ?? "";
          }
        }
      }

      if (includeSessionStorage) {
        for (let index = 0; index < sessionStorage.length; index += 1) {
          const key = sessionStorage.key(index);
          if (key !== null) {
            sessionStorageData[key] = sessionStorage.getItem(key) ?? "";
          }
        }
      }

      return {
        localStorage: localStorageData,
        sessionStorage: sessionStorageData,
        historyLength: history.length,
        html: includeHtml ? document.documentElement.outerHTML.slice(0, maxHtmlChars) : undefined,
      };
    },
    args: [
      options.includeLocalStorage,
      options.includeSessionStorage,
      options.includeHtml,
      options.maxHtmlChars,
    ],
  });

  const scriptResult =
    typeof result?.result === "object" && result.result !== null ? result.result : {};

  return {
    url,
    title,
    cookies,
    localStorage:
      typeof scriptResult === "object" && "localStorage" in scriptResult
        ? ((scriptResult.localStorage as Record<string, string>) ?? {})
        : {},
    sessionStorage:
      typeof scriptResult === "object" && "sessionStorage" in scriptResult
        ? ((scriptResult.sessionStorage as Record<string, string>) ?? {})
        : {},
    historyLength:
      typeof scriptResult === "object" &&
      "historyLength" in scriptResult &&
      typeof scriptResult.historyLength === "number"
        ? scriptResult.historyLength
        : 0,
    html:
      typeof scriptResult === "object" && "html" in scriptResult
        ? (scriptResult.html as string | undefined)
        : undefined,
  };
}

async function configureUserAgentOverride(options: {
  tabId: number;
  enabled: boolean;
  userAgent?: string;
  acceptLanguage?: string;
  platform?: string;
}) {
  const state = getTabAutomationPolicy(options.tabId);
  state.userAgentOverride = options.enabled
    ? {
        enabled: true,
        userAgent: options.userAgent ?? defaultBrowserIdentity.userAgent,
        acceptLanguage: options.acceptLanguage ?? defaultBrowserIdentity.acceptLanguage,
        platform: options.platform ?? defaultBrowserIdentity.platform,
      }
    : null;
  await applyPersistentDebuggerPolicies(options.tabId);
  return {
    enabled: Boolean(state.userAgentOverride?.enabled),
    userAgent: state.userAgentOverride?.userAgent ?? defaultBrowserIdentity.userAgent,
    acceptLanguage:
      state.userAgentOverride?.acceptLanguage ?? defaultBrowserIdentity.acceptLanguage,
    platform: state.userAgentOverride?.platform ?? defaultBrowserIdentity.platform,
  };
}

async function configureMediaEmulation(options: {
  tabId: number;
  enabled: boolean;
  media: string;
  features: MediaFeature[];
}) {
  const state = getTabAutomationPolicy(options.tabId);
  state.mediaOverride = options.enabled
    ? {
        enabled: true,
        media: options.media,
        features: options.features,
      }
    : null;
  await applyPersistentDebuggerPolicies(options.tabId);
  return {
    enabled: Boolean(state.mediaOverride?.enabled),
    media: state.mediaOverride?.media ?? "",
    featureCount: state.mediaOverride?.features.length ?? 0,
  };
}

async function configureGeolocationOverride(options: {
  tabId: number;
  enabled: boolean;
  latitude?: number;
  longitude?: number;
  accuracy: number;
  altitude?: number;
  altitudeAccuracy?: number;
  heading?: number;
  speed?: number;
}) {
  const state = getTabAutomationPolicy(options.tabId);
  state.geolocationOverride =
    options.enabled &&
    typeof options.latitude === "number" &&
    typeof options.longitude === "number"
      ? {
          enabled: true,
          latitude: options.latitude,
          longitude: options.longitude,
          accuracy: options.accuracy,
          altitude: options.altitude,
          altitudeAccuracy: options.altitudeAccuracy,
          heading: options.heading,
          speed: options.speed,
        }
      : null;
  await applyPersistentDebuggerPolicies(options.tabId);
  await syncGeolocationShim(options.tabId);
  return {
    enabled: Boolean(state.geolocationOverride?.enabled),
    latitude: state.geolocationOverride?.latitude,
    longitude: state.geolocationOverride?.longitude,
    accuracy: state.geolocationOverride?.accuracy,
  };
}

async function syncGeolocationShim(tabId: number): Promise<void> {
  const state = getTabAutomationPolicy(tabId);
  const override = state.geolocationOverride;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (nextOverride) => {
        type GeoState = {
          originalGetCurrentPosition?: Geolocation["getCurrentPosition"];
          originalWatchPosition?: Geolocation["watchPosition"];
          originalClearWatch?: Geolocation["clearWatch"];
          watchTimers: Map<number, number>;
          nextWatchId: number;
        };
        const scope = globalThis as typeof globalThis & {
          __braveMcpGeoState?: GeoState;
        };

        const geo = navigator.geolocation;
        if (!scope.__braveMcpGeoState) {
          scope.__braveMcpGeoState = {
            originalGetCurrentPosition: geo.getCurrentPosition.bind(geo),
            originalWatchPosition: geo.watchPosition.bind(geo),
            originalClearWatch: geo.clearWatch.bind(geo),
            watchTimers: new Map(),
            nextWatchId: 1,
          };
        }

        const state = scope.__braveMcpGeoState;
        if (!nextOverride) {
          if (state.originalGetCurrentPosition) {
            geo.getCurrentPosition = state.originalGetCurrentPosition;
          }
          if (state.originalWatchPosition) {
            geo.watchPosition = state.originalWatchPosition;
          }
          if (state.originalClearWatch) {
            geo.clearWatch = state.originalClearWatch;
          }
          for (const timer of state.watchTimers.values()) {
            clearTimeout(timer);
          }
          state.watchTimers.clear();
          return { enabled: false };
        }

        const buildPosition = (): GeolocationPosition =>
          ({
            coords: {
              latitude: nextOverride.latitude,
              longitude: nextOverride.longitude,
              accuracy: nextOverride.accuracy,
              altitude: nextOverride.altitude ?? null,
              altitudeAccuracy: nextOverride.altitudeAccuracy ?? null,
              heading: nextOverride.heading ?? null,
              speed: nextOverride.speed ?? null,
              toJSON() {
                return this;
              },
            },
            timestamp: Date.now(),
            toJSON() {
              return this;
            },
          }) as GeolocationPosition;

        geo.getCurrentPosition = (successCallback) => {
          queueMicrotask(() => {
            successCallback(buildPosition());
          });
        };

        geo.watchPosition = (successCallback) => {
          const watchId = state.nextWatchId++;
          const timer = window.setTimeout(() => {
            successCallback(buildPosition());
          }, 0);
          state.watchTimers.set(watchId, timer);
          return watchId;
        };

        geo.clearWatch = (watchId) => {
          const timer = state.watchTimers.get(watchId);
          if (timer !== undefined) {
            clearTimeout(timer);
            state.watchTimers.delete(watchId);
          }
        };

        return {
          enabled: true,
          latitude: nextOverride.latitude,
          longitude: nextOverride.longitude,
          accuracy: nextOverride.accuracy,
        };
      },
      args: [
        override
          ? {
              latitude: override.latitude,
              longitude: override.longitude,
              accuracy: override.accuracy,
              altitude: override.altitude,
              altitudeAccuracy: override.altitudeAccuracy,
              heading: override.heading,
              speed: override.speed,
            }
          : null,
      ],
    });
  } catch {
    // Some pages cannot be scripted. Ignore and rely on the CDP path when available.
  }
}

async function grantPermissions(options: {
  tabId?: number;
  url?: string;
  permissions: Array<"geolocation" | "notifications" | "microphone" | "camera">;
  setting: "allow" | "block" | "ask";
}) {
  const resolved = await resolveTabOrigin(options);
  const pattern = originToContentSettingPattern(resolved.url);
  const settingMap = {
    geolocation: chrome.contentSettings.location,
    notifications: chrome.contentSettings.notifications,
    microphone: chrome.contentSettings.microphone,
    camera: chrome.contentSettings.camera,
  } as const;
  const browserSetting =
    options.setting === "allow"
      ? "granted"
      : options.setting === "block"
        ? "denied"
        : "prompt";

  if (typeof resolved.tabId === "number") {
    await withDebuggerSession(resolved.tabId, async (_debuggee, sendCommand) => {
      for (const permission of options.permissions) {
        await sendCommand("Browser.setPermission", {
          permission: { name: permission },
          setting: browserSetting,
          origin: resolved.origin,
        });
      }
      return {};
    });
  }

  for (const permission of options.permissions) {
    try {
      await settingMap[permission].set({
        primaryPattern: pattern,
        secondaryPattern: pattern,
        setting: options.setting,
        scope: "regular",
      });
    } catch {
      // Content settings are best-effort; Browser.setPermission is the primary path.
    }
  }

  return {
    origin: resolved.origin,
    setting: options.setting,
    appliedPermissions: options.permissions,
  };
}

async function exportHar(options: {
  tabId: number;
  durationMs: number;
  reloadFirst: boolean;
  includeBodies: boolean;
  maxEntries: number;
  urlIncludes?: string;
}) {
  const tab = await chrome.tabs.get(options.tabId);
  const pageUrl = tab.url ?? "";
  const pageTitle = tab.title ?? "";

  const result = await withDebuggerSession(options.tabId, async (debuggee, sendCommand) => {
    type HarMutableEntry = {
      requestId: string;
      startedDateTime: string;
      time: number;
      request: {
        method: string;
        url: string;
        headers: HeaderEntry[];
      };
      response: {
        status: number;
        statusText: string;
        headers: HeaderEntry[];
        content: {
          size: number;
          mimeType: string;
          text?: string;
          encoding?: string;
        };
      };
      timings: {
        blocked: number;
        dns: number;
        connect: number;
        send: number;
        wait: number;
        receive: number;
        ssl: number;
      };
      startedAtMs: number;
    };

    const entries = new Map<string, HarMutableEntry>();
    const orderedIds: string[] = [];

    const toHeaders = (headers: unknown): HeaderEntry[] => {
      if (!headers || typeof headers !== "object") {
        return [];
      }
      return Object.entries(headers as Record<string, unknown>).map(([name, value]) => ({
        name,
        value: String(value),
      }));
    };

    const onEvent = async (
      source: chrome.debugger.Debuggee,
      method: string,
      params?: Record<string, unknown>,
    ) => {
      if (source.tabId !== debuggee.tabId || !params) {
        return;
      }

      if (method === "Network.requestWillBeSent") {
        const requestId = String(params.requestId);
        const request = (params.request as Record<string, unknown> | undefined) ?? {};
        const url = String(request.url ?? "");
        if (options.urlIncludes && !url.includes(options.urlIncludes)) {
          return;
        }

        entries.set(requestId, {
          requestId,
          startedDateTime: new Date().toISOString(),
          time: 0,
          request: {
            method: String(request.method ?? "GET"),
            url,
            headers: toHeaders(request.headers),
          },
          response: {
            status: 0,
            statusText: "",
            headers: [],
            content: {
              size: 0,
              mimeType: "",
            },
          },
          timings: {
            blocked: 0,
            dns: -1,
            connect: -1,
            send: 0,
            wait: 0,
            receive: 0,
            ssl: -1,
          },
          startedAtMs: Date.now(),
        });
        orderedIds.push(requestId);
        return;
      }

      const requestId = typeof params.requestId === "string" ? params.requestId : undefined;
      if (!requestId) {
        return;
      }
      const entry = entries.get(requestId);
      if (!entry) {
        return;
      }

      if (method === "Network.responseReceived") {
        const response = (params.response as Record<string, unknown> | undefined) ?? {};
        entry.response.status =
          typeof response.status === "number" ? Math.trunc(response.status) : 0;
        entry.response.statusText =
          typeof response.statusText === "string" ? response.statusText : "";
        entry.response.headers = toHeaders(response.headers);
        entry.response.content.mimeType =
          typeof response.mimeType === "string" ? response.mimeType : "";
        return;
      }

      if (method === "Network.loadingFinished") {
        entry.time = Date.now() - entry.startedAtMs;
        entry.timings.wait = entry.time;
        entry.response.content.size =
          typeof params.encodedDataLength === "number" ? params.encodedDataLength : 0;
        if (options.includeBodies) {
          try {
            const body = await sendCommand<{ body?: string; base64Encoded?: boolean }>(
              "Network.getResponseBody",
              { requestId },
            );
            if (typeof body.body === "string") {
              entry.response.content.text = body.body;
              entry.response.content.encoding = body.base64Encoded ? "base64" : undefined;
            }
          } catch {
            // Some responses do not expose bodies.
          }
        }
        return;
      }

      if (method === "Network.loadingFailed") {
        entry.time = Date.now() - entry.startedAtMs;
        entry.timings.wait = entry.time;
        entry.response.statusText =
          typeof params.errorText === "string" ? params.errorText : "Network loading failed";
      }
    };

    chrome.debugger.onEvent.addListener(onEvent);
    try {
      await sendCommand("Network.enable");
      if (options.reloadFirst) {
        await sendCommand("Page.reload", { ignoreCache: false });
      }
      await new Promise((resolve) => self.setTimeout(resolve, options.durationMs));
    } finally {
      chrome.debugger.onEvent.removeListener(onEvent);
      if (hasPersistentDebuggerWork(getTabAutomationPolicy(options.tabId))) {
        try {
          await applyPersistentDebuggerPolicies(options.tabId);
        } catch {
          // Best effort restoration of persistent policies.
        }
      } else {
        try {
          await sendCommand("Network.disable");
        } catch {
          // Best effort cleanup.
        }
      }
    }

    return orderedIds
      .map((requestId) => entries.get(requestId))
      .filter((entry): entry is HarMutableEntry => Boolean(entry))
      .slice(-options.maxEntries)
      .map(({ startedAtMs: _startedAtMs, ...entry }) => ({
        pageref: "page_1",
        startedDateTime: entry.startedDateTime,
        time: entry.time,
        request: {
          ...entry.request,
          httpVersion: "HTTP/1.1",
          queryString: [],
          cookies: [],
          headersSize: -1,
          bodySize: -1,
        },
        response: {
          ...entry.response,
          httpVersion: "HTTP/1.1",
          cookies: [],
          redirectURL: "",
          headersSize: -1,
          bodySize: entry.response.content.size,
        },
        cache: {},
        timings: entry.timings,
      }));
  });

  const har = {
    log: {
      version: "1.2",
      creator: {
        name: "brave-mcp",
        version: EXTENSION_VERSION,
      },
      pages: [
        {
          startedDateTime: new Date().toISOString(),
          id: "page_1",
          title: pageTitle,
          pageTimings: {},
        },
      ],
      entries: result,
      browser: {
        name: "Brave",
        version: navigator.userAgent,
      },
      comment: pageUrl,
    },
  };

  return {
    mimeType: "application/json" as const,
    harJson: JSON.stringify(har),
    entryCount: result.length,
  };
}

async function executeJavaScript(
  tabId: number,
  options: {
    code: string;
    world: "isolated" | "main";
    awaitPromise: boolean;
  },
) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    ...(options.world === "main" ? { world: "MAIN" as const } : {}),
    func: async (args) => {
      const resultId = "__braveMcpExecuteResult";
      const scriptId = "__braveMcpExecuteScript";
      const deadline = Date.now() + 5_000;

      const existingResult = document.getElementById(resultId);
      existingResult?.remove();
      const existingScript = document.getElementById(scriptId);
      existingScript?.remove();

      const resultNode = document.createElement("script");
      resultNode.id = resultId;
      resultNode.type = "application/json";
      resultNode.dataset.status = "pending";
      resultNode.textContent = "{}";
      (document.documentElement || document.head || document.body).appendChild(resultNode);

      const script = document.createElement("script");
      script.id = scriptId;
      script.textContent = `
        (() => {
          const resultNode = document.getElementById(${JSON.stringify(resultId)});
          const write = (payload, status = "done") => {
            if (!resultNode) return;
            resultNode.dataset.status = status;
            resultNode.textContent = JSON.stringify(payload);
          };
          const serialize = (value) => {
            try {
              return JSON.stringify(value);
            } catch {
              return JSON.stringify(String(value));
            }
          };

          try {
            const raw = (0, eval)(${JSON.stringify(args.code)});
            const finalize = (value) => {
              write({
                resultType: value === null ? "null" : typeof value,
                resultJson: serialize(value),
              });
            };

            if (${args.awaitPromise ? "true" : "false"} && raw && typeof raw === "object" && "then" in raw) {
              Promise.resolve(raw).then(finalize).catch((error) => {
                write({
                  resultType: "error",
                  resultJson: serialize(error instanceof Error ? error.message : String(error)),
                }, "error");
              });
            } else {
              finalize(raw);
            }
          } catch (error) {
            write({
              resultType: "error",
              resultJson: serialize(error instanceof Error ? error.message : String(error)),
            }, "error");
          }
        })();
      `;
      (document.documentElement || document.head || document.body).appendChild(script);
      script.remove();

      while (Date.now() <= deadline) {
        const currentNode = document.getElementById(resultId);
        if (
          currentNode?.dataset.status === "done" ||
          currentNode?.dataset.status === "error"
        ) {
          try {
            const parsed = JSON.parse(currentNode.textContent ?? "{}");
            currentNode.remove();
            return parsed;
          } catch {
            currentNode.remove();
            return {
              resultType: "error",
              resultJson: JSON.stringify("Failed to parse execute_javascript result."),
            };
          }
        }

        await new Promise((resolve) => self.setTimeout(resolve, 25));
      }

      document.getElementById(resultId)?.remove();
      return {
        resultType: "error",
        resultJson: JSON.stringify("Timed out waiting for execute_javascript result."),
      };
    },
    args: [options],
  });

  return {
    resultType:
      typeof result?.result === "object" &&
      result.result !== null &&
      "resultType" in result.result &&
      typeof result.result.resultType === "string"
        ? result.result.resultType
        : "undefined",
    resultJson:
      typeof result?.result === "object" &&
      result.result !== null &&
      "resultJson" in result.result &&
      typeof result.result.resultJson === "string"
        ? result.result.resultJson
        : "null",
  };
}

async function captureScreenshot(
  tabId: number,
  format: "png" | "jpeg",
  quality: number,
) {
  const tab = await chrome.tabs.get(tabId);
  if (typeof tab.windowId !== "number") {
    throw new Error(`No window for tab id: ${String(tabId)}`);
  }

  if (!tab.active) {
    await chrome.tabs.update(tabId, { active: true });
  }

  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format,
    ...(format === "jpeg" ? { quality } : {}),
  });
  const match = /^data:(.+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    throw new Error("Unexpected screenshot data URL format.");
  }

  return {
    mimeType: match[1] ?? `image/${format}`,
    base64: match[2] ?? "",
  };
}

async function getConsoleLogs(
  tabId: number,
  limit: number,
) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (args) => {
      const scriptId = "__braveMcpConsoleRecorderInstall";
      const dataNodeId = "__braveMcpConsoleRecorderData";

      if (!document.getElementById(dataNodeId)) {
        const existingScript = document.getElementById(scriptId);
        if (!existingScript) {
          const script = document.createElement("script");
          script.id = scriptId;
          script.textContent = `
            (() => {
              const dataNodeId = "${dataNodeId}";
              if (document.getElementById(dataNodeId)) return;

              const dataNode = document.createElement("script");
              dataNode.id = dataNodeId;
              dataNode.type = "application/json";
              dataNode.textContent = "[]";
              (document.documentElement || document.head || document.body).appendChild(dataNode);

              const entries = [];
              const serialize = (value) => {
                if (typeof value === "string") return value;
                try { return JSON.stringify(value); } catch { return String(value); }
              };
              const sync = () => {
                dataNode.textContent = JSON.stringify(entries);
              };
              const pushEntry = (level, values) => {
                entries.push({
                  level,
                  text: values.map(serialize).join(" "),
                  timestamp: Date.now(),
                });
                if (entries.length > 500) {
                  entries.splice(0, entries.length - 500);
                }
                sync();
              };

              for (const level of ["log", "info", "warn", "error", "debug"]) {
                const original = console[level].bind(console);
                console[level] = (...values) => {
                  pushEntry(level, values);
                  original(...values);
                };
              }

              window.addEventListener("error", (event) => {
                pushEntry("error", [event.message]);
              });
              window.addEventListener("unhandledrejection", (event) => {
                pushEntry("error", [String(event.reason)]);
              });
              pushEntry("debug", ["__brave_mcp_console_recorder_installed__"]);
            })();
          `;
          (document.documentElement || document.head || document.body).appendChild(script);
          script.remove();
        }
      }

      const dataNode = document.getElementById(dataNodeId);
      if (!dataNode?.textContent) {
        return { entries: [] };
      }

      try {
        const entries = JSON.parse(dataNode.textContent);
        return {
          entries: Array.isArray(entries) ? entries.slice(-args.limit) : [],
        };
      } catch {
        return { entries: [] };
      }
    },
    args: [{ limit }],
  });

  return {
    entries:
      typeof result?.result === "object" &&
      result.result !== null &&
      "entries" in result.result &&
      Array.isArray(result.result.entries)
        ? result.result.entries
        : [],
  };
}

async function pressKey(
  tabId: number,
  key: string,
  modifiers: Array<"Alt" | "Control" | "Meta" | "Shift">,
) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (args) => {
      const target =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : document.body ?? document.documentElement;
      const eventInit = {
        key: args.key,
        bubbles: true,
        cancelable: true,
        altKey: args.modifiers.includes("Alt"),
        ctrlKey: args.modifiers.includes("Control"),
        metaKey: args.modifiers.includes("Meta"),
        shiftKey: args.modifiers.includes("Shift"),
      };

      target.dispatchEvent(new KeyboardEvent("keydown", eventInit));
      target.dispatchEvent(new KeyboardEvent("keyup", eventInit));
      return { pressed: true };
    },
    args: [{ key, modifiers }],
  });

  return {
    pressed:
      typeof result?.result === "object" &&
      result.result !== null &&
      "pressed" in result.result &&
      result.result.pressed === true,
  };
}

async function handleRequest(message: BridgeRequestMessage): Promise<BridgeResponseMessage> {
  try {
    switch (message.method) {
      case "tabs.list":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await listTabs(),
        };
      case "windows.list":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await listWindows(
            message.params.populateTabs !== false,
            Array.isArray(message.params.windowTypes)
              ? message.params.windowTypes.filter(
                  (candidate): candidate is "normal" | "popup" =>
                    candidate === "normal" || candidate === "popup",
                )
              : ["normal", "popup"],
          ),
        };
      case "tabs.getActive":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await getActiveTab(),
        };
      case "tabs.getInfo":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await getTabInfo(Number(message.params.tabId)),
        };
      case "windows.getInfo":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await getWindowInfo(
            Number(message.params.windowId),
            message.params.populateTabs !== false,
          ),
        };
      case "tabs.open":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await openTab(
            String(message.params.url),
            typeof message.params.active === "boolean" ? message.params.active : true,
          ),
        };
      case "windows.create":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await newWindow({
            url: typeof message.params.url === "string" ? message.params.url : undefined,
            focused: message.params.focused !== false,
            incognito: message.params.incognito === true,
            type: message.params.type === "popup" ? "popup" : "normal",
            top: typeof message.params.top === "number" ? message.params.top : undefined,
            left: typeof message.params.left === "number" ? message.params.left : undefined,
            width:
              typeof message.params.width === "number" ? message.params.width : undefined,
            height:
              typeof message.params.height === "number" ? message.params.height : undefined,
          }),
        };
      case "tabs.navigate":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await navigateTab(
            Number(message.params.tabId),
            String(message.params.url),
            resolveWaitUntil(message.params.waitUntil),
            resolveTimeoutMs(message.params.timeoutMs, 15_000),
          ),
        };
      case "tabs.close":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await closeTab(Number(message.params.tabId)),
        };
      case "windows.close":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await closeWindow(Number(message.params.windowId)),
        };
      case "tabs.reload":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await reloadTab(
            Number(message.params.tabId),
            typeof message.params.bypassCache === "boolean"
              ? message.params.bypassCache
              : false,
            resolveWaitUntil(message.params.waitUntil),
            resolveTimeoutMs(message.params.timeoutMs, 15_000),
          ),
        };
      case "tabs.back":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await goBackOrForward(
            "back",
            Number(message.params.tabId),
            resolveWaitUntil(message.params.waitUntil),
            resolveTimeoutMs(message.params.timeoutMs, 15_000),
          ),
        };
      case "tabs.forward":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await goBackOrForward(
            "forward",
            Number(message.params.tabId),
            resolveWaitUntil(message.params.waitUntil),
            resolveTimeoutMs(message.params.timeoutMs, 15_000),
          ),
        };
      case "tabs.waitForNavigation":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await waitForNavigation(
            Number(message.params.tabId),
            resolveWaitUntil(message.params.waitUntil),
            resolveTimeoutMs(message.params.timeoutMs, 15_000),
            typeof message.params.urlIncludes === "string"
              ? message.params.urlIncludes
              : undefined,
          ),
        };
      case "tabs.switch":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await switchToTab({
            tabId:
              typeof message.params.tabId === "number"
                ? message.params.tabId
                : undefined,
            urlIncludes:
              typeof message.params.urlIncludes === "string"
                ? message.params.urlIncludes
                : undefined,
            titleIncludes:
              typeof message.params.titleIncludes === "string"
                ? message.params.titleIncludes
                : undefined,
            windowId:
              typeof message.params.windowId === "number"
                ? message.params.windowId
                : undefined,
          }),
        };
      case "tabs.focus":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await focusTab(Number(message.params.tabId)),
        };
      case "tabs.setViewport":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await setViewport(Number(message.params.tabId), {
            width: Number(message.params.width),
            height: Number(message.params.height),
            left: typeof message.params.left === "number" ? message.params.left : undefined,
            top: typeof message.params.top === "number" ? message.params.top : undefined,
            focused: message.params.focused !== false,
            timeoutMs: resolveTimeoutMs(message.params.timeoutMs, 3_000),
          }),
        };
      case "dom.click":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await clickElement(
            Number(message.params.tabId),
            String(message.params.selector),
            resolveSelectorType(message.params.selectorType),
            resolveTimeoutMs(message.params.timeoutMs, 10_000),
          ),
        };
      case "dom.hover":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await hoverElement(
            Number(message.params.tabId),
            String(message.params.selector),
            resolveSelectorType(message.params.selectorType),
            resolveTimeoutMs(message.params.timeoutMs, 10_000),
          ),
        };
      case "dom.type":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await typeIntoElement(
            Number(message.params.tabId),
            String(message.params.selector),
            resolveSelectorType(message.params.selectorType),
            String(message.params.text),
            message.params.clearFirst === true,
            resolveTimeoutMs(message.params.timeoutMs, 10_000),
          ),
        };
      case "dom.selectOption":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await selectOption(
            Number(message.params.tabId),
            String(message.params.selector),
            resolveSelectorType(message.params.selectorType),
            resolveTimeoutMs(message.params.timeoutMs, 10_000),
            typeof message.params.value === "string" ? message.params.value : undefined,
            typeof message.params.label === "string" ? message.params.label : undefined,
            typeof message.params.index === "number" ? message.params.index : undefined,
          ),
        };
      case "input.pressKey":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await pressKey(
            Number(message.params.tabId),
            String(message.params.key),
            Array.isArray(message.params.modifiers)
              ? message.params.modifiers.filter(
                  (modifier): modifier is "Alt" | "Control" | "Meta" | "Shift" =>
                    modifier === "Alt" ||
                    modifier === "Control" ||
                    modifier === "Meta" ||
                    modifier === "Shift",
                )
              : [],
          ),
        };
      case "dom.queryElements":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await queryElements(
            Number(message.params.tabId),
            String(message.params.selector),
            resolveSelectorType(message.params.selectorType),
            typeof message.params.limit === "number" ? message.params.limit : 25,
          ),
        };
      case "dom.querySelector":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await querySelector(
            Number(message.params.tabId),
            String(message.params.selector),
            resolveSelectorType(message.params.selectorType),
          ),
        };
      case "dom.waitForSelector":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await waitForSelector(
            Number(message.params.tabId),
            String(message.params.selector),
            resolveSelectorType(message.params.selectorType),
            message.params.state === "attached" ? "attached" : "visible",
            resolveTimeoutMs(message.params.timeoutMs, 10_000),
          ),
        };
      case "dom.getVisibleText":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await getVisibleText(
            Number(message.params.tabId),
            typeof message.params.selector === "string" ? message.params.selector : undefined,
            resolveSelectorType(message.params.selectorType),
            typeof message.params.maxChars === "number" ? message.params.maxChars : 12_000,
          ),
        };
      case "dom.getHtml":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await getDom(
            Number(message.params.tabId),
            typeof message.params.selector === "string" ? message.params.selector : undefined,
            resolveSelectorType(message.params.selectorType),
            typeof message.params.maxChars === "number" ? message.params.maxChars : 50_000,
          ),
        };
      case "dom.scrollTo":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await scrollToLocation(Number(message.params.tabId), {
            selector:
              typeof message.params.selector === "string"
                ? message.params.selector
                : undefined,
            selectorType: resolveSelectorType(message.params.selectorType),
            x: typeof message.params.x === "number" ? message.params.x : undefined,
            y: typeof message.params.y === "number" ? message.params.y : undefined,
            behavior: message.params.behavior === "smooth" ? "smooth" : "auto",
            block:
              message.params.block === "start" ||
              message.params.block === "end" ||
              message.params.block === "nearest"
                ? message.params.block
                : "center",
            timeoutMs: resolveTimeoutMs(message.params.timeoutMs, 10_000),
          }),
        };
      case "dom.dragAndDrop":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await dragAndDrop(
            Number(message.params.tabId),
            String(message.params.selector),
            resolveSelectorType(message.params.selectorType),
            String(message.params.targetSelector),
            resolveSelectorType(message.params.targetSelectorType),
            resolveTimeoutMs(message.params.timeoutMs, 10_000),
          ),
        };
      case "dom.uploadFiles":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await uploadFiles(
            Number(message.params.tabId),
            String(message.params.selector),
            resolveSelectorType(message.params.selectorType),
            Array.isArray(message.params.files)
              ? message.params.files
                  .filter(
                    (candidate): candidate is {
                      name: string;
                      mimeType: string;
                      base64: string;
                      lastModified?: number;
                    } =>
                      typeof candidate === "object" &&
                      candidate !== null &&
                      "name" in candidate &&
                      "mimeType" in candidate &&
                      "base64" in candidate &&
                      typeof candidate.name === "string" &&
                      typeof candidate.mimeType === "string" &&
                      typeof candidate.base64 === "string" &&
                      (!("lastModified" in candidate) ||
                        candidate.lastModified === undefined ||
                        typeof candidate.lastModified === "number"),
                  )
              : [],
            resolveTimeoutMs(message.params.timeoutMs, 10_000),
          ),
        };
      case "page.captureScreenshot":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await captureScreenshot(
            Number(message.params.tabId),
            message.params.format === "jpeg" ? "jpeg" : "png",
            typeof message.params.quality === "number" ? message.params.quality : 90,
          ),
        };
      case "page.downloadAsset":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await downloadAsset({
            url: String(message.params.url),
            tabId:
              typeof message.params.tabId === "number"
                ? message.params.tabId
                : undefined,
            timeoutMs: resolveTimeoutMs(message.params.timeoutMs, 15_000),
            maxBytes:
              typeof message.params.maxBytes === "number"
                ? message.params.maxBytes
                : 2_000_000,
          }),
        };
      case "page.capturePdf":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await capturePdf(Number(message.params.tabId), {
            landscape: message.params.landscape === true,
            printBackground: message.params.printBackground === true,
            scale:
              typeof message.params.scale === "number" ? message.params.scale : 1,
            paperWidth:
              typeof message.params.paperWidth === "number"
                ? message.params.paperWidth
                : 8.5,
            paperHeight:
              typeof message.params.paperHeight === "number"
                ? message.params.paperHeight
                : 11,
            marginTop:
              typeof message.params.marginTop === "number" ? message.params.marginTop : 0.4,
            marginBottom:
              typeof message.params.marginBottom === "number"
                ? message.params.marginBottom
                : 0.4,
            marginLeft:
              typeof message.params.marginLeft === "number" ? message.params.marginLeft : 0.4,
            marginRight:
              typeof message.params.marginRight === "number"
                ? message.params.marginRight
                : 0.4,
            pageRanges:
              typeof message.params.pageRanges === "string"
                ? message.params.pageRanges
                : undefined,
            preferCSSPageSize: message.params.preferCSSPageSize === true,
            maxBytes:
              typeof message.params.maxBytes === "number"
                ? message.params.maxBytes
                : 10_000_000,
          }),
        };
      case "page.getConsoleLogs":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await getConsoleLogs(
            Number(message.params.tabId),
            typeof message.params.limit === "number" ? message.params.limit : 100,
          ),
        };
      case "page.networkLog":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await captureNetworkLog(Number(message.params.tabId), {
            durationMs:
              typeof message.params.durationMs === "number"
                ? message.params.durationMs
                : 1_500,
            maxEntries:
              typeof message.params.maxEntries === "number"
                ? message.params.maxEntries
                : 100,
            includeBodies: message.params.includeBodies === true,
            reloadFirst: message.params.reloadFirst === true,
            urlIncludes:
              typeof message.params.urlIncludes === "string"
                ? message.params.urlIncludes
                : undefined,
          }),
        };
      case "storage.cookieAccess":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await accessCookies({
            tabId:
              typeof message.params.tabId === "number"
                ? message.params.tabId
                : undefined,
            url: typeof message.params.url === "string" ? message.params.url : undefined,
            domain:
              typeof message.params.domain === "string"
                ? message.params.domain
                : undefined,
            name: typeof message.params.name === "string" ? message.params.name : undefined,
            path: typeof message.params.path === "string" ? message.params.path : undefined,
            secure:
              typeof message.params.secure === "boolean"
                ? message.params.secure
                : undefined,
            session:
              typeof message.params.session === "boolean"
                ? message.params.session
                : undefined,
            storeId:
              typeof message.params.storeId === "string"
                ? message.params.storeId
                : undefined,
          }),
        };
      case "network.requestIntercept":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await configureRequestInterception({
            tabId: Number(message.params.tabId),
            enabled: message.params.enabled !== false,
            urlPattern:
              typeof message.params.urlPattern === "string"
                ? message.params.urlPattern
                : undefined,
            resourceTypes: Array.isArray(message.params.resourceTypes)
              ? message.params.resourceTypes.filter(
                  (value): value is string => typeof value === "string",
                )
              : undefined,
            action: message.params.action === "fail" ? "fail" : "continue",
            failReason:
              typeof message.params.failReason === "string"
                ? message.params.failReason
                : "BlockedByClient",
            method:
              typeof message.params.method === "string" ? message.params.method : undefined,
            headers: normalizeHeaders(message.params.headers),
            postDataBase64:
              typeof message.params.postDataBase64 === "string"
                ? message.params.postDataBase64
                : undefined,
          }),
        };
      case "network.mockResponse":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await configureMockResponse({
            tabId: Number(message.params.tabId),
            enabled: message.params.enabled !== false,
            urlPattern:
              typeof message.params.urlPattern === "string"
                ? message.params.urlPattern
                : undefined,
            resourceTypes: Array.isArray(message.params.resourceTypes)
              ? message.params.resourceTypes.filter(
                  (value): value is string => typeof value === "string",
                )
              : undefined,
            statusCode:
              typeof message.params.statusCode === "number"
                ? Math.trunc(message.params.statusCode)
                : 200,
            headers: normalizeHeaders(message.params.headers) ?? [],
            bodyBase64:
              typeof message.params.bodyBase64 === "string"
                ? message.params.bodyBase64
                : typeof message.params.bodyText === "string"
                  ? btoa(unescape(encodeURIComponent(message.params.bodyText)))
                  : undefined,
          }),
        };
      case "network.throttle":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await configureNetworkThrottle({
            tabId: Number(message.params.tabId),
            enabled: message.params.enabled !== false,
            offline: message.params.offline === true,
            latencyMs:
              typeof message.params.latencyMs === "number"
                ? message.params.latencyMs
                : 0,
            downloadThroughput:
              typeof message.params.downloadThroughput === "number"
                ? message.params.downloadThroughput
                : -1,
            uploadThroughput:
              typeof message.params.uploadThroughput === "number"
                ? message.params.uploadThroughput
                : -1,
            connectionType:
              typeof message.params.connectionType === "string"
                ? message.params.connectionType
                : undefined,
          }),
        };
      case "storage.clear":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await clearStorageForTarget({
            tabId:
              typeof message.params.tabId === "number" ? message.params.tabId : undefined,
            url: typeof message.params.url === "string" ? message.params.url : undefined,
            clearCookies: message.params.clearCookies !== false,
            clearLocalStorage: message.params.clearLocalStorage !== false,
            clearSessionStorage: message.params.clearSessionStorage !== false,
            clearIndexedDb: message.params.clearIndexedDb !== false,
            clearCacheStorage: message.params.clearCacheStorage !== false,
            clearServiceWorkers: message.params.clearServiceWorkers === true,
          }),
        };
      case "session.export":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await exportSession({
            tabId: Number(message.params.tabId),
            includeCookies: message.params.includeCookies !== false,
            includeLocalStorage: message.params.includeLocalStorage !== false,
            includeSessionStorage: message.params.includeSessionStorage !== false,
            includeHtml: message.params.includeHtml === true,
            maxHtmlChars:
              typeof message.params.maxHtmlChars === "number"
                ? Math.trunc(message.params.maxHtmlChars)
                : 20_000,
          }),
        };
      case "page.setUserAgent":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await configureUserAgentOverride({
            tabId: Number(message.params.tabId),
            enabled: message.params.enabled !== false,
            userAgent:
              typeof message.params.userAgent === "string"
                ? message.params.userAgent
                : undefined,
            acceptLanguage:
              typeof message.params.acceptLanguage === "string"
                ? message.params.acceptLanguage
                : undefined,
            platform:
              typeof message.params.platform === "string"
                ? message.params.platform
                : undefined,
          }),
        };
      case "page.emulateMedia":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await configureMediaEmulation({
            tabId: Number(message.params.tabId),
            enabled: message.params.enabled !== false,
            media:
              typeof message.params.media === "string" ? message.params.media : "screen",
            features: Array.isArray(message.params.features)
              ? message.params.features
                  .filter(
                    (value): value is { name: string; value: string } =>
                      typeof value === "object" &&
                      value !== null &&
                      "name" in value &&
                      "value" in value &&
                      typeof value.name === "string" &&
                      typeof value.value === "string",
                  )
                  .map((value) => ({
                    name: value.name,
                    value: value.value,
                  }))
              : [],
          }),
        };
      case "page.geolocationOverride":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await configureGeolocationOverride({
            tabId: Number(message.params.tabId),
            enabled: message.params.enabled !== false,
            latitude:
              typeof message.params.latitude === "number"
                ? message.params.latitude
                : undefined,
            longitude:
              typeof message.params.longitude === "number"
                ? message.params.longitude
                : undefined,
            accuracy:
              typeof message.params.accuracy === "number" ? message.params.accuracy : 10,
            altitude:
              typeof message.params.altitude === "number"
                ? message.params.altitude
                : undefined,
            altitudeAccuracy:
              typeof message.params.altitudeAccuracy === "number"
                ? message.params.altitudeAccuracy
                : undefined,
            heading:
              typeof message.params.heading === "number"
                ? message.params.heading
                : undefined,
            speed:
              typeof message.params.speed === "number" ? message.params.speed : undefined,
          }),
        };
      case "browser.grantPermissions":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await grantPermissions({
            tabId:
              typeof message.params.tabId === "number" ? message.params.tabId : undefined,
            url: typeof message.params.url === "string" ? message.params.url : undefined,
            permissions: Array.isArray(message.params.permissions)
              ? message.params.permissions.filter(
                  (
                    value,
                  ): value is "geolocation" | "notifications" | "microphone" | "camera" =>
                    value === "geolocation" ||
                    value === "notifications" ||
                    value === "microphone" ||
                    value === "camera",
                )
              : [],
            setting:
              message.params.setting === "block" || message.params.setting === "ask"
                ? message.params.setting
                : "allow",
          }),
        };
      case "page.exportHar":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await exportHar({
            tabId: Number(message.params.tabId),
            durationMs:
              typeof message.params.durationMs === "number"
                ? message.params.durationMs
                : 1_500,
            reloadFirst: message.params.reloadFirst === true,
            includeBodies: message.params.includeBodies === true,
            maxEntries:
              typeof message.params.maxEntries === "number" ? message.params.maxEntries : 100,
            urlIncludes:
              typeof message.params.urlIncludes === "string"
                ? message.params.urlIncludes
                : undefined,
          }),
        };
      case "page.waitForIdle":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await waitForIdle(
            Number(message.params.tabId),
            typeof message.params.idleMs === "number" ? message.params.idleMs : 500,
            resolveTimeoutMs(message.params.timeoutMs, 10_000),
          ),
        };
      case "page.executeJavaScript":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await executeJavaScript(Number(message.params.tabId), {
            code: String(message.params.code),
            world: message.params.world === "main" ? "main" : "isolated",
            awaitPromise: message.params.awaitPromise !== false,
          }),
        };
      case "dom.elementsFromPoint":
        return {
          type: "response",
          id: message.id,
          ok: true,
          result: await elementsFromPoint(
            Number(message.params.tabId),
            Number(message.params.x),
            Number(message.params.y),
            typeof message.params.limit === "number" ? message.params.limit : 10,
          ),
        };
      default:
        return {
          type: "response",
          id: message.id,
          ok: false,
          error: {
            code: "BRAVE_EXTENSION_OFFLINE",
            message: `Method ${message.method} is not implemented in the extension yet.`,
            retryable: true,
          },
        };
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown extension error.";
    const code = /No tab with id|tabs cannot be edited right now/i.test(errorMessage)
      ? "BRAVE_TAB_NOT_FOUND"
      : /Cannot access contents of url/i.test(errorMessage)
        ? "BRAVE_PERMISSION_DENIED"
        : "BRAVE_INTERNAL_ERROR";
    return {
      type: "response",
      id: message.id,
      ok: false,
      error: {
        code,
        message: errorMessage,
        retryable: false,
      },
    };
  }
}

async function markDisconnected(
  settings: ExtensionSettings,
  reason: string | null,
): Promise<void> {
  bridgeState = "disconnected";
  lastError = reason;
  await persistBridgeStatus(settings);

  if (settings.authToken) {
    await ensureReconnectAlarm();
  } else {
    await clearReconnectAlarm();
  }
}

async function connectBridge(forceReconnect = false): Promise<void> {
  const settings = await loadSettings();
  if (!settings.authToken) {
    socket?.close();
    socket = null;
    await markDisconnected(settings, "Auth token is not configured.");
    return;
  }

  if (!forceReconnect && socket && socket.readyState === WebSocket.OPEN) {
    return;
  }

  if (!forceReconnect && socket && socket.readyState === WebSocket.CONNECTING) {
    return;
  }

  socket?.close();
  bridgeState = "connecting";
  lastAttemptAt = nowIso();
  lastError = null;
  await persistBridgeStatus(settings);
  const nextSocket = new WebSocket(withAuth(settings.daemonUrl, settings.authToken));
  socket = nextSocket;

  nextSocket.addEventListener("open", () => {
    if (!isLiveSocket(nextSocket)) {
      nextSocket.close();
      return;
    }

    bridgeState = "connected";
    lastConnectedAt = nowIso();
    lastError = null;
    safeSend(nextSocket, {
      type: "hello",
      browser: "brave",
      version: EXTENSION_VERSION,
    });
    void clearReconnectAlarm();
    void persistBridgeStatus(settings);
  });

  nextSocket.addEventListener("message", (event) => {
    void (async () => {
      try {
        const parsed = bridgeRequestMessageSchema.parse(JSON.parse(String(event.data)));
        const response = await handleRequest(parsed);
        safeSend(nextSocket, response);
      } catch (error) {
        console.error("Failed to handle bridge request", error);
      }
    })();
  });

  nextSocket.addEventListener("close", () => {
    if (!isLiveSocket(nextSocket)) {
      return;
    }

    socket = null;
    void markDisconnected(settings, lastError ?? "Connection closed.");
  });

  nextSocket.addEventListener("error", () => {
    if (!isLiveSocket(nextSocket)) {
      return;
    }

    lastError = "WebSocket error while connecting to the daemon.";
    nextSocket.close();
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== RECONNECT_ALARM_NAME) {
    return;
  }

  void connectBridge();
});

chrome.runtime.onStartup.addListener(() => {
  void connectBridge();
});

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (method !== "Fetch.requestPaused" || !params || typeof params !== "object") {
    return;
  }

  void handlePausedRequest(source, params as Record<string, unknown>).catch((error) => {
    console.error("Failed to handle paused request", error);
  });
});

chrome.debugger.onDetach.addListener((source) => {
  if (typeof source.tabId !== "number") {
    return;
  }

  const state = tabAutomationState.get(source.tabId);
  if (!state) {
    return;
  }

  state.debuggerAttached = false;
  state.fetchEnabled = false;
  state.networkEnabled = false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabAutomationState.delete(tabId);
});

chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId !== 0) {
    return;
  }
  const state = tabAutomationState.get(details.tabId);
  if (!state?.geolocationOverride?.enabled) {
    return;
  }
  void syncGeolocationShim(details.tabId);
});

chrome.runtime.onInstalled.addListener(() => {
  void connectBridge();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if ("daemonUrl" in changes || "authToken" in changes) {
    void connectBridge(true);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object" || !("type" in message)) {
    return false;
  }

  if (message.type === "get-bridge-status") {
    void (async () => {
      sendResponse(await persistBridgeStatus());
    })();
    return true;
  }

  if (message.type === "reconnect-bridge") {
    void (async () => {
      await connectBridge(true);
      sendResponse(await persistBridgeStatus());
    })();
    return true;
  }

  return false;
});

void connectBridge();
