import {
  backInputSchema,
  backOutputSchema,
  capturePdfInputSchema,
  capturePdfOutputSchema,
  clearStorageInputSchema,
  clearStorageOutputSchema,
  clickInputSchema,
  clickOutputSchema,
  closeTabInputSchema,
  closeTabOutputSchema,
  closeWindowInputSchema,
  closeWindowOutputSchema,
  cookieAccessInputSchema,
  cookieAccessOutputSchema,
  downloadAssetInputSchema,
  downloadAssetOutputSchema,
  forwardInputSchema,
  forwardOutputSchema,
  getActiveTabInputSchema,
  getActiveTabOutputSchema,
  getConsoleLogsInputSchema,
  getConsoleLogsOutputSchema,
  getDomInputSchema,
  getDomOutputSchema,
  getTabInfoInputSchema,
  getTabInfoOutputSchema,
  getVisibleTextInputSchema,
  getVisibleTextOutputSchema,
  getWindowInfoInputSchema,
  getWindowInfoOutputSchema,
  executeJavaScriptInputSchema,
  executeJavaScriptOutputSchema,
  focusTabInputSchema,
  focusTabOutputSchema,
  hoverInputSchema,
  hoverOutputSchema,
  listWindowsInputSchema,
  listWindowsOutputSchema,
  listTabsInputSchema,
  listTabsOutputSchema,
  navigateInputSchema,
  navigateOutputSchema,
  newWindowInputSchema,
  newWindowOutputSchema,
  mockResponseInputSchema,
  mockResponseOutputSchema,
  networkLogInputSchema,
  networkLogOutputSchema,
  openTabInputSchema,
  openTabOutputSchema,
  pressKeyInputSchema,
  pressKeyOutputSchema,
  setViewportInputSchema,
  setViewportOutputSchema,
  scrollToInputSchema,
  scrollToOutputSchema,
  elementsFromPointInputSchema,
  elementsFromPointOutputSchema,
  querySelectorInputSchema,
  querySelectorOutputSchema,
  queryElementsInputSchema,
  queryElementsOutputSchema,
  reloadTabInputSchema,
  reloadTabOutputSchema,
  requestInterceptInputSchema,
  requestInterceptOutputSchema,
  sessionExportInputSchema,
  sessionExportOutputSchema,
  switchToTabInputSchema,
  switchToTabOutputSchema,
  throttleNetworkInputSchema,
  throttleNetworkOutputSchema,
  dragAndDropInputSchema,
  dragAndDropOutputSchema,
  emulateMediaInputSchema,
  emulateMediaOutputSchema,
  grantPermissionsInputSchema,
  grantPermissionsOutputSchema,
  harExportInputSchema,
  harExportOutputSchema,
  uploadFileInputSchema,
  uploadFileOutputSchema,
  setUserAgentInputSchema,
  setUserAgentOutputSchema,
  waitForSelectorInputSchema,
  waitForSelectorOutputSchema,
  waitForIdleInputSchema,
  waitForIdleOutputSchema,
  waitForNavigationInputSchema,
  waitForNavigationOutputSchema,
  selectOptionInputSchema,
  selectOptionOutputSchema,
  typeTextInputSchema,
  typeTextOutputSchema,
  captureScreenshotInputSchema,
  captureScreenshotOutputSchema,
} from "@brave-mcp/protocol";
import { zodToJsonSchema } from "zod-to-json-schema";

import type { DaemonClient } from "./daemon-client.js";

