import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  backOutputSchema,
  capturePdfOutputSchema,
  captureScreenshotOutputSchema,
  clearStorageOutputSchema,
  clickOutputSchema,
  closeTabOutputSchema,
  closeWindowOutputSchema,
  cookieAccessOutputSchema,
  downloadAssetOutputSchema,
  dragAndDropOutputSchema,
  emulateMediaOutputSchema,
  executeJavaScriptOutputSchema,
  focusTabOutputSchema,
  forwardOutputSchema,
  getConsoleLogsOutputSchema,
  getActiveTabOutputSchema,
  getDomOutputSchema,
  getTabInfoOutputSchema,
  getVisibleTextOutputSchema,
  getWindowInfoOutputSchema,
  grantPermissionsOutputSchema,
  harExportOutputSchema,
  hoverOutputSchema,
  listWindowsOutputSchema,
  listTabsOutputSchema,
  mockResponseOutputSchema,
  networkLogOutputSchema,
  newWindowOutputSchema,
  pressKeyOutputSchema,
  elementsFromPointOutputSchema,
  querySelectorOutputSchema,
  queryElementsOutputSchema,
  reloadTabOutputSchema,
  requestInterceptOutputSchema,
  sessionExportOutputSchema,
  setUserAgentOutputSchema,
  setViewportOutputSchema,
  scrollToOutputSchema,
  selectOptionOutputSchema,
  switchToTabOutputSchema,
  throttleNetworkOutputSchema,
  typeTextOutputSchema,
  uploadFileOutputSchema,
  waitForIdleOutputSchema,
  waitForSelectorOutputSchema,
  waitForNavigationOutputSchema,
} from "@brave-mcp/protocol";
import { connectSimulatedExtensionBridge } from "@brave-mcp/sdk";

import { DaemonClient } from "./daemon-client.js";
import { handleToolCall, implementedTools } from "./tools.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address !== "object") {
        reject(new Error("Expected a bound server address"));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
}

async function waitForHealth(baseUrl: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry while the daemon is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error("Timed out waiting for the daemon health endpoint");
}

