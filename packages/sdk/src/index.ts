import WebSocket, { type RawData } from "ws";

import {
  backOutputSchema,
  bridgeRequestMessageSchema,
  capturePdfOutputSchema,
  emulateMediaOutputSchema,
  clearStorageOutputSchema,
  clickOutputSchema,
  closeWindowOutputSchema,
  cookieAccessOutputSchema,
  downloadAssetOutputSchema,
  getConsoleLogsOutputSchema,
  getDomOutputSchema,
  getVisibleTextOutputSchema,
  getTabInfoOutputSchema,
  getWindowInfoOutputSchema,
  grantPermissionsOutputSchema,
  harExportOutputSchema,
  closeTabOutputSchema,
  listWindowsOutputSchema,
  elementsFromPointOutputSchema,
  executeJavaScriptOutputSchema,
  focusTabOutputSchema,
  forwardOutputSchema,
  hoverOutputSchema,
  mockResponseOutputSchema,
  navigateOutputSchema,
  newWindowOutputSchema,
  requestInterceptOutputSchema,
  openTabOutputSchema,
  pressKeyOutputSchema,
  querySelectorOutputSchema,
  queryElementsOutputSchema,
  reloadTabOutputSchema,
  setUserAgentOutputSchema,
  sessionExportOutputSchema,
  captureScreenshotOutputSchema,
  dragAndDropOutputSchema,
  setViewportOutputSchema,
  selectOptionOutputSchema,
  scrollToOutputSchema,
  switchToTabOutputSchema,
  throttleNetworkOutputSchema,
  typeTextOutputSchema,
  uploadFileOutputSchema,
  waitForIdleOutputSchema,
  waitForSelectorOutputSchema,
  waitForNavigationOutputSchema,
  type BridgeResponseMessage,
  type Tab,
} from "@brave-mcp/protocol";

export interface SimulatedExtensionBridgeOptions {
  daemonUrl: string;
  authToken: string;
  tabs?: Tab[];
}

export interface SimulatedExtensionBridge {
  close(): Promise<void>;
}

const defaultTabs: Tab[] = [
  {
    tabId: 201,
    windowId: 1,
    title: "Simulated Bridge Tab",
    url: "https://example.test/simulated",
    active: true,
  },
];

function withAuth(url: string, authToken: string): string {
  const resolved = new URL(url);
  resolved.searchParams.set("authToken", authToken);
  return resolved.toString();
}