export const implementedTools = [
  {
    name: "list_tabs",
    description: "List Brave tabs through the local daemon.",
    inputSchema: listTabsInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = listTabsInputSchema.parse(input ?? {});
      const result = await client.call("tabs.list", parsedInput);
      return listTabsOutputSchema.parse(result);
    },
  },
  {
    name: "list_windows",
    description: "List Brave windows through the local daemon.",
    inputSchema: listWindowsInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = listWindowsInputSchema.parse(input ?? {});
      const result = await client.call("windows.list", parsedInput);
      return listWindowsOutputSchema.parse(result);
    },
  },
  {
    name: "get_active_tab",
    description: "Return the active Brave tab through the local daemon.",
    inputSchema: getActiveTabInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = getActiveTabInputSchema.parse(input ?? {});
      const result = await client.call("tabs.getActive", parsedInput);
      return getActiveTabOutputSchema.parse(result);
    },
  },
  {
    name: "get_tab_info",
    description: "Return detailed Brave tab information through the local daemon.",
    inputSchema: getTabInfoInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = getTabInfoInputSchema.parse(input ?? {});
      const result = await client.call("tabs.getInfo", parsedInput);
      return getTabInfoOutputSchema.parse(result);
    },
  },
  {
    name: "get_window_info",
    description: "Return detailed Brave window information through the local daemon.",
    inputSchema: getWindowInfoInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = getWindowInfoInputSchema.parse(input ?? {});
      const result = await client.call("windows.getInfo", parsedInput);
      return getWindowInfoOutputSchema.parse(result);
    },
  },
  {
    name: "open_tab",
    description: "Open a new Brave tab through the local daemon.",
    inputSchema: openTabInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = openTabInputSchema.parse(input ?? {});
      const result = await client.call("tabs.open", parsedInput);
      return openTabOutputSchema.parse(result);
    },
  },
  {
    name: "new_window",
    description: "Open a new Brave window through the local daemon.",
    inputSchema: newWindowInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = newWindowInputSchema.parse(input ?? {});
      const result = await client.call("windows.create", parsedInput);
      return newWindowOutputSchema.parse(result);
    },
  },
  {
    name: "close_tab",
    description: "Close an existing Brave tab through the local daemon.",
    inputSchema: closeTabInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = closeTabInputSchema.parse(input ?? {});
      const result = await client.call("tabs.close", parsedInput);
      return closeTabOutputSchema.parse(result);
    },
  },
  {
    name: "close_window",
    description: "Close an existing Brave window through the local daemon.",
    inputSchema: closeWindowInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = closeWindowInputSchema.parse(input ?? {});
      const result = await client.call("windows.close", parsedInput);
      return closeWindowOutputSchema.parse(result);
    },
  },
  {
    name: "navigate",
    description: "Navigate an existing Brave tab through the local daemon.",
    inputSchema: navigateInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = navigateInputSchema.parse(input ?? {});
      const result = await client.call("tabs.navigate", parsedInput);
      return navigateOutputSchema.parse(result);
    },
  },
  {
    name: "reload_tab",
    description: "Reload an existing Brave tab through the local daemon.",
    inputSchema: reloadTabInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = reloadTabInputSchema.parse(input ?? {});
      const result = await client.call("tabs.reload", parsedInput);
      return reloadTabOutputSchema.parse(result);
    },
  },
  {
    name: "back",
    description: "Navigate a Brave tab backward through the local daemon.",
    inputSchema: backInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = backInputSchema.parse(input ?? {});
      const result = await client.call("tabs.back", parsedInput);
      return backOutputSchema.parse(result);
    },
  },
  {
    name: "forward",
    description: "Navigate a Brave tab forward through the local daemon.",
    inputSchema: forwardInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = forwardInputSchema.parse(input ?? {});
      const result = await client.call("tabs.forward", parsedInput);
      return forwardOutputSchema.parse(result);
    },
  },
  {
    name: "wait_for_navigation",
    description: "Wait for a Brave tab navigation through the local daemon.",
    inputSchema: waitForNavigationInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = waitForNavigationInputSchema.parse(input ?? {});
      const result = await client.call("tabs.waitForNavigation", parsedInput);
      return waitForNavigationOutputSchema.parse(result);
    },
  },
  {
    name: "switch_to_tab",
    description: "Activate an existing Brave tab through the local daemon.",
    inputSchema: switchToTabInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = switchToTabInputSchema.parse(input ?? {});
      const result = await client.call("tabs.switch", parsedInput);
      return switchToTabOutputSchema.parse(result);
    },
  },
  {
    name: "focus_tab",
    description: "Focus an existing Brave tab through the local daemon.",
    inputSchema: focusTabInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = focusTabInputSchema.parse(input ?? {});
      const result = await client.call("tabs.focus", parsedInput);
      return focusTabOutputSchema.parse(result);
    },
  },
  {
    name: "set_viewport",
    description: "Resize a Brave tab window through the local daemon.",
    inputSchema: setViewportInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = setViewportInputSchema.parse(input ?? {});
      const result = await client.call("tabs.setViewport", parsedInput);
      return setViewportOutputSchema.parse(result);
    },
  },
  {
    name: "click",
    description: "Click a page element in Brave through the local daemon.",
    inputSchema: clickInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = clickInputSchema.parse(input ?? {});
      const result = await client.call("dom.click", parsedInput);
      return clickOutputSchema.parse(result);
    },
  },
  {
    name: "hover",
    description: "Hover a page element in Brave through the local daemon.",
    inputSchema: hoverInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = hoverInputSchema.parse(input ?? {});
      const result = await client.call("dom.hover", parsedInput);
      return hoverOutputSchema.parse(result);
    },
  },
  {
    name: "type_text",
    description: "Type into a page element in Brave through the local daemon.",
    inputSchema: typeTextInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = typeTextInputSchema.parse(input ?? {});
      const result = await client.call("dom.type", parsedInput);
      return typeTextOutputSchema.parse(result);
    },
  },
  {
    name: "select_option",
    description: "Select a dropdown option in Brave through the local daemon.",
    inputSchema: selectOptionInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = selectOptionInputSchema.parse(input ?? {});
      const result = await client.call("dom.selectOption", parsedInput);
      return selectOptionOutputSchema.parse(result);
    },
  },
  {
    name: "press_key",
    description: "Press a keyboard key in Brave through the local daemon.",
    inputSchema: pressKeyInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = pressKeyInputSchema.parse(input ?? {});
      const result = await client.call("input.pressKey", parsedInput);
      return pressKeyOutputSchema.parse(result);
    },
  },
  {
    name: "query_elements",
    description: "Inspect multiple page elements in Brave through the local daemon.",
    inputSchema: queryElementsInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = queryElementsInputSchema.parse(input ?? {});
      const result = await client.call("dom.queryElements", parsedInput);
      return queryElementsOutputSchema.parse(result);
    },
  },
  {
    name: "query_selector",
    description: "Inspect a single page element in Brave through the local daemon.",
    inputSchema: querySelectorInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = querySelectorInputSchema.parse(input ?? {});
      const result = await client.call("dom.querySelector", parsedInput);
      return querySelectorOutputSchema.parse(result);
    },
  },
  {
    name: "wait_for_selector",
    description: "Wait for a page element in Brave through the local daemon.",
    inputSchema: waitForSelectorInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = waitForSelectorInputSchema.parse(input ?? {});
      const result = await client.call("dom.waitForSelector", parsedInput);
      return waitForSelectorOutputSchema.parse(result);
    },
  },
  {
    name: "get_visible_text",
    description: "Extract visible text from Brave through the local daemon.",
    inputSchema: getVisibleTextInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = getVisibleTextInputSchema.parse(input ?? {});
      const result = await client.call("dom.getVisibleText", parsedInput);
      return getVisibleTextOutputSchema.parse(result);
    },
  },
  {
    name: "get_dom",
    description: "Extract page HTML from Brave through the local daemon.",
    inputSchema: getDomInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = getDomInputSchema.parse(input ?? {});
      const result = await client.call("dom.getHtml", parsedInput);
      return getDomOutputSchema.parse(result);
    },
  },
  {
    name: "scroll_to",
    description: "Scroll the page in Brave through the local daemon.",
    inputSchema: scrollToInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = scrollToInputSchema.parse(input ?? {});
      const result = await client.call("dom.scrollTo", parsedInput);
      return scrollToOutputSchema.parse(result);
    },
  },
  {
    name: "drag_and_drop",
    description: "Drag and drop page elements in Brave through the local daemon.",
    inputSchema: dragAndDropInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = dragAndDropInputSchema.parse(input ?? {});
      const result = await client.call("dom.dragAndDrop", parsedInput);
      return dragAndDropOutputSchema.parse(result);
    },
  },
  {
    name: "upload_file",
    description: "Upload files to a page input in Brave through the local daemon.",
    inputSchema: uploadFileInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = uploadFileInputSchema.parse(input ?? {});
      const result = await client.call("dom.uploadFiles", parsedInput);
      return uploadFileOutputSchema.parse(result);
    },
  },
  {
    name: "capture_screenshot",
    description: "Capture a Brave tab screenshot through the local daemon.",
    inputSchema: captureScreenshotInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = captureScreenshotInputSchema.parse(input ?? {});
      const result = await client.call("page.captureScreenshot", parsedInput);
      return captureScreenshotOutputSchema.parse(result);
    },
  },
  {
    name: "capture_pdf",
    description: "Render a Brave tab as PDF through the local daemon.",
    inputSchema: capturePdfInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = capturePdfInputSchema.parse(input ?? {});
      const result = await client.call("page.capturePdf", parsedInput);
      return capturePdfOutputSchema.parse(result);
    },
  },
  {
    name: "get_console_logs",
    description: "Read captured console logs from Brave through the local daemon.",
    inputSchema: getConsoleLogsInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = getConsoleLogsInputSchema.parse(input ?? {});
      const result = await client.call("page.getConsoleLogs", parsedInput);
      return getConsoleLogsOutputSchema.parse(result);
    },
  },
  {
    name: "network_log",
    description: "Capture Brave network activity through the local daemon.",
    inputSchema: networkLogInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = networkLogInputSchema.parse(input ?? {});
      const result = await client.call("page.networkLog", parsedInput);
      return networkLogOutputSchema.parse(result);
    },
  },
  {
    name: "cookie_access",
    description: "Read Brave cookies through the local daemon.",
    inputSchema: cookieAccessInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = cookieAccessInputSchema.parse(input ?? {});
      const result = await client.call("storage.cookieAccess", parsedInput);
      return cookieAccessOutputSchema.parse(result);
    },
  },
  {
    name: "request_intercept",
    description: "Configure Brave request interception through the local daemon.",
    inputSchema: requestInterceptInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = requestInterceptInputSchema.parse(input ?? {});
      const result = await client.call("network.requestIntercept", parsedInput);
      return requestInterceptOutputSchema.parse(result);
    },
  },
  {
    name: "mock_response",
    description: "Configure Brave mocked responses through the local daemon.",
    inputSchema: mockResponseInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = mockResponseInputSchema.parse(input ?? {});
      const result = await client.call("network.mockResponse", parsedInput);
      return mockResponseOutputSchema.parse(result);
    },
  },
  {
    name: "throttle_network",
    description: "Apply Brave network throttling through the local daemon.",
    inputSchema: throttleNetworkInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = throttleNetworkInputSchema.parse(input ?? {});
      const result = await client.call("network.throttle", parsedInput);
      return throttleNetworkOutputSchema.parse(result);
    },
  },
  {
    name: "clear_storage",
    description: "Clear Brave cookies and storage through the local daemon.",
    inputSchema: clearStorageInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = clearStorageInputSchema.parse(input ?? {});
      const result = await client.call("storage.clear", parsedInput);
      return clearStorageOutputSchema.parse(result);
    },
  },
  {
    name: "session_export",
    description: "Export Brave session storage and cookies through the local daemon.",
    inputSchema: sessionExportInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = sessionExportInputSchema.parse(input ?? {});
      const result = await client.call("session.export", parsedInput);
      return sessionExportOutputSchema.parse(result);
    },
  },
  {
    name: "set_user_agent",
    description: "Apply a Brave user agent override through the local daemon.",
    inputSchema: setUserAgentInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = setUserAgentInputSchema.parse(input ?? {});
      const result = await client.call("page.setUserAgent", parsedInput);
      return setUserAgentOutputSchema.parse(result);
    },
  },
  {
    name: "emulate_media",
    description: "Apply Brave media emulation through the local daemon.",
    inputSchema: emulateMediaInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = emulateMediaInputSchema.parse(input ?? {});
      const result = await client.call("page.emulateMedia", parsedInput);
      return emulateMediaOutputSchema.parse(result);
    },
  },
  {
    name: "grant_permissions",
    description: "Grant Brave site permissions through the local daemon.",
    inputSchema: grantPermissionsInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = grantPermissionsInputSchema.parse(input ?? {});
      const result = await client.call("browser.grantPermissions", parsedInput);
      return grantPermissionsOutputSchema.parse(result);
    },
  },
  {
    name: "har_export",
    description: "Capture a Brave HAR export through the local daemon.",
    inputSchema: harExportInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = harExportInputSchema.parse(input ?? {});
      const result = await client.call("page.exportHar", parsedInput);
      return harExportOutputSchema.parse(result);
    },
  },
  {
    name: "download_asset",
    description: "Download an asset through the Brave local daemon.",
    inputSchema: downloadAssetInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = downloadAssetInputSchema.parse(input ?? {});
      const result = await client.call("page.downloadAsset", parsedInput);
      return downloadAssetOutputSchema.parse(result);
    },
  },
  {
    name: "wait_for_idle",
    description: "Wait for a Brave page to become idle through the local daemon.",
    inputSchema: waitForIdleInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = waitForIdleInputSchema.parse(input ?? {});
      const result = await client.call("page.waitForIdle", parsedInput);
      return waitForIdleOutputSchema.parse(result);
    },
  },
  {
    name: "execute_javascript",
    description: "Execute JavaScript in Brave through the local daemon.",
    inputSchema: executeJavaScriptInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = executeJavaScriptInputSchema.parse(input ?? {});
      const result = await client.call("page.executeJavaScript", parsedInput);
      return executeJavaScriptOutputSchema.parse(result);
    },
  },
  {
    name: "elements_from_point",
    description: "Inspect page elements at viewport coordinates in Brave.",
    inputSchema: elementsFromPointInputSchema,
    async call(client: DaemonClient, input: unknown) {
      const parsedInput = elementsFromPointInputSchema.parse(input ?? {});
      const result = await client.call("dom.elementsFromPoint", parsedInput);
      return elementsFromPointOutputSchema.parse(result);
    },
  },
] as const;

export type ImplementedToolName = (typeof implementedTools)[number]["name"];

export function getToolDefinitions() {
  return implementedTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: zodToJsonSchema(tool.inputSchema, tool.name),
  }));
}

export async function handleToolCall(
  client: DaemonClient,
  name: string,
  input: unknown,
) {
  const tool = implementedTools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }

  return tool.call(client, input);
}
