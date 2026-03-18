import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { connectSimulatedExtensionBridge } from "@brave-mcp/sdk";

import { createDaemonApp } from "./app.js";
import { configFilePath } from "./config.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main(): Promise<void> {
  const tempConfigDir = await mkdtemp(join(tmpdir(), "brave-mcp-daemon-"));
  const { app, state } = await createDaemonApp({
    configDir: tempConfigDir,
    logger: false,
  });

  await app.listen({
    host: "127.0.0.1",
    port: 0,
  });

  const address = app.server.address();
  assert(address && typeof address === "object", "Expected a bound server address");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const [healthResponse, readyResponse] = await Promise.all([
    fetch(`${baseUrl}/healthz`),
    fetch(`${baseUrl}/readyz`),
  ]);

  assert(healthResponse.ok, "Health endpoint should return 200");
  assert(readyResponse.ok, "Ready endpoint should return 200");

  const healthJson = (await healthResponse.json()) as {
    ok: boolean;
    toolCount: number;
    extensionConnected: boolean;
  };
  const readyJson = (await readyResponse.json()) as {
    ok: boolean;
    ready: boolean;
    configDir: string;
  };

  assert(healthJson.ok, "Health payload should mark ok=true");
  assert(healthJson.toolCount > 0, "Health payload should expose the tool count");
  assert(readyJson.ok && readyJson.ready, "Ready payload should mark ready=true");
  assert(
    readyJson.configDir === state.configDir,
    "Ready payload should echo the resolved config directory",
  );

  const simulatedBridge = await connectSimulatedExtensionBridge({
    daemonUrl: `${baseUrl.replace("http", "ws")}/extension/connect`,
    authToken: state.config.secret,
    tabs: [
      {
        tabId: 301,
        windowId: 7,
        title: "Extension Backed Tab",
        url: "https://example.test/bridge",
        active: true,
      },
    ],
  });

  const rpcResponse = await fetch(`${baseUrl}/rpc`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      id: "req_123",
      method: "tabs.list",
      params: {},
      authToken: state.config.secret,
    }),
  });
  assert(rpcResponse.ok, "Mock RPC endpoint should return 200");
  const rpcJson = (await rpcResponse.json()) as {
    ok: boolean;
    result?: { tabs: Array<{ title: string }> };
  };
  assert(rpcJson.ok, "RPC payload should mark ok=true");
  assert(
    Array.isArray(rpcJson.result?.tabs) &&
      rpcJson.result.tabs[0]?.title === "Extension Backed Tab",
    "RPC endpoint should return extension-backed tab data",
  );
  assert(
    !healthJson.extensionConnected,
    "Initial health probe should occur before the simulated extension connects",
  );

  const windowsJson = (await callRpc("windows.list", {
    populateTabs: true,
    windowTypes: ["normal", "popup"],
  })) as {
    ok: boolean;
    result?: { windows: unknown[] };
  };
  assert(windowsJson.ok, "windows.list should return ok=true");
  assert(Array.isArray(windowsJson.result?.windows), "windows.list should return windows");

  async function callRpc(method: string, params: Record<string, unknown>) {
    const response = await fetch(`${baseUrl}/rpc`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        id: `req_${method}`,
        method,
        params,
        authToken: state.config.secret,
      }),
    });

    assert(response.ok, `${method} RPC should return 200`);
    return (await response.json()) as {
      ok: boolean;
      result?: Record<string, unknown>;
      error?: { code: string; message: string };
    };
  }

  const openTabJson = (await callRpc("tabs.open", {
    url: "https://example.test/opened",
    active: true,
  })) as {
    ok: boolean;
    result?: { tabId: number };
  };
  assert(openTabJson.ok, "tabs.open should return ok=true");
  assert(typeof openTabJson.result?.tabId === "number", "tabs.open should return tabId");

  const newWindowJson = (await callRpc("windows.create", {
    url: "https://example.test/window",
    focused: true,
    type: "normal",
    width: 1200,
    height: 900,
  })) as {
    ok: boolean;
    result?: { window: { windowId: number }; tab?: { tabId: number } };
  };
  assert(newWindowJson.ok, "windows.create should return ok=true");
  assert(
    typeof newWindowJson.result?.window.windowId === "number",
    "windows.create should return window details",
  );

  const windowInfoJson = (await callRpc("windows.getInfo", {
    windowId: newWindowJson.result?.window.windowId,
    populateTabs: true,
  })) as {
    ok: boolean;
    result?: { window: { windowId: number } };
  };
  assert(windowInfoJson.ok, "windows.getInfo should return ok=true");
  assert(
    windowInfoJson.result?.window.windowId === newWindowJson.result?.window.windowId,
    "windows.getInfo should return the requested window",
  );

  const tabInfoJson = (await callRpc("tabs.getInfo", {
    tabId: openTabJson.result?.tabId,
  })) as {
    ok: boolean;
    result?: { tab: { tabId: number; status?: string } };
  };
  assert(tabInfoJson.ok, "tabs.getInfo should return ok=true");
  assert(
    tabInfoJson.result?.tab.tabId === openTabJson.result?.tabId,
    "tabs.getInfo should return the requested tab",
  );

  const navigateJson = (await callRpc("tabs.navigate", {
    tabId: openTabJson.result?.tabId,
    url: "https://example.test/navigated",
    waitUntil: "load",
    timeoutMs: 1000,
  })) as {
    ok: boolean;
    result?: { url: string; status: string };
  };
  assert(navigateJson.ok, "tabs.navigate should return ok=true");
  assert(
    navigateJson.result?.url === "https://example.test/navigated",
    "tabs.navigate should return the new URL",
  );
  assert(
    navigateJson.result?.status === "ok",
    "tabs.navigate should report ok status in the simulated bridge",
  );

  const reloadJson = (await callRpc("tabs.reload", {
    tabId: openTabJson.result?.tabId,
    bypassCache: true,
    waitUntil: "load",
    timeoutMs: 1000,
  })) as {
    ok: boolean;
    result?: { status: string };
  };
  assert(reloadJson.ok, "tabs.reload should return ok=true");
  assert(reloadJson.result?.status === "ok", "tabs.reload should report ok status");

  const backJson = (await callRpc("tabs.back", {
    tabId: openTabJson.result?.tabId,
    waitUntil: "load",
    timeoutMs: 1000,
  })) as {
    ok: boolean;
    result?: { url: string; status: string };
  };
  assert(backJson.ok, "tabs.back should return ok=true");
  assert(
    backJson.result?.url === "https://example.test/opened",
    "tabs.back should return the previous URL",
  );

  const forwardJson = (await callRpc("tabs.forward", {
    tabId: openTabJson.result?.tabId,
    waitUntil: "load",
    timeoutMs: 1000,
  })) as {
    ok: boolean;
    result?: { url: string; status: string };
  };
  assert(forwardJson.ok, "tabs.forward should return ok=true");
  assert(
    forwardJson.result?.url === "https://example.test/navigated",
    "tabs.forward should return the next URL",
  );

  const waitForNavigationJson = (await callRpc("tabs.waitForNavigation", {
    tabId: openTabJson.result?.tabId,
    waitUntil: "load",
    timeoutMs: 1000,
  })) as {
    ok: boolean;
    result?: { url: string; status: string };
  };
  assert(waitForNavigationJson.ok, "tabs.waitForNavigation should return ok=true");
  assert(
    waitForNavigationJson.result?.status === "ok",
    "tabs.waitForNavigation should return ok status",
  );

  const switchJson = (await callRpc("tabs.switch", {
    urlIncludes: "bridge",
  })) as {
    ok: boolean;
    result?: { tab: { title: string; active: boolean } };
  };
  assert(switchJson.ok, "tabs.switch should return ok=true");
  assert(
    switchJson.result?.tab.active === true,
    "tabs.switch should return the activated tab",
  );

  const focusJson = (await callRpc("tabs.focus", {
    tabId: openTabJson.result?.tabId,
  })) as {
    ok: boolean;
    result?: { tab: { tabId: number; active: boolean } };
  };
  assert(focusJson.ok, "tabs.focus should return ok=true");
  assert(
    focusJson.result?.tab.tabId === openTabJson.result?.tabId &&
      focusJson.result?.tab.active === true,
    "tabs.focus should activate the requested tab",
  );

  const viewportJson = (await callRpc("tabs.setViewport", {
    tabId: openTabJson.result?.tabId,
    width: 1280,
    height: 900,
    timeoutMs: 1000,
  })) as {
    ok: boolean;
    result?: { windowId: number; viewportWidth: number; viewportHeight: number };
  };
  assert(viewportJson.ok, "tabs.setViewport should return ok=true");
  assert(
    typeof viewportJson.result?.viewportWidth === "number" &&
      typeof viewportJson.result?.viewportHeight === "number",
    "tabs.setViewport should return viewport dimensions",
  );

  const clickJson = (await callRpc("dom.click", {
    tabId: openTabJson.result?.tabId,
    selector: "Example Domain",
    selectorType: "text",
    timeoutMs: 500,
  })) as {
    ok: boolean;
    result?: { clicked: boolean };
  };
  assert(clickJson.ok, "dom.click should return ok=true");
  assert(typeof clickJson.result?.clicked === "boolean", "dom.click should return clicked");

  const hoverJson = (await callRpc("dom.hover", {
    tabId: openTabJson.result?.tabId,
    selector: "Example Domain",
    selectorType: "text",
    timeoutMs: 500,
  })) as {
    ok: boolean;
    result?: { hovered: boolean };
  };
  assert(hoverJson.ok, "dom.hover should return ok=true");
  assert(typeof hoverJson.result?.hovered === "boolean", "dom.hover should return hovered");

  const typeJson = (await callRpc("dom.type", {
    tabId: openTabJson.result?.tabId,
    selector: "body",
    selectorType: "css",
    text: "hello",
    clearFirst: true,
    timeoutMs: 500,
  })) as {
    ok: boolean;
    result?: { typed: boolean };
  };
  assert(typeJson.ok, "dom.type should return ok=true");
  assert(typeof typeJson.result?.typed === "boolean", "dom.type should return typed");

  const selectJson = (await callRpc("dom.selectOption", {
    tabId: openTabJson.result?.tabId,
    selector: "select",
    selectorType: "css",
    value: "demo",
    timeoutMs: 500,
  })) as {
    ok: boolean;
    result?: { selected: boolean };
  };
  assert(selectJson.ok, "dom.selectOption should return ok=true");
  assert(
    typeof selectJson.result?.selected === "boolean",
    "dom.selectOption should return selected",
  );

  const pressKeyJson = (await callRpc("input.pressKey", {
    tabId: openTabJson.result?.tabId,
    key: "Enter",
    modifiers: ["Shift"],
  })) as {
    ok: boolean;
    result?: { pressed: boolean };
  };
  assert(pressKeyJson.ok, "input.pressKey should return ok=true");
  assert(
    typeof pressKeyJson.result?.pressed === "boolean",
    "input.pressKey should return pressed",
  );

  const queryElementsJson = (await callRpc("dom.queryElements", {
    tabId: openTabJson.result?.tabId,
    selector: "body *",
    selectorType: "css",
    limit: 5,
  })) as {
    ok: boolean;
    result?: { count: number; elements: unknown[] };
  };
  assert(queryElementsJson.ok, "dom.queryElements should return ok=true");
  assert(
    typeof queryElementsJson.result?.count === "number",
    "dom.queryElements should return count",
  );
  assert(
    Array.isArray(queryElementsJson.result?.elements),
    "dom.queryElements should return elements",
  );

  const querySelectorJson = (await callRpc("dom.querySelector", {
    tabId: openTabJson.result?.tabId,
    selector: "body *",
    selectorType: "css",
  })) as {
    ok: boolean;
    result?: { found: boolean; element?: unknown };
  };
  assert(querySelectorJson.ok, "dom.querySelector should return ok=true");
  assert(
    typeof querySelectorJson.result?.found === "boolean",
    "dom.querySelector should return found",
  );

  const waitForSelectorJson = (await callRpc("dom.waitForSelector", {
    tabId: openTabJson.result?.tabId,
    selector: "body",
    selectorType: "css",
    state: "attached",
    timeoutMs: 500,
  })) as {
    ok: boolean;
    result?: { found: boolean };
  };
  assert(waitForSelectorJson.ok, "dom.waitForSelector should return ok=true");
  assert(
    typeof waitForSelectorJson.result?.found === "boolean",
    "dom.waitForSelector should return found",
  );

  const visibleTextJson = (await callRpc("dom.getVisibleText", {
    tabId: openTabJson.result?.tabId,
    maxChars: 200,
  })) as {
    ok: boolean;
    result?: { text: string };
  };
  assert(visibleTextJson.ok, "dom.getVisibleText should return ok=true");
  assert(
    typeof visibleTextJson.result?.text === "string",
    "dom.getVisibleText should return text",
  );

  const domJson = (await callRpc("dom.getHtml", {
    tabId: openTabJson.result?.tabId,
    maxChars: 500,
  })) as {
    ok: boolean;
    result?: { html: string };
  };
  assert(domJson.ok, "dom.getHtml should return ok=true");
  assert(typeof domJson.result?.html === "string", "dom.getHtml should return html");

  const elementsFromPointJson = (await callRpc("dom.elementsFromPoint", {
    tabId: openTabJson.result?.tabId,
    x: 10,
    y: 10,
    limit: 5,
  })) as {
    ok: boolean;
    result?: { count: number; elements: unknown[] };
  };
  assert(elementsFromPointJson.ok, "dom.elementsFromPoint should return ok=true");
  assert(
    typeof elementsFromPointJson.result?.count === "number" &&
      Array.isArray(elementsFromPointJson.result?.elements),
    "dom.elementsFromPoint should return count and elements",
  );

  const scrollJson = (await callRpc("dom.scrollTo", {
    tabId: openTabJson.result?.tabId,
    x: 0,
    y: 200,
  })) as {
    ok: boolean;
    result?: { scrolled: boolean; x: number; y: number };
  };
  assert(scrollJson.ok, "dom.scrollTo should return ok=true");
  assert(scrollJson.result?.scrolled === true, "dom.scrollTo should report scrolled=true");

  const dragJson = (await callRpc("dom.dragAndDrop", {
    tabId: openTabJson.result?.tabId,
    selector: "#source",
    selectorType: "css",
    targetSelector: "#target",
    targetSelectorType: "css",
    timeoutMs: 500,
  })) as {
    ok: boolean;
    result?: { dropped: boolean };
  };
  assert(dragJson.ok, "dom.dragAndDrop should return ok=true");
  assert(dragJson.result?.dropped === true, "dom.dragAndDrop should report dropped=true");

  const uploadJson = (await callRpc("dom.uploadFiles", {
    tabId: openTabJson.result?.tabId,
    selector: "input[type=file]",
    selectorType: "css",
    files: [
      {
        name: "demo.txt",
        mimeType: "text/plain",
        base64: "aGVsbG8=",
      },
    ],
    timeoutMs: 500,
  })) as {
    ok: boolean;
    result?: { uploaded: boolean; fileCount: number };
  };
  assert(uploadJson.ok, "dom.uploadFiles should return ok=true");
  assert(
    uploadJson.result?.uploaded === true && uploadJson.result.fileCount === 1,
    "dom.uploadFiles should report uploaded file count",
  );

  const downloadJson = (await callRpc("page.downloadAsset", {
    url: "https://example.test/asset.txt",
    timeoutMs: 1000,
    maxBytes: 1024,
  })) as {
    ok: boolean;
    result?: { finalUrl: string; mimeType: string; status: string };
  };
  assert(downloadJson.ok, "page.downloadAsset should return ok=true");
  assert(
    downloadJson.result?.status === "ok" &&
      typeof downloadJson.result.mimeType === "string",
    "page.downloadAsset should return asset payload metadata",
  );

  const pdfJson = (await callRpc("page.capturePdf", {
    tabId: openTabJson.result?.tabId,
    timeoutMs: 1000,
    maxBytes: 1024 * 1024,
  })) as {
    ok: boolean;
    result?: { mimeType: string; status: string };
  };
  assert(pdfJson.ok, "page.capturePdf should return ok=true");
  assert(
    pdfJson.result?.mimeType === "application/pdf" && pdfJson.result.status === "ok",
    "page.capturePdf should return PDF metadata",
  );

  const screenshotJson = (await callRpc("page.captureScreenshot", {
    tabId: openTabJson.result?.tabId,
    format: "png",
    quality: 90,
  })) as {
    ok: boolean;
    result?: { mimeType: string; base64: string };
  };
  assert(screenshotJson.ok, "page.captureScreenshot should return ok=true");
  assert(
    typeof screenshotJson.result?.mimeType === "string" &&
      typeof screenshotJson.result?.base64 === "string",
    "page.captureScreenshot should return image payload",
  );

  const consoleLogsJson = (await callRpc("page.getConsoleLogs", {
    tabId: openTabJson.result?.tabId,
    limit: 10,
  })) as {
    ok: boolean;
    result?: { entries: unknown[] };
  };
  assert(consoleLogsJson.ok, "page.getConsoleLogs should return ok=true");
  assert(
    Array.isArray(consoleLogsJson.result?.entries),
    "page.getConsoleLogs should return entries",
  );

  const idleJson = (await callRpc("page.waitForIdle", {
    tabId: openTabJson.result?.tabId,
    idleMs: 250,
    timeoutMs: 1000,
  })) as {
    ok: boolean;
    result?: { idle: boolean; status: string };
  };
  assert(idleJson.ok, "page.waitForIdle should return ok=true");
  assert(
    idleJson.result?.idle === true && idleJson.result.status === "ok",
    "page.waitForIdle should report idle ok",
  );

  const networkJson = (await callRpc("page.networkLog", {
    tabId: openTabJson.result?.tabId,
    durationMs: 500,
    maxEntries: 20,
    includeBodies: false,
    reloadFirst: false,
  })) as {
    ok: boolean;
    result?: { entries: unknown[] };
  };
  assert(networkJson.ok, "page.networkLog should return ok=true");
  assert(Array.isArray(networkJson.result?.entries), "page.networkLog should return entries");

  const cookieJson = (await callRpc("storage.cookieAccess", {
    url: "https://example.test/",
  })) as {
    ok: boolean;
    result?: { cookies: unknown[] };
  };
  assert(cookieJson.ok, "storage.cookieAccess should return ok=true");
  assert(
    Array.isArray(cookieJson.result?.cookies),
    "storage.cookieAccess should return cookies",
  );

  const requestInterceptJson = (await callRpc("network.requestIntercept", {
    tabId: openTabJson.result?.tabId,
    urlPattern: "*://example.test/intercept*",
    action: "fail",
    enabled: true,
  })) as {
    ok: boolean;
    result?: { configured: boolean; activeRules: number };
  };
  assert(requestInterceptJson.ok, "network.requestIntercept should return ok=true");
  assert(
    requestInterceptJson.result?.configured === true,
    "network.requestIntercept should report configured=true",
  );

  const mockResponseJson = (await callRpc("network.mockResponse", {
    tabId: openTabJson.result?.tabId,
    urlPattern: "*://example.test/mock*",
    statusCode: 200,
    bodyText: "{\"ok\":true}",
    headers: [{ name: "content-type", value: "application/json" }],
    enabled: true,
  })) as {
    ok: boolean;
    result?: { configured: boolean; activeRules: number };
  };
  assert(mockResponseJson.ok, "network.mockResponse should return ok=true");
  assert(
    mockResponseJson.result?.configured === true,
    "network.mockResponse should report configured=true",
  );

  const throttleJson = (await callRpc("network.throttle", {
    tabId: openTabJson.result?.tabId,
    enabled: true,
    latencyMs: 250,
    downloadThroughput: 4096,
    uploadThroughput: 2048,
  })) as {
    ok: boolean;
    result?: { enabled: boolean; latencyMs: number };
  };
  assert(throttleJson.ok, "network.throttle should return ok=true");
  assert(
    throttleJson.result?.enabled === true,
    "network.throttle should report enabled=true",
  );

  const clearStorageJson = (await callRpc("storage.clear", {
    tabId: openTabJson.result?.tabId,
  })) as {
    ok: boolean;
    result?: { origin: string; clearedCookies: number };
  };
  assert(clearStorageJson.ok, "storage.clear should return ok=true");
  assert(
    typeof clearStorageJson.result?.origin === "string",
    "storage.clear should return an origin",
  );

  const sessionExportJson = (await callRpc("session.export", {
    tabId: openTabJson.result?.tabId,
    includeHtml: true,
  })) as {
    ok: boolean;
    result?: { url: string; title: string; cookies: unknown[] };
  };
  assert(sessionExportJson.ok, "session.export should return ok=true");
  assert(
    typeof sessionExportJson.result?.url === "string" &&
      typeof sessionExportJson.result?.title === "string" &&
      Array.isArray(sessionExportJson.result?.cookies),
    "session.export should return session data",
  );

  const setUserAgentJson = (await callRpc("page.setUserAgent", {
    tabId: openTabJson.result?.tabId,
    enabled: true,
    userAgent: "SimulatedAgent/0.11.0",
  })) as {
    ok: boolean;
    result?: { enabled: boolean; userAgent: string };
  };
  assert(setUserAgentJson.ok, "page.setUserAgent should return ok=true");
  assert(
    setUserAgentJson.result?.enabled === true,
    "page.setUserAgent should report enabled=true",
  );

  const emulateMediaJson = (await callRpc("page.emulateMedia", {
    tabId: openTabJson.result?.tabId,
    enabled: true,
    media: "print",
    features: [{ name: "prefers-color-scheme", value: "dark" }],
  })) as {
    ok: boolean;
    result?: { enabled: boolean; media: string };
  };
  assert(emulateMediaJson.ok, "page.emulateMedia should return ok=true");
  assert(
    emulateMediaJson.result?.enabled === true,
    "page.emulateMedia should report enabled=true",
  );

  const grantPermissionsJson = (await callRpc("browser.grantPermissions", {
    url: "https://example.test/",
    permissions: ["geolocation", "notifications"],
    setting: "allow",
  })) as {
    ok: boolean;
    result?: { origin: string; appliedPermissions: unknown[] };
  };
  assert(grantPermissionsJson.ok, "browser.grantPermissions should return ok=true");
  assert(
    Array.isArray(grantPermissionsJson.result?.appliedPermissions),
    "browser.grantPermissions should return applied permissions",
  );

  const harExportJson = (await callRpc("page.exportHar", {
    tabId: openTabJson.result?.tabId,
    durationMs: 500,
    reloadFirst: true,
    includeBodies: false,
  })) as {
    ok: boolean;
    result?: { mimeType: string; harJson: string; entryCount: number };
  };
  assert(harExportJson.ok, "page.exportHar should return ok=true");
  assert(
    harExportJson.result?.mimeType === "application/json" &&
      typeof harExportJson.result?.harJson === "string" &&
      typeof harExportJson.result?.entryCount === "number",
    "page.exportHar should return HAR payload",
  );

  const executeJson = (await callRpc("page.executeJavaScript", {
    tabId: openTabJson.result?.tabId,
    code: "document.title",
    world: "isolated",
    awaitPromise: true,
  })) as {
    ok: boolean;
    result?: { resultType: string; resultJson: string };
  };
  assert(executeJson.ok, "page.executeJavaScript should return ok=true");
  assert(
    executeJson.result?.resultType === "string" &&
      typeof executeJson.result.resultJson === "string" &&
      executeJson.result.resultJson.length > 0 &&
      !executeJson.result.resultJson.includes("Timed out waiting for execute_javascript result."),
    "page.executeJavaScript should serialize isolated-world DOM access",
  );

  const executeMainJson = (await callRpc("page.executeJavaScript", {
    tabId: openTabJson.result?.tabId,
    code: "'hello from execute'",
    world: "main",
    awaitPromise: true,
  })) as {
    ok: boolean;
    result?: { resultType: string; resultJson: string };
  };
  assert(executeMainJson.ok, "page.executeJavaScript main world should return ok=true");
  assert(
    executeMainJson.result?.resultType === "string" &&
      typeof executeMainJson.result.resultJson === "string" &&
      !executeMainJson.result.resultJson.includes(
        "Timed out waiting for execute_javascript result.",
      ),
    "page.executeJavaScript main world should return a serialized result",
  );

  const closeJson = (await callRpc("tabs.close", {
    tabId: openTabJson.result?.tabId,
  })) as {
    ok: boolean;
    result?: { closed: boolean };
  };
  assert(closeJson.ok, "tabs.close should return ok=true");
  assert(closeJson.result?.closed, "tabs.close should report closed=true");

  const closeWindowJson = (await callRpc("windows.close", {
    windowId: newWindowJson.result?.window.windowId,
  })) as {
    ok: boolean;
    result?: { closed: boolean };
  };
  assert(closeWindowJson.ok, "windows.close should return ok=true");
  assert(closeWindowJson.result?.closed, "windows.close should report closed=true");

  const configStats = await stat(configFilePath(state.configDir));
  assert(configStats.isFile(), "Daemon config file should exist after bootstrap");

  await simulatedBridge.close();
  await app.close();

  console.log(
    JSON.stringify(
      {
        verifiedEndpoints: ["/healthz", "/readyz", "/rpc"],
        verifiedMethods: [
          "tabs.list",
          "windows.list",
          "tabs.getInfo",
          "windows.getInfo",
          "tabs.open",
          "windows.create",
          "tabs.navigate",
          "tabs.reload",
          "tabs.back",
          "tabs.forward",
          "tabs.waitForNavigation",
          "tabs.switch",
          "tabs.focus",
          "tabs.setViewport",
          "dom.click",
          "dom.hover",
          "dom.type",
          "dom.selectOption",
          "dom.scrollTo",
          "dom.dragAndDrop",
          "dom.uploadFiles",
          "input.pressKey",
          "dom.queryElements",
          "dom.querySelector",
          "dom.waitForSelector",
          "dom.getVisibleText",
          "dom.getHtml",
          "dom.elementsFromPoint",
          "page.captureScreenshot",
          "page.downloadAsset",
          "page.capturePdf",
          "page.getConsoleLogs",
          "page.networkLog",
          "storage.cookieAccess",
          "network.requestIntercept",
          "network.mockResponse",
          "network.throttle",
          "storage.clear",
          "session.export",
          "page.setUserAgent",
          "page.emulateMedia",
          "browser.grantPermissions",
          "page.exportHar",
          "page.waitForIdle",
          "page.executeJavaScript",
          "tabs.close",
          "windows.close",
        ],
        configDir: state.configDir,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