async function main(): Promise<void> {
  const tempConfigDir = await mkdtemp(join(tmpdir(), "brave-mcp-mcp-"));
  const port = await getFreePort();
  const daemonEntryPath = fileURLToPath(
    new URL("../../daemon/dist/index.js", import.meta.url),
  );
  const daemonProcess = spawn(
    process.execPath,
    [daemonEntryPath, "--port", String(port), "--config-dir", tempConfigDir, "--silent"],
    {
      stdio: "ignore",
    },
  );

  try {
    await waitForHealth(`http://127.0.0.1:${port}`);

    const daemonConfigRaw = await readFile(
      join(tempConfigDir, "daemon-config.json"),
      "utf8",
    );
    const daemonConfig = JSON.parse(daemonConfigRaw) as { secret: string };
    const simulatedBridge = await connectSimulatedExtensionBridge({
      daemonUrl: `ws://127.0.0.1:${port}/extension/connect`,
      authToken: daemonConfig.secret,
      tabs: [
        {
          tabId: 401,
          windowId: 9,
          title: "MCP Verified Tab",
          url: "https://example.test/mcp",
          active: true,
        },
      ],
    });
    const client = new DaemonClient({
      daemonUrl: `http://127.0.0.1:${port}`,
      authToken: daemonConfig.secret,
    });

    const tabs = listTabsOutputSchema.parse(
      await handleToolCall(client, "list_tabs", {}),
    );
    const windows = listWindowsOutputSchema.parse(
      await handleToolCall(client, "list_windows", {}),
    );
    const activeTab = getActiveTabOutputSchema.parse(
      await handleToolCall(client, "get_active_tab", {}),
    );
    const activeTabInfo = getTabInfoOutputSchema.parse(
      await handleToolCall(client, "get_tab_info", {
        tabId: activeTab.tab.tabId,
      }),
    );
    const windowInfo = getWindowInfoOutputSchema.parse(
      await handleToolCall(client, "get_window_info", {
        windowId: activeTab.tab.windowId,
        populateTabs: true,
      }),
    );
    const openedTab = await handleToolCall(client, "open_tab", {
      url: "https://example.test/opened-via-mcp",
      active: true,
    });
    const newWindowResult = newWindowOutputSchema.parse(
      await handleToolCall(client, "new_window", {
        url: "https://example.test/window-via-mcp",
        focused: true,
        type: "normal",
        width: 1200,
        height: 900,
      }),
    );
    const navigationResult = await handleToolCall(client, "navigate", {
      tabId: (openedTab as { tabId: number }).tabId,
      url: "https://example.test/navigated-via-mcp",
      waitUntil: "load",
      timeoutMs: 1000,
    });
    const reloadResult = reloadTabOutputSchema.parse(
      await handleToolCall(client, "reload_tab", {
        tabId: (openedTab as { tabId: number }).tabId,
        bypassCache: true,
        waitUntil: "load",
        timeoutMs: 1000,
      }),
    );
    const backResult = backOutputSchema.parse(
      await handleToolCall(client, "back", {
        tabId: (openedTab as { tabId: number }).tabId,
        waitUntil: "load",
        timeoutMs: 1000,
      }),
    );
    const forwardResult = forwardOutputSchema.parse(
      await handleToolCall(client, "forward", {
        tabId: (openedTab as { tabId: number }).tabId,
        waitUntil: "load",
        timeoutMs: 1000,
      }),
    );
    const waitForNavigationResult = waitForNavigationOutputSchema.parse(
      await handleToolCall(client, "wait_for_navigation", {
        tabId: (openedTab as { tabId: number }).tabId,
        waitUntil: "load",
        timeoutMs: 1000,
      }),
    );
    const switchToTabResult = switchToTabOutputSchema.parse(
      await handleToolCall(client, "switch_to_tab", {
        titleIncludes: "MCP Verified Tab",
      }),
    );
    const focusTabResult = focusTabOutputSchema.parse(
      await handleToolCall(client, "focus_tab", {
        tabId: (openedTab as { tabId: number }).tabId,
      }),
    );
    const setViewportResult = setViewportOutputSchema.parse(
      await handleToolCall(client, "set_viewport", {
        tabId: (openedTab as { tabId: number }).tabId,
        width: 1280,
        height: 900,
        timeoutMs: 1000,
      }),
    );
    const clickResult = clickOutputSchema.parse(
      await handleToolCall(client, "click", {
        tabId: (openedTab as { tabId: number }).tabId,
        selector: "Example Domain",
        selectorType: "text",
        timeoutMs: 500,
      }),
    );
    const hoverResult = hoverOutputSchema.parse(
      await handleToolCall(client, "hover", {
        tabId: (openedTab as { tabId: number }).tabId,
        selector: "Example Domain",
        selectorType: "text",
        timeoutMs: 500,
      }),
    );
    const typeTextResult = typeTextOutputSchema.parse(
      await handleToolCall(client, "type_text", {
        tabId: (openedTab as { tabId: number }).tabId,
        selector: "body",
        selectorType: "css",
        text: "hello",
        clearFirst: true,
        timeoutMs: 500,
      }),
    );
    const selectOptionResult = selectOptionOutputSchema.parse(
      await handleToolCall(client, "select_option", {
        tabId: (openedTab as { tabId: number }).tabId,
        selector: "select",
        selectorType: "css",
        value: "demo",
        timeoutMs: 500,
      }),
    );
    const pressKeyResult = pressKeyOutputSchema.parse(
      await handleToolCall(client, "press_key", {
        tabId: (openedTab as { tabId: number }).tabId,
        key: "Enter",
        modifiers: ["Shift"],
      }),
    );
    const queryElementsResult = queryElementsOutputSchema.parse(
      await handleToolCall(client, "query_elements", {
        tabId: (openedTab as { tabId: number }).tabId,
        selector: "body *",
        selectorType: "css",
        limit: 5,
      }),
    );
    const querySelectorResult = querySelectorOutputSchema.parse(
      await handleToolCall(client, "query_selector", {
        tabId: (openedTab as { tabId: number }).tabId,
        selector: "body *",
        selectorType: "css",
      }),
    );
    const waitForSelectorResult = waitForSelectorOutputSchema.parse(
      await handleToolCall(client, "wait_for_selector", {
        tabId: (openedTab as { tabId: number }).tabId,
        selector: "body",
        selectorType: "css",
        state: "attached",
        timeoutMs: 500,
      }),
    );
    const visibleTextResult = getVisibleTextOutputSchema.parse(
      await handleToolCall(client, "get_visible_text", {
        tabId: (openedTab as { tabId: number }).tabId,
        maxChars: 200,
      }),
    );
    const domResult = getDomOutputSchema.parse(
      await handleToolCall(client, "get_dom", {
        tabId: (openedTab as { tabId: number }).tabId,
        maxChars: 500,
      }),
    );
    const scrollResult = scrollToOutputSchema.parse(
      await handleToolCall(client, "scroll_to", {
        tabId: (openedTab as { tabId: number }).tabId,
        x: 0,
        y: 250,
      }),
    );
    const dragAndDropResult = dragAndDropOutputSchema.parse(
      await handleToolCall(client, "drag_and_drop", {
        tabId: (openedTab as { tabId: number }).tabId,
        selector: "#source",
        selectorType: "css",
        targetSelector: "#target",
        targetSelectorType: "css",
      }),
    );
    const uploadFileResult = uploadFileOutputSchema.parse(
      await handleToolCall(client, "upload_file", {
        tabId: (openedTab as { tabId: number }).tabId,
        selector: "input[type=file]",
        selectorType: "css",
        files: [
          {
            name: "demo.txt",
            mimeType: "text/plain",
            base64: "aGVsbG8=",
          },
        ],
      }),
    );
    const downloadAssetResult = downloadAssetOutputSchema.parse(
      await handleToolCall(client, "download_asset", {
        url: "https://example.test/asset.txt",
        timeoutMs: 1000,
        maxBytes: 1024,
      }),
    );
    const capturePdfResult = capturePdfOutputSchema.parse(
      await handleToolCall(client, "capture_pdf", {
        tabId: (openedTab as { tabId: number }).tabId,
        timeoutMs: 1000,
        maxBytes: 1024 * 1024,
      }),
    );
    const screenshotResult = captureScreenshotOutputSchema.parse(
      await handleToolCall(client, "capture_screenshot", {
        tabId: (openedTab as { tabId: number }).tabId,
        format: "png",
        quality: 90,
      }),
    );
    const consoleLogsResult = getConsoleLogsOutputSchema.parse(
      await handleToolCall(client, "get_console_logs", {
        tabId: (openedTab as { tabId: number }).tabId,
        limit: 10,
      }),
    );
    const waitForIdleResult = waitForIdleOutputSchema.parse(
      await handleToolCall(client, "wait_for_idle", {
        tabId: (openedTab as { tabId: number }).tabId,
        idleMs: 250,
        timeoutMs: 1000,
      }),
    );
    const networkLogResult = networkLogOutputSchema.parse(
      await handleToolCall(client, "network_log", {
        tabId: (openedTab as { tabId: number }).tabId,
        durationMs: 500,
        maxEntries: 20,
        includeBodies: false,
        reloadFirst: false,
      }),
    );
    const cookieAccessResult = cookieAccessOutputSchema.parse(
      await handleToolCall(client, "cookie_access", {
        url: "https://example.test/",
      }),
    );
    const requestInterceptResult = requestInterceptOutputSchema.parse(
      await handleToolCall(client, "request_intercept", {
        tabId: (openedTab as { tabId: number }).tabId,
        urlPattern: "*://example.test/intercept*",
        action: "fail",
        enabled: true,
      }),
    );
    const mockResponseResult = mockResponseOutputSchema.parse(
      await handleToolCall(client, "mock_response", {
        tabId: (openedTab as { tabId: number }).tabId,
        urlPattern: "*://example.test/mock*",
        statusCode: 200,
        bodyText: "{\"ok\":true}",
        headers: [{ name: "content-type", value: "application/json" }],
        enabled: true,
      }),
    );
    const throttleNetworkResult = throttleNetworkOutputSchema.parse(
      await handleToolCall(client, "throttle_network", {
        tabId: (openedTab as { tabId: number }).tabId,
        enabled: true,
        latencyMs: 250,
        downloadThroughput: 4096,
        uploadThroughput: 2048,
      }),
    );
    const clearStorageResult = clearStorageOutputSchema.parse(
      await handleToolCall(client, "clear_storage", {
        tabId: (openedTab as { tabId: number }).tabId,
      }),
    );
    const sessionExportResult = sessionExportOutputSchema.parse(
      await handleToolCall(client, "session_export", {
        tabId: (openedTab as { tabId: number }).tabId,
        includeHtml: true,
      }),
    );
    const setUserAgentResult = setUserAgentOutputSchema.parse(
      await handleToolCall(client, "set_user_agent", {
        tabId: (openedTab as { tabId: number }).tabId,
        enabled: true,
        userAgent: "SimulatedAgent/0.10.0",
      }),
    );
    const emulateMediaResult = emulateMediaOutputSchema.parse(
      await handleToolCall(client, "emulate_media", {
        tabId: (openedTab as { tabId: number }).tabId,
        enabled: true,
        media: "print",
        features: [{ name: "prefers-color-scheme", value: "dark" }],
      }),
    );
    const grantPermissionsResult = grantPermissionsOutputSchema.parse(
      await handleToolCall(client, "grant_permissions", {
        url: "https://example.test/",
        permissions: ["geolocation", "notifications"],
        setting: "allow",
      }),
    );
    const harExportResult = harExportOutputSchema.parse(
      await handleToolCall(client, "har_export", {
        tabId: (openedTab as { tabId: number }).tabId,
        durationMs: 500,
        reloadFirst: true,
        includeBodies: false,
      }),
    );
    const executeJavaScriptResult = executeJavaScriptOutputSchema.parse(
      await handleToolCall(client, "execute_javascript", {
        tabId: (openedTab as { tabId: number }).tabId,
        code: "'hello from execute_javascript'",
        world: "isolated",
        awaitPromise: true,
      }),
    );
    const elementsFromPointResult = elementsFromPointOutputSchema.parse(
      await handleToolCall(client, "elements_from_point", {
        tabId: (openedTab as { tabId: number }).tabId,
        x: 10,
        y: 10,
        limit: 5,
      }),
    );
    const closeResult = closeTabOutputSchema.parse(
      await handleToolCall(client, "close_tab", {
        tabId: (openedTab as { tabId: number }).tabId,
      }),
    );
    const closeWindowResult = closeWindowOutputSchema.parse(
      await handleToolCall(client, "close_window", {
        windowId: newWindowResult.window.windowId,
      }),
    );

    assert(Array.isArray(tabs.tabs) && tabs.tabs.length === 1, "Expected bridged tabs");
    assert(Array.isArray(windows.windows) && windows.windows.length > 0, "Expected windows");
    assert(activeTab.tab.active, "Expected the active tab to be active=true");
    assert(
      activeTabInfo.tab.tabId === activeTab.tab.tabId,
      "Expected get_tab_info to return the requested tab",
    );
    assert(
      windowInfo.window.windowId === activeTab.tab.windowId,
      "Expected get_window_info to return the requested window",
    );
    assert(
      tabs.tabs[0]?.title === "MCP Verified Tab",
      "Expected daemon-backed data from the simulated extension bridge",
    );
    assert(
      (openedTab as { tabId: number }).tabId > 0,
      "Expected open_tab to return a new tab id",
    );
    assert(
      typeof newWindowResult.window.windowId === "number",
      "Expected new_window to return a window id",
    );
    assert(
      (navigationResult as { url: string; status: string }).url ===
        "https://example.test/navigated-via-mcp",
      "Expected navigate to return the new URL",
    );
    assert(
      (navigationResult as { url: string; status: string }).status === "ok",
      "Expected navigate to report ok status",
    );
    assert(reloadResult.status === "ok", "Expected reload_tab to report ok status");
    assert(
      backResult.url === "https://example.test/opened-via-mcp",
      "Expected back to return the previous URL",
    );
    assert(
      forwardResult.url === "https://example.test/navigated-via-mcp",
      "Expected forward to return the next URL",
    );
    assert(
      waitForNavigationResult.status === "ok",
      "Expected wait_for_navigation to report ok",
    );
    assert(
      switchToTabResult.tab.title === "MCP Verified Tab",
      "Expected switch_to_tab to activate the matching tab",
    );
    assert(
      focusTabResult.tab.tabId === (openedTab as { tabId: number }).tabId,
      "Expected focus_tab to activate the requested tab",
    );
    assert(
      typeof setViewportResult.viewportWidth === "number" &&
        typeof setViewportResult.viewportHeight === "number",
      "Expected set_viewport to return viewport dimensions",
    );
    assert(typeof clickResult.clicked === "boolean", "Expected click to return clicked");
    assert(typeof hoverResult.hovered === "boolean", "Expected hover to return hovered");
    assert(typeof typeTextResult.typed === "boolean", "Expected type_text to return typed");
    assert(
      typeof selectOptionResult.selected === "boolean",
      "Expected select_option to return selected",
    );
    assert(
      typeof pressKeyResult.pressed === "boolean",
      "Expected press_key to return pressed",
    );
    assert(
      typeof queryElementsResult.count === "number" &&
        Array.isArray(queryElementsResult.elements),
      "Expected query_elements to return count and elements",
    );
    assert(typeof querySelectorResult.found === "boolean", "Expected query_selector found");
    assert(
      typeof waitForSelectorResult.found === "boolean",
      "Expected wait_for_selector found",
    );
    assert(typeof visibleTextResult.text === "string", "Expected get_visible_text text");
    assert(typeof domResult.html === "string", "Expected get_dom html");
    assert(scrollResult.scrolled, "Expected scroll_to to report scrolled=true");
    assert(dragAndDropResult.dropped, "Expected drag_and_drop dropped=true");
    assert(uploadFileResult.uploaded, "Expected upload_file uploaded=true");
    assert(
      downloadAssetResult.status === "ok",
      "Expected download_asset to report ok status",
    );
    assert(capturePdfResult.status === "ok", "Expected capture_pdf to report ok status");
    assert(
      typeof screenshotResult.mimeType === "string" &&
        typeof screenshotResult.base64 === "string",
      "Expected capture_screenshot image payload",
    );
    assert(
      Array.isArray(consoleLogsResult.entries),
      "Expected get_console_logs entries",
    );
    assert(waitForIdleResult.idle, "Expected wait_for_idle idle=true");
    assert(
      Array.isArray(networkLogResult.entries),
      "Expected network_log entries",
    );
    assert(
      Array.isArray(cookieAccessResult.cookies),
      "Expected cookie_access cookies",
    );
    assert(requestInterceptResult.configured, "Expected request_intercept configured=true");
    assert(mockResponseResult.configured, "Expected mock_response configured=true");
    assert(throttleNetworkResult.enabled, "Expected throttle_network enabled=true");
    assert(typeof clearStorageResult.origin === "string", "Expected clear_storage origin");
    assert(
      typeof sessionExportResult.url === "string" &&
        typeof sessionExportResult.title === "string",
      "Expected session_export session metadata",
    );
    assert(setUserAgentResult.enabled, "Expected set_user_agent enabled=true");
    assert(emulateMediaResult.enabled, "Expected emulate_media enabled=true");
    assert(
      grantPermissionsResult.appliedPermissions.length === 2,
      "Expected grant_permissions to return applied permissions",
    );
    assert(harExportResult.entryCount > 0, "Expected har_export entries");
    assert(
      executeJavaScriptResult.resultType === "string",
      "Expected execute_javascript result type",
    );
    assert(
      typeof elementsFromPointResult.count === "number" &&
        Array.isArray(elementsFromPointResult.elements),
      "Expected elements_from_point to return count and elements",
    );
    assert(closeResult.closed, "Expected close_tab to report closed=true");
    assert(closeWindowResult.closed, "Expected close_window to report closed=true");
    assert(implementedTools.length === 48, "Expected forty-eight implemented MCP tools");

    await simulatedBridge.close();

    console.log(
      JSON.stringify(
        {
          verifiedTools: implementedTools.map((tool) => tool.name),
          activeTabTitle: activeTab.tab.title,
          openedTabId: (openedTab as { tabId: number }).tabId,
          clickResult,
          queryElementsCount: queryElementsResult.count,
          elementsFromPointCount: elementsFromPointResult.count,
          uploadedFiles: uploadFileResult.fileCount,
          downloadedAssetStatus: downloadAssetResult.status,
          pdfStatus: capturePdfResult.status,
          networkEntryCount: networkLogResult.entries.length,
          cookieCount: cookieAccessResult.cookies.length,
          requestInterceptRules: requestInterceptResult.activeRules,
          mockResponseRules: mockResponseResult.activeRules,
          throttled: throttleNetworkResult.enabled,
          clearedStorageOrigin: clearStorageResult.origin,
          sessionExportCookieCount: sessionExportResult.cookies.length,
          overriddenUserAgent: setUserAgentResult.userAgent,
          emulatedMedia: emulateMediaResult.media,
          grantedPermissions: grantPermissionsResult.appliedPermissions.length,
          harEntryCount: harExportResult.entryCount,
          consoleLogCount: consoleLogsResult.entries.length,
        },
        null,
        2,
      ),
    );
  } finally {
    daemonProcess.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