export async function connectSimulatedExtensionBridge(
  options: SimulatedExtensionBridgeOptions,
): Promise<SimulatedExtensionBridge> {
  const tabs = [...(options.tabs ?? defaultTabs)];
  const historyByTabId = new Map<number, { entries: string[]; index: number }>(
    tabs.map((tab) => [
      tab.tabId,
      {
        entries: [tab.url],
        index: 0,
      },
    ]),
  );
  let nextTabId = Math.max(0, ...tabs.map((tab) => tab.tabId)) + 1;
  const socket = new WebSocket(withAuth(options.daemonUrl, options.authToken));

  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => {
      socket.send(
        JSON.stringify({
              type: "hello",
              browser: "brave",
              version: "0.11.0",
            }),
      );
      resolve();
    });
    socket.once("error", reject);
  });

  socket.on("message", (raw: RawData) => {
    const message = bridgeRequestMessageSchema.parse(JSON.parse(raw.toString()));
    let response: BridgeResponseMessage;
    switch (message.method) {
      case "tabs.list":
        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: {
            tabs,
          },
        };
        break;
      case "windows.list":
        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: listWindowsOutputSchema.parse({
            windows: Array.from(new Set(tabs.map((tab) => tab.windowId))).map((windowId) => ({
              windowId,
              focused: tabs.some((tab) => tab.windowId === windowId && tab.active),
              incognito: false,
              type: "normal",
              width: 1280,
              height: 900,
              tabIds: tabs.filter((tab) => tab.windowId === windowId).map((tab) => tab.tabId),
            })),
          }),
        };
        break;
      case "tabs.getActive":
        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: {
            tab: tabs.find((tab) => tab.active) ?? tabs[0],
          },
        };
        break;
      case "tabs.getInfo": {
        const tab = tabs.find((candidate) => candidate.tabId === Number(message.params.tabId));
        if (!tab) {
          response = {
            type: "response",
            id: message.id,
            ok: false,
            error: {
              code: "BRAVE_TAB_NOT_FOUND",
              message: `No tab with id: ${String(message.params.tabId)}`,
              retryable: false,
            },
          };
          break;
        }

        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: getTabInfoOutputSchema.parse({
            tab: {
              ...tab,
              status: "complete",
              audible: false,
              discarded: false,
              pinned: false,
              incognito: false,
            },
          }),
        };
        break;
      }
      case "windows.getInfo": {
        const windowId = Number(message.params.windowId);
        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: getWindowInfoOutputSchema.parse({
            window: {
              windowId,
              focused: tabs.some((tab) => tab.windowId === windowId && tab.active),
              incognito: false,
              type: "normal",
              width: 1280,
              height: 900,
              tabIds: tabs.filter((tab) => tab.windowId === windowId).map((tab) => tab.tabId),
            },
          }),
        };
        break;
      }
      case "tabs.open": {
        const createdTab = {
          tabId: nextTabId,
          windowId: tabs[0]?.windowId ?? 1,
          title: String(message.params.url),
          url: String(message.params.url),
          active:
            typeof message.params.active === "boolean" ? message.params.active : true,
        };
        nextTabId += 1;

        if (createdTab.active) {
          for (const tab of tabs) {
            tab.active = false;
          }
        }

        tabs.push(createdTab);
        historyByTabId.set(createdTab.tabId, {
          entries: [createdTab.url],
          index: 0,
        });
        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: openTabOutputSchema.parse({
            tabId: createdTab.tabId,
          }),
        };
        break;
      }
      case "windows.create": {
        const createdTab = {
          tabId: nextTabId,
          windowId: Math.max(1, ...tabs.map((tab) => tab.windowId)) + 1,
          title: String(message.params.url ?? "about:blank"),
          url: String(message.params.url ?? "about:blank"),
          active: true,
        };
        nextTabId += 1;
        tabs.push(createdTab);
        historyByTabId.set(createdTab.tabId, {
          entries: [createdTab.url],
          index: 0,
        });
        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: newWindowOutputSchema.parse({
            window: {
              windowId: createdTab.windowId,
              focused: message.params.focused !== false,
              incognito: message.params.incognito === true,
              type: message.params.type === "popup" ? "popup" : "normal",
              left:
                typeof message.params.left === "number" ? message.params.left : undefined,
              top:
                typeof message.params.top === "number" ? message.params.top : undefined,
              width:
                typeof message.params.width === "number" ? message.params.width : 1280,
              height:
                typeof message.params.height === "number" ? message.params.height : 900,
              tabIds: [createdTab.tabId],
            },
            tab: createdTab,
          }),
        };
        break;
      }
      case "tabs.navigate": {
        const tab = tabs.find((candidate) => candidate.tabId === Number(message.params.tabId));
        if (!tab) {
          response = {
            type: "response",
            id: message.id,
            ok: false,
            error: {
              code: "BRAVE_TAB_NOT_FOUND",
              message: `No tab with id: ${String(message.params.tabId)}`,
              retryable: false,
            },
          };
          break;
        }

        tab.url = String(message.params.url);
        tab.title = String(message.params.url);
        const history = historyByTabId.get(tab.tabId);
        if (history) {
          history.entries = history.entries.slice(0, history.index + 1);
          history.entries.push(tab.url);
          history.index = history.entries.length - 1;
        }
        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: navigateOutputSchema.parse({
            url: tab.url,
            status: "ok",
          }),
        };
        break;
      }
      case "tabs.close": {
        const index = tabs.findIndex((candidate) => candidate.tabId === Number(message.params.tabId));
        if (index === -1) {
          response = {
            type: "response",
            id: message.id,
            ok: false,
            error: {
              code: "BRAVE_TAB_NOT_FOUND",
              message: `No tab with id: ${String(message.params.tabId)}`,
              retryable: false,
            },
          };
          break;
        }

        const [removed] = tabs.splice(index, 1);
        if (removed) {
          historyByTabId.delete(removed.tabId);
        }
        if (!tabs.some((tab) => tab.active) && tabs[0]) {
          tabs[0].active = true;
        }

        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: closeTabOutputSchema.parse({
            closed: true,
          }),
        };
        break;
      }
      case "windows.close":
        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: closeWindowOutputSchema.parse({
            closed: true,
          }),
        };
        break;
      case "tabs.reload":
        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: reloadTabOutputSchema.parse({
            status: "ok",
          }),
        };
        break;
      case "tabs.back":
      case "tabs.forward": {
        const tab = tabs.find((candidate) => candidate.tabId === Number(message.params.tabId));
        const history = tab ? historyByTabId.get(tab.tabId) : undefined;
        if (!tab || !history) {
          response = {
            type: "response",
            id: message.id,
            ok: false,
            error: {
              code: "BRAVE_TAB_NOT_FOUND",
              message: `No tab with id: ${String(message.params.tabId)}`,
              retryable: false,
            },
          };
          break;
        }

        if (message.method === "tabs.back" && history.index > 0) {
          history.index -= 1;
        }
        if (message.method === "tabs.forward" && history.index < history.entries.length - 1) {
          history.index += 1;
        }

        tab.url = history.entries[history.index] ?? tab.url;
        tab.title = tab.url;
        const schema = message.method === "tabs.back" ? backOutputSchema : forwardOutputSchema;
        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: schema.parse({
            url: tab.url,
            status: "ok",
          }),
        };
        break;
      }
      case "tabs.waitForNavigation": {
        const tab = tabs.find((candidate) => candidate.tabId === Number(message.params.tabId));
        if (!tab) {
          response = {
            type: "response",
            id: message.id,
            ok: false,
            error: {
              code: "BRAVE_TAB_NOT_FOUND",
              message: `No tab with id: ${String(message.params.tabId)}`,
              retryable: false,
            },
          };
          break;
        }

        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: waitForNavigationOutputSchema.parse({
            url: tab.url,
            status: "ok",
          }),
        };
        break;
      }
      case "tabs.switch": {
        let tab = typeof message.params.tabId === "number"
          ? tabs.find((candidate) => candidate.tabId === message.params.tabId)
          : undefined;

        if (!tab) {
          tab = tabs.find((candidate) => {
            const urlMatches =
              typeof message.params.urlIncludes === "string"
                ? candidate.url.includes(message.params.urlIncludes)
                : true;
            const titleMatches =
              typeof message.params.titleIncludes === "string"
                ? candidate.title.includes(message.params.titleIncludes)
                : true;
            const windowMatches =
              typeof message.params.windowId === "number"
                ? candidate.windowId === message.params.windowId
                : true;
            return urlMatches && titleMatches && windowMatches;
          });
        }

        if (!tab) {
          response = {
            type: "response",
            id: message.id,
            ok: false,
            error: {
              code: "BRAVE_TAB_NOT_FOUND",
              message: "No tab matched the switch_to_tab criteria.",
              retryable: false,
            },
          };
          break;
        }

        for (const candidate of tabs) {
          candidate.active = candidate.tabId === tab.tabId;
        }

        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: switchToTabOutputSchema.parse({
            tab,
          }),
        };
        break;
      }
      case "tabs.focus": {
        const tab = tabs.find((candidate) => candidate.tabId === Number(message.params.tabId));
        if (!tab) {
          response = {
            type: "response",
            id: message.id,
            ok: false,
            error: {
              code: "BRAVE_TAB_NOT_FOUND",
              message: `No tab with id: ${String(message.params.tabId)}`,
              retryable: false,
            },
          };
          break;
        }

        for (const candidate of tabs) {
          candidate.active = candidate.tabId === tab.tabId;
        }

        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: focusTabOutputSchema.parse({
            tab,
          }),
        };
        break;
      }
      case "tabs.setViewport": {
        const tab = tabs.find((candidate) => candidate.tabId === Number(message.params.tabId));
        if (!tab) {
          response = {
            type: "response",
            id: message.id,
            ok: false,
            error: {
              code: "BRAVE_TAB_NOT_FOUND",
              message: `No tab with id: ${String(message.params.tabId)}`,
              retryable: false,
            },
          };
          break;
        }

        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: setViewportOutputSchema.parse({
            windowId: tab.windowId,
            viewportWidth:
              typeof message.params.width === "number" ? message.params.width - 16 : 1264,
            viewportHeight:
              typeof message.params.height === "number" ? message.params.height - 88 : 812,
          }),
        };
        break;
      }
      case "dom.click":
        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: clickOutputSchema.parse({
            clicked: true,
          }),
        };
        break;
      case "dom.hover":
        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: hoverOutputSchema.parse({
            hovered: true,
          }),
        };
        break;
      case "dom.type":
        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: typeTextOutputSchema.parse({
            typed: true,
          }),
        };
        break;
      case "dom.selectOption":
        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: selectOptionOutputSchema.parse({
            selected: true,
          }),
        };
        break;
      case "input.pressKey":
        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: pressKeyOutputSchema.parse({
            pressed: true,
          }),
        };
        break;
      case "dom.queryElements":
        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: queryElementsOutputSchema.parse({
            count: 1,
            elements: [
              {
                tagName: "a",
                text: tabs.find((tab) => tab.tabId === Number(message.params.tabId))?.title,
                href: tabs.find((tab) => tab.tabId === Number(message.params.tabId))?.url,
                visible: true,
              },
            ],
          }),
        };
        break;
      case "dom.querySelector":
        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: querySelectorOutputSchema.parse({
            found: true,
            element: {
              tagName: "a",
              text: tabs.find((tab) => tab.tabId === Number(message.params.tabId))?.title,
              href: tabs.find((tab) => tab.tabId === Number(message.params.tabId))?.url,
              visible: true,
            },
          }),
        };
        break;
      case "dom.waitForSelector":
        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: waitForSelectorOutputSchema.parse({
            found: true,
          }),
        };
        break;
      case "dom.getVisibleText":
        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: getVisibleTextOutputSchema.parse({
            text:
              tabs.find((tab) => tab.tabId === Number(message.params.tabId))?.title ??
              "Simulated visible text",
          }),
        };
        break;
      case "dom.getHtml":
        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: getDomOutputSchema.parse({
            html: "<html><body><h1>Simulated DOM</h1></body></html>",
          }),
        };
        break;
      case "dom.scrollTo":
        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: scrollToOutputSchema.parse({
            scrolled: true,
            x: typeof message.params.x === "number" ? message.params.x : 0,
            y: typeof message.params.y === "number" ? message.params.y : 250,
          }),
        };
        break;
      case "dom.dragAndDrop":
        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: dragAndDropOutputSchema.parse({
            dropped: true,
          }),
        };
        break;
      case "dom.uploadFiles":
        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: uploadFileOutputSchema.parse({
            uploaded: true,
            fileCount: Array.isArray(message.params.files) ? message.params.files.length : 0,
          }),
        };
        break;
      case "page.captureScreenshot":
        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: captureScreenshotOutputSchema.parse({
            mimeType: "image/png",
            base64: "c2ltdWxhdGVkLXNjcmVlbnNob3Q=",
          }),
        };
        break;
      case "page.downloadAsset":
        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: downloadAssetOutputSchema.parse({
            finalUrl: String(message.params.url),
            mimeType: "text/plain",
            base64: "c2ltdWxhdGVkLWFzc2V0",
            sizeBytes: 15,
            status: "ok",
          }),
        };
        break;
      case "page.capturePdf":
        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: capturePdfOutputSchema.parse({
            mimeType: "application/pdf",
            base64: "JVBERi0xLjQKJXNpbXVsYXRlZC1wZGY=",
            sizeBytes: 23,
            status: "ok",
          }),
        };
        break;
      case "dom.elementsFromPoint":
        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: elementsFromPointOutputSchema.parse({
            count: 2,
            elements: [
              {
                tagName: "button",
                text: "Simulated button",
                visible: true,
              },
              {
                tagName: "div",
                text: "Simulated container",
                visible: true,
              },
            ],
          }),
        };
        break;
      case "page.getConsoleLogs":
        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: getConsoleLogsOutputSchema.parse({
            entries: [
              {
                level: "log",
                text: "simulated console log",
                timestamp: Date.now(),
              },
            ],
          }),
        };
        break;
      case "page.networkLog":
        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: {
            entries: [
              {
                requestId: "sim-1",
                url: "https://example.test/api",
                method: "GET",
                type: "Fetch",
                status: 200,
                mimeType: "application/json",
                encodedDataLength: 128,
              },
            ],
          },
        };
        break;
      case "storage.cookieAccess":
        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: cookieAccessOutputSchema.parse({
            cookies: [
              {
                name: "session",
                value: "simulated",
                domain: "example.test",
                path: "/",
                secure: true,
                httpOnly: true,
                session: false,
                sameSite: "lax",
                storeId: "0",
              },
            ],
          }),
        };
        break;
      case "network.requestIntercept":
        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: requestInterceptOutputSchema.parse({
            configured: message.params.enabled !== false,
            activeRules: message.params.enabled === false ? 0 : 1,
          }),
        };
        break;
      case "network.mockResponse":
        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: mockResponseOutputSchema.parse({
            configured: message.params.enabled !== false,
            activeRules: message.params.enabled === false ? 0 : 1,
          }),
        };
        break;
      case "network.throttle":
        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: throttleNetworkOutputSchema.parse({
            enabled: message.params.enabled !== false,
            offline: message.params.offline === true,
            latencyMs:
              typeof message.params.latencyMs === "number" ? message.params.latencyMs : 0,
            downloadThroughput:
              typeof message.params.downloadThroughput === "number"
                ? message.params.downloadThroughput
                : -1,
            uploadThroughput:
              typeof message.params.uploadThroughput === "number"
                ? message.params.uploadThroughput
                : -1,
          }),
        };
        break;
      case "storage.clear":
        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: clearStorageOutputSchema.parse({
            origin: "https://example.test",
            clearedCookies: 1,
            clearedStorageTypes: ["indexeddb", "cache_storage", "local_storage"],
            localStorageCleared: true,
            sessionStorageCleared: true,
          }),
        };
        break;
      case "session.export":
        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: sessionExportOutputSchema.parse({
            url: "https://example.test/session",
            title: "Simulated Session",
            cookies: [
              {
                name: "session",
                value: "simulated",
                domain: "example.test",
                path: "/",
                secure: true,
                httpOnly: true,
                session: false,
                sameSite: "lax",
                storeId: "0",
              },
            ],
            localStorage: {
              theme: "dark",
            },
            sessionStorage: {
              draft: "hello",
            },
            historyLength: 2,
            html: "<html><body>Simulated Session</body></html>",
          }),
        };
        break;
      case "page.setUserAgent":
        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: setUserAgentOutputSchema.parse({
            enabled: message.params.enabled !== false,
            userAgent:
              typeof message.params.userAgent === "string"
                ? message.params.userAgent
                : "SimulatedAgent/0.11.0",
            acceptLanguage:
              typeof message.params.acceptLanguage === "string"
                ? message.params.acceptLanguage
                : "en-US",
            platform:
              typeof message.params.platform === "string" ? message.params.platform : "macOS",
          }),
        };
        break;
      case "page.emulateMedia":
        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: emulateMediaOutputSchema.parse({
            enabled: message.params.enabled !== false,
            media: typeof message.params.media === "string" ? message.params.media : "screen",
            featureCount: Array.isArray(message.params.features)
              ? message.params.features.length
              : 0,
          }),
        };
        break;
      case "browser.grantPermissions":
        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: grantPermissionsOutputSchema.parse({
            origin: "https://example.test",
            setting:
              message.params.setting === "block" || message.params.setting === "ask"
                ? message.params.setting
                : "allow",
            appliedPermissions: Array.isArray(message.params.permissions)
              ? message.params.permissions.filter(
                  (value): value is "geolocation" | "notifications" | "microphone" | "camera" =>
                    value === "geolocation" ||
                    value === "notifications" ||
                    value === "microphone" ||
                    value === "camera",
                )
              : [],
          }),
        };
        break;
      case "page.exportHar":
        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: harExportOutputSchema.parse({
            mimeType: "application/json",
            harJson: JSON.stringify({
              log: {
                version: "1.2",
                creator: {
                  name: "brave-mcp",
                  version: "0.11.0",
                },
                entries: [
                  {
                    request: { url: "https://example.test/api" },
                    response: { status: 200 },
                  },
                ],
              },
            }),
            entryCount: 1,
          }),
        };
        break;
      case "page.waitForIdle":
        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: waitForIdleOutputSchema.parse({
            idle: true,
            status: "ok",
          }),
        };
        break;
      case "page.executeJavaScript":
        response = {
          type: "response",
          id: message.id,
          ok: true,
          result: executeJavaScriptOutputSchema.parse({
            resultType: "string",
            resultJson: "\"simulated execute_javascript result\"",
          }),
        };
        break;
      default:
        response = {
          type: "response",
          id: message.id,
          ok: false,
          error: {
            code: "BRAVE_EXTENSION_OFFLINE",
            message: `Method ${message.method} is not implemented by the simulated extension.`,
            retryable: true,
          },
        };
        break;
    }

    socket.send(JSON.stringify(response));
  });

  return {
    async close() {
      await new Promise<void>((resolve) => {
        socket.once("close", () => resolve());
        socket.close();
      });
    },
  };
}
