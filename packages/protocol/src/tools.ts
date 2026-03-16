import { z } from "zod";

export const selectorTypeSchema = z.enum(["css", "xpath", "text"]);
export type SelectorType = z.infer<typeof selectorTypeSchema>;

export const mutationLevelSchema = z.enum(["read", "write"]);
export type MutationLevel = z.infer<typeof mutationLevelSchema>;

const timeoutSchema = z.number().int().nonnegative();
const tabIdSchema = z.number().int();
const windowIdSchema = z.number().int().nonnegative();
const uriSchema = z.string().url();

export const tabSchema = z.object({
  tabId: tabIdSchema,
  windowId: z.number().int(),
  title: z.string(),
  url: z.string(),
  active: z.boolean(),
});
export type Tab = z.infer<typeof tabSchema>;

export const listTabsInputSchema = z.object({
  windowId: windowIdSchema.optional(),
});

export const listTabsOutputSchema = z.object({
  tabs: z.array(tabSchema),
});

export const listWindowsInputSchema = z.object({
  populateTabs: z.boolean().default(true),
  windowTypes: z.array(z.enum(["normal", "popup"])).default(["normal", "popup"]),
});

export const getActiveTabInputSchema = z.object({
  windowId: windowIdSchema.optional(),
});

export const getActiveTabOutputSchema = z.object({
  tab: tabSchema,
});

export const tabInfoSchema = tabSchema.extend({
  status: z.enum(["loading", "complete"]).optional(),
  favIconUrl: z.string().optional(),
  audible: z.boolean().optional(),
  discarded: z.boolean().optional(),
  pinned: z.boolean().optional(),
  incognito: z.boolean().optional(),
});

export const windowInfoSchema = z.object({
  windowId: windowIdSchema,
  focused: z.boolean(),
  incognito: z.boolean(),
  type: z.enum(["normal", "popup"]),
  top: z.number().int().optional(),
  left: z.number().int().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  tabIds: z.array(tabIdSchema),
});

export const listWindowsOutputSchema = z.object({
  windows: z.array(windowInfoSchema),
});

export const getTabInfoInputSchema = z.object({
  tabId: tabIdSchema,
});

export const getTabInfoOutputSchema = z.object({
  tab: tabInfoSchema,
});

export const getWindowInfoInputSchema = z.object({
  windowId: windowIdSchema,
  populateTabs: z.boolean().default(true),
});

export const getWindowInfoOutputSchema = z.object({
  window: windowInfoSchema,
});

export const openTabInputSchema = z.object({
  url: uriSchema,
  active: z.boolean().default(true),
});

export const openTabOutputSchema = z.object({
  tabId: tabIdSchema,
});

export const newWindowInputSchema = z.object({
  url: uriSchema.optional(),
  focused: z.boolean().default(true),
  incognito: z.boolean().default(false),
  type: z.enum(["normal", "popup"]).default("normal"),
  top: z.number().int().optional(),
  left: z.number().int().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

export const newWindowOutputSchema = z.object({
  window: windowInfoSchema,
  tab: tabSchema.optional(),
});

export const closeTabInputSchema = z.object({
  tabId: tabIdSchema,
});

export const closeTabOutputSchema = z.object({
  closed: z.boolean(),
});

export const closeWindowInputSchema = z.object({
  windowId: windowIdSchema,
});

export const closeWindowOutputSchema = z.object({
  closed: z.boolean(),
});

const waitUntilSchema = z.enum(["load", "domcontentloaded", "networkidle"]);

export const navigateInputSchema = z.object({
  tabId: tabIdSchema,
  url: uriSchema,
  waitUntil: waitUntilSchema.default("load"),
  timeoutMs: timeoutSchema.default(15_000),
});

export const navigateOutputSchema = z.object({
  url: z.string(),
  status: z.enum(["ok", "timeout"]),
});

export const reloadTabInputSchema = z.object({
  tabId: tabIdSchema,
  bypassCache: z.boolean().default(false),
  waitUntil: waitUntilSchema.default("load"),
  timeoutMs: timeoutSchema.default(15_000),
});

export const reloadTabOutputSchema = z.object({
  status: z.enum(["ok", "timeout"]),
});

export const backInputSchema = z.object({
  tabId: tabIdSchema,
  waitUntil: waitUntilSchema.default("load"),
  timeoutMs: timeoutSchema.default(15_000),
});

export const backOutputSchema = z.object({
  url: z.string(),
  status: z.enum(["ok", "timeout"]),
});

export const forwardInputSchema = z.object({
  tabId: tabIdSchema,
  waitUntil: waitUntilSchema.default("load"),
  timeoutMs: timeoutSchema.default(15_000),
});

export const forwardOutputSchema = z.object({
  url: z.string(),
  status: z.enum(["ok", "timeout"]),
});

const selectorTargetSchema = z.object({
  tabId: tabIdSchema,
  selector: z.string().min(1),
  selectorType: selectorTypeSchema.default("css"),
});

export const clickInputSchema = selectorTargetSchema.extend({
  timeoutMs: timeoutSchema.default(10_000),
});

export const clickOutputSchema = z.object({
  clicked: z.boolean(),
});

export const hoverInputSchema = selectorTargetSchema.extend({
  timeoutMs: timeoutSchema.default(10_000),
});

export const hoverOutputSchema = z.object({
  hovered: z.boolean(),
});

export const typeTextInputSchema = selectorTargetSchema.extend({
  text: z.string(),
  clearFirst: z.boolean().default(false),
  timeoutMs: timeoutSchema.default(10_000),
});

export const typeTextOutputSchema = z.object({
  typed: z.boolean(),
});

export const selectOptionInputSchema = selectorTargetSchema
  .extend({
    value: z.string().optional(),
    label: z.string().optional(),
    index: z.number().int().nonnegative().optional(),
    timeoutMs: timeoutSchema.default(10_000),
  })
  .superRefine((value, ctx) => {
    const configured = [value.value, value.label, value.index].filter(
      (candidate) => candidate !== undefined,
    );
    if (configured.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide exactly one of value, label, or index.",
      });
    }
  });

export const selectOptionOutputSchema = z.object({
  selected: z.boolean(),
});

export const pressKeyInputSchema = z.object({
  tabId: tabIdSchema,
  key: z.string().min(1),
  modifiers: z
    .array(z.enum(["Alt", "Control", "Meta", "Shift"]))
    .default([]),
});

export const pressKeyOutputSchema = z.object({
  pressed: z.boolean(),
});

export const waitForSelectorInputSchema = selectorTargetSchema.extend({
  state: z.enum(["attached", "visible"]).default("visible"),
  timeoutMs: timeoutSchema.default(10_000),
});

export const waitForSelectorOutputSchema = z.object({
  found: z.boolean(),
});

export const getVisibleTextInputSchema = z.object({
  tabId: tabIdSchema,
  selector: z.string().min(1).optional(),
  selectorType: selectorTypeSchema.default("css"),
  maxChars: z.number().int().positive().default(12_000),
});

export const getVisibleTextOutputSchema = z.object({
  text: z.string(),
});

export const getDomInputSchema = z.object({
  tabId: tabIdSchema,
  selector: z.string().min(1).optional(),
  selectorType: selectorTypeSchema.default("css"),
  maxChars: z.number().int().positive().default(50_000),
});

export const getDomOutputSchema = z.object({
  html: z.string(),
});

export const queriedElementSchema = z.object({
  tagName: z.string().optional(),
  text: z.string().optional(),
  value: z.string().optional(),
  href: z.string().optional(),
  visible: z.boolean().optional(),
});

export const querySelectorInputSchema = selectorTargetSchema;

export const querySelectorOutputSchema = z.object({
  found: z.boolean(),
  element: queriedElementSchema.optional(),
});

export const queryElementsInputSchema = selectorTargetSchema.extend({
  limit: z.number().int().positive().max(100).default(25),
});

export const queryElementsOutputSchema = z.object({
  count: z.number().int().nonnegative(),
  elements: z.array(queriedElementSchema),
});

export const elementsFromPointInputSchema = z.object({
  tabId: tabIdSchema,
  x: z.number(),
  y: z.number(),
  limit: z.number().int().positive().max(100).default(10),
});

export const elementsFromPointOutputSchema = z.object({
  count: z.number().int().nonnegative(),
  elements: z.array(queriedElementSchema),
});

export const captureScreenshotInputSchema = z.object({
  tabId: tabIdSchema,
  format: z.enum(["png", "jpeg"]).default("png"),
  quality: z.number().int().min(1).max(100).default(90),
});

export const captureScreenshotOutputSchema = z.object({
  mimeType: z.string(),
  base64: z.string(),
});

export const consoleLogEntrySchema = z.object({
  level: z.enum(["log", "info", "warn", "error", "debug"]),
  text: z.string(),
  timestamp: z.number().int(),
});

export const getConsoleLogsInputSchema = z.object({
  tabId: tabIdSchema,
  limit: z.number().int().positive().max(200).default(100),
});

export const getConsoleLogsOutputSchema = z.object({
  entries: z.array(consoleLogEntrySchema),
});

export const waitForNavigationInputSchema = z.object({
  tabId: tabIdSchema,
  waitUntil: waitUntilSchema.default("load"),
  timeoutMs: timeoutSchema.default(15_000),
  urlIncludes: z.string().min(1).optional(),
});

export const waitForNavigationOutputSchema = z.object({
  url: z.string(),
  status: z.enum(["ok", "timeout"]),
});

export const switchToTabInputSchema = z
  .object({
    tabId: tabIdSchema.optional(),
    urlIncludes: z.string().min(1).optional(),
    titleIncludes: z.string().min(1).optional(),
    windowId: windowIdSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.tabId === undefined &&
      value.urlIncludes === undefined &&
      value.titleIncludes === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide tabId, urlIncludes, or titleIncludes.",
      });
    }
  });

export const switchToTabOutputSchema = z.object({
  tab: tabSchema,
});

export const focusTabInputSchema = z.object({
  tabId: tabIdSchema,
});

export const focusTabOutputSchema = z.object({
  tab: tabSchema,
});

export const setViewportInputSchema = z.object({
  tabId: tabIdSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  left: z.number().int().optional(),
  top: z.number().int().optional(),
  focused: z.boolean().default(true),
  timeoutMs: timeoutSchema.default(3_000),
});

export const setViewportOutputSchema = z.object({
  windowId: windowIdSchema,
  viewportWidth: z.number().int().nonnegative(),
  viewportHeight: z.number().int().nonnegative(),
});

export const scrollToInputSchema = z
  .object({
    tabId: tabIdSchema,
    selector: z.string().min(1).optional(),
    selectorType: selectorTypeSchema.default("css"),
    x: z.number().optional(),
    y: z.number().optional(),
    behavior: z.enum(["auto", "smooth"]).default("auto"),
    block: z.enum(["start", "center", "end", "nearest"]).default("center"),
    timeoutMs: timeoutSchema.default(10_000),
  })
  .superRefine((value, ctx) => {
    if (value.selector === undefined && (value.x === undefined || value.y === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide selector or both x and y coordinates.",
      });
    }
  });

export const scrollToOutputSchema = z.object({
  scrolled: z.boolean(),
  x: z.number(),
  y: z.number(),
});

export const waitForIdleInputSchema = z.object({
  tabId: tabIdSchema,
  idleMs: z.number().int().positive().default(500),
  timeoutMs: timeoutSchema.default(10_000),
});

export const waitForIdleOutputSchema = z.object({
  idle: z.boolean(),
  status: z.enum(["ok", "timeout"]),
});

export const dragAndDropInputSchema = z.object({
  tabId: tabIdSchema,
  selector: z.string().min(1),
  selectorType: selectorTypeSchema.default("css"),
  targetSelector: z.string().min(1),
  targetSelectorType: selectorTypeSchema.default("css"),
  timeoutMs: timeoutSchema.default(10_000),
});

export const dragAndDropOutputSchema = z.object({
  dropped: z.boolean(),
});

export const uploadFileItemSchema = z.object({
  name: z.string().min(1),
  mimeType: z.string().min(1).default("application/octet-stream"),
  base64: z.string().min(1),
  lastModified: z.number().int().nonnegative().optional(),
});

export const uploadFileInputSchema = z.object({
  tabId: tabIdSchema,
  selector: z.string().min(1),
  selectorType: selectorTypeSchema.default("css"),
  files: z.array(uploadFileItemSchema).min(1).max(10),
  timeoutMs: timeoutSchema.default(10_000),
});

export const uploadFileOutputSchema = z.object({
  uploaded: z.boolean(),
  fileCount: z.number().int().nonnegative(),
});

export const downloadAssetInputSchema = z.object({
  url: z.string().min(1),
  tabId: tabIdSchema.optional(),
  timeoutMs: timeoutSchema.default(15_000),
  maxBytes: z.number().int().positive().default(2_000_000),
});

export const downloadAssetOutputSchema = z.object({
  finalUrl: z.string(),
  mimeType: z.string(),
  base64: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  status: z.enum(["ok", "too_large"]),
});

export const capturePdfInputSchema = z.object({
  tabId: tabIdSchema,
  landscape: z.boolean().default(false),
  printBackground: z.boolean().default(false),
  scale: z.number().positive().default(1),
  paperWidth: z.number().positive().default(8.5),
  paperHeight: z.number().positive().default(11),
  marginTop: z.number().nonnegative().default(0.4),
  marginBottom: z.number().nonnegative().default(0.4),
  marginLeft: z.number().nonnegative().default(0.4),
  marginRight: z.number().nonnegative().default(0.4),
  pageRanges: z.string().optional(),
  preferCSSPageSize: z.boolean().default(false),
  timeoutMs: timeoutSchema.default(15_000),
  maxBytes: z.number().int().positive().default(10_000_000),
});

export const capturePdfOutputSchema = z.object({
  mimeType: z.literal("application/pdf"),
  base64: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  status: z.enum(["ok", "too_large"]),
});

export const networkLogEntrySchema = z.object({
  requestId: z.string(),
  url: z.string(),
  method: z.string(),
  type: z.string().optional(),
  status: z.number().int().optional(),
  statusText: z.string().optional(),
  mimeType: z.string().optional(),
  fromCache: z.boolean().optional(),
  failed: z.boolean().optional(),
  errorText: z.string().optional(),
  encodedDataLength: z.number().nonnegative().optional(),
  bodyBase64: z.string().optional(),
});

export const networkLogInputSchema = z.object({
  tabId: tabIdSchema,
  durationMs: z.number().int().positive().default(1500),
  maxEntries: z.number().int().positive().max(500).default(100),
  includeBodies: z.boolean().default(false),
  reloadFirst: z.boolean().default(false),
  urlIncludes: z.string().min(1).optional(),
});

export const networkLogOutputSchema = z.object({
  entries: z.array(networkLogEntrySchema),
});

export const cookieInfoSchema = z.object({
  name: z.string(),
  value: z.string(),
  domain: z.string(),
  path: z.string(),
  secure: z.boolean(),
  httpOnly: z.boolean(),
  session: z.boolean(),
  sameSite: z.string(),
  storeId: z.string(),
  expirationDate: z.number().optional(),
});

export const cookieAccessInputSchema = z
  .object({
    tabId: tabIdSchema.optional(),
    url: z.string().url().optional(),
    domain: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    secure: z.boolean().optional(),
    session: z.boolean().optional(),
    storeId: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.tabId === undefined && value.url === undefined && value.domain === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide tabId, url, or domain.",
      });
    }
  });

export const cookieAccessOutputSchema = z.object({
  cookies: z.array(cookieInfoSchema),
});

export const networkResourceTypeSchema = z.enum([
  "Document",
  "Stylesheet",
  "Image",
  "Media",
  "Font",
  "Script",
  "TextTrack",
  "XHR",
  "Fetch",
  "Prefetch",
  "EventSource",
  "WebSocket",
  "Manifest",
  "SignedExchange",
  "Ping",
  "CSPViolationReport",
  "Preflight",
  "Other",
]);

export const headerEntrySchema = z.object({
  name: z.string().min(1),
  value: z.string(),
});

export const requestInterceptInputSchema = z
  .object({
    tabId: tabIdSchema,
    enabled: z.boolean().default(true),
    urlPattern: z.string().min(1).optional(),
    resourceTypes: z.array(networkResourceTypeSchema).min(1).optional(),
    action: z.enum(["continue", "fail"]).default("continue"),
    failReason: z
      .enum([
        "Failed",
        "Aborted",
        "TimedOut",
        "AccessDenied",
        "ConnectionClosed",
        "ConnectionReset",
        "ConnectionRefused",
        "ConnectionAborted",
        "ConnectionFailed",
        "NameNotResolved",
        "InternetDisconnected",
        "AddressUnreachable",
        "BlockedByClient",
        "BlockedByResponse",
      ])
      .default("BlockedByClient"),
    method: z.string().min(1).optional(),
    headers: z.array(headerEntrySchema).optional(),
    postDataBase64: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.enabled && value.urlPattern === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide urlPattern when enabled=true.",
      });
    }
  });

export const requestInterceptOutputSchema = z.object({
  configured: z.boolean(),
  activeRules: z.number().int().nonnegative(),
});

export const mockResponseInputSchema = z
  .object({
    tabId: tabIdSchema,
    enabled: z.boolean().default(true),
    urlPattern: z.string().min(1).optional(),
    resourceTypes: z.array(networkResourceTypeSchema).min(1).optional(),
    statusCode: z.number().int().min(100).max(599).default(200),
    headers: z.array(headerEntrySchema).default([]),
    bodyText: z.string().optional(),
    bodyBase64: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.enabled && value.urlPattern === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide urlPattern when enabled=true.",
      });
    }
    if (value.bodyText !== undefined && value.bodyBase64 !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide only one of bodyText or bodyBase64.",
      });
    }
  });

export const mockResponseOutputSchema = z.object({
  configured: z.boolean(),
  activeRules: z.number().int().nonnegative(),
});

export const throttleNetworkInputSchema = z.object({
  tabId: tabIdSchema,
  enabled: z.boolean().default(true),
  offline: z.boolean().default(false),
  latencyMs: z.number().nonnegative().default(0),
  downloadThroughput: z.number().nonnegative().default(-1),
  uploadThroughput: z.number().nonnegative().default(-1),
  connectionType: z
    .enum([
      "none",
      "cellular2g",
      "cellular3g",
      "cellular4g",
      "bluetooth",
      "ethernet",
      "wifi",
      "wimax",
      "other",
    ])
    .optional(),
});

export const throttleNetworkOutputSchema = z.object({
  enabled: z.boolean(),
  offline: z.boolean(),
  latencyMs: z.number().nonnegative(),
  downloadThroughput: z.number(),
  uploadThroughput: z.number(),
});

export const clearStorageInputSchema = z
  .object({
    tabId: tabIdSchema.optional(),
    url: z.string().url().optional(),
    clearCookies: z.boolean().default(true),
    clearLocalStorage: z.boolean().default(true),
    clearSessionStorage: z.boolean().default(true),
    clearIndexedDb: z.boolean().default(true),
    clearCacheStorage: z.boolean().default(true),
    clearServiceWorkers: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.tabId === undefined && value.url === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide tabId or url.",
      });
    }
  });

export const clearStorageOutputSchema = z.object({
  origin: z.string(),
  clearedCookies: z.number().int().nonnegative(),
  clearedStorageTypes: z.array(z.string()),
  localStorageCleared: z.boolean(),
  sessionStorageCleared: z.boolean(),
});

export const sessionExportInputSchema = z.object({
  tabId: tabIdSchema,
  includeCookies: z.boolean().default(true),
  includeLocalStorage: z.boolean().default(true),
  includeSessionStorage: z.boolean().default(true),
  includeHtml: z.boolean().default(false),
  maxHtmlChars: z.number().int().positive().default(20_000),
});

export const sessionExportOutputSchema = z.object({
  url: z.string(),
  title: z.string(),
  cookies: z.array(cookieInfoSchema),
  localStorage: z.record(z.string()),
  sessionStorage: z.record(z.string()),
  historyLength: z.number().int().nonnegative(),
  html: z.string().optional(),
});

export const setUserAgentInputSchema = z.object({
  tabId: tabIdSchema,
  enabled: z.boolean().default(true),
  userAgent: z.string().min(1).optional(),
  acceptLanguage: z.string().min(1).optional(),
  platform: z.string().min(1).optional(),
});

export const setUserAgentOutputSchema = z.object({
  enabled: z.boolean(),
  userAgent: z.string(),
  acceptLanguage: z.string().optional(),
  platform: z.string().optional(),
});

export const mediaFeatureSchema = z.object({
  name: z.string().min(1),
  value: z.string(),
});

export const emulateMediaInputSchema = z.object({
  tabId: tabIdSchema,
  enabled: z.boolean().default(true),
  media: z.string().default("screen"),
  features: z.array(mediaFeatureSchema).max(10).default([]),
});

export const emulateMediaOutputSchema = z.object({
  enabled: z.boolean(),
  media: z.string(),
  featureCount: z.number().int().nonnegative(),
});

export const geolocationOverrideInputSchema = z.object({
  tabId: tabIdSchema,
  enabled: z.boolean().default(true),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  accuracy: z.number().nonnegative().default(10),
  altitude: z.number().optional(),
  altitudeAccuracy: z.number().nonnegative().optional(),
  heading: z.number().min(0).max(360).optional(),
  speed: z.number().nonnegative().optional(),
});

export const geolocationOverrideOutputSchema = z.object({
  enabled: z.boolean(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  accuracy: z.number().optional(),
});

export const permissionNameSchema = z.enum([
  "geolocation",
  "notifications",
  "microphone",
  "camera",
]);

export const grantPermissionsInputSchema = z
  .object({
    tabId: tabIdSchema.optional(),
    url: z.string().url().optional(),
    permissions: z.array(permissionNameSchema).min(1),
    setting: z.enum(["allow", "block", "ask"]).default("allow"),
  })
  .superRefine((value, ctx) => {
    if (value.tabId === undefined && value.url === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide tabId or url.",
      });
    }
  });

export const grantPermissionsOutputSchema = z.object({
  origin: z.string(),
  setting: z.enum(["allow", "block", "ask"]),
  appliedPermissions: z.array(permissionNameSchema),
});

export const harExportInputSchema = z.object({
  tabId: tabIdSchema,
  durationMs: z.number().int().positive().default(1500),
  reloadFirst: z.boolean().default(false),
  includeBodies: z.boolean().default(false),
  maxEntries: z.number().int().positive().max(500).default(100),
  urlIncludes: z.string().min(1).optional(),
});

export const harExportOutputSchema = z.object({
  mimeType: z.literal("application/json"),
  harJson: z.string(),
  entryCount: z.number().int().nonnegative(),
});

export const executeJavaScriptInputSchema = z.object({
  tabId: tabIdSchema,
  code: z.string().min(1),
  world: z.enum(["isolated", "main"]).default("isolated"),
  awaitPromise: z.boolean().default(true),
});

export const executeJavaScriptOutputSchema = z.object({
  resultType: z.string(),
  resultJson: z.string(),
});

const toolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  mutationLevel: mutationLevelSchema,
  capabilities: z.array(z.string()).min(1),
  inputSchema: z.custom<z.ZodTypeAny>(),
  outputSchema: z.custom<z.ZodTypeAny>(),
});

export const toolCatalog = [
  {
    name: "list_tabs",
    description: "List open Brave tabs known to the extension.",
    mutationLevel: "read",
    capabilities: ["tabs"],
    inputSchema: listTabsInputSchema,
    outputSchema: listTabsOutputSchema,
  },
  {
    name: "list_windows",
    description: "List Brave browser windows.",
    mutationLevel: "read",
    capabilities: ["windows"],
    inputSchema: listWindowsInputSchema,
    outputSchema: listWindowsOutputSchema,
  },
  {
    name: "get_active_tab",
    description: "Return the active tab for the current Brave window.",
    mutationLevel: "read",
    capabilities: ["tabs"],
    inputSchema: getActiveTabInputSchema,
    outputSchema: getActiveTabOutputSchema,
  },
  {
    name: "get_tab_info",
    description: "Return detailed information for a Brave tab.",
    mutationLevel: "read",
    capabilities: ["tabs"],
    inputSchema: getTabInfoInputSchema,
    outputSchema: getTabInfoOutputSchema,
  },
  {
    name: "get_window_info",
    description: "Return detailed information for a Brave window.",
    mutationLevel: "read",
    capabilities: ["windows"],
    inputSchema: getWindowInfoInputSchema,
    outputSchema: getWindowInfoOutputSchema,
  },
  {
    name: "open_tab",
    description: "Open a new tab at a URL and optionally activate it.",
    mutationLevel: "write",
    capabilities: ["tabs", "navigation"],
    inputSchema: openTabInputSchema,
    outputSchema: openTabOutputSchema,
  },
  {
    name: "new_window",
    description: "Open a new Brave window and optionally navigate it.",
    mutationLevel: "write",
    capabilities: ["windows", "navigation"],
    inputSchema: newWindowInputSchema,
    outputSchema: newWindowOutputSchema,
  },
  {
    name: "close_tab",
    description: "Close an open tab.",
    mutationLevel: "write",
    capabilities: ["tabs"],
    inputSchema: closeTabInputSchema,
    outputSchema: closeTabOutputSchema,
  },
  {
    name: "close_window",
    description: "Close an open Brave window.",
    mutationLevel: "write",
    capabilities: ["windows"],
    inputSchema: closeWindowInputSchema,
    outputSchema: closeWindowOutputSchema,
  },
  {
    name: "navigate",
    description: "Navigate an existing tab to a URL.",
    mutationLevel: "write",
    capabilities: ["navigation"],
    inputSchema: navigateInputSchema,
    outputSchema: navigateOutputSchema,
  },
  {
    name: "reload_tab",
    description: "Reload a tab and wait for a target readiness state.",
    mutationLevel: "write",
    capabilities: ["navigation"],
    inputSchema: reloadTabInputSchema,
    outputSchema: reloadTabOutputSchema,
  },
  {
    name: "back",
    description: "Navigate a tab backward in its history.",
    mutationLevel: "write",
    capabilities: ["navigation", "history"],
    inputSchema: backInputSchema,
    outputSchema: backOutputSchema,
  },
  {
    name: "forward",
    description: "Navigate a tab forward in its history.",
    mutationLevel: "write",
    capabilities: ["navigation", "history"],
    inputSchema: forwardInputSchema,
    outputSchema: forwardOutputSchema,
  },
  {
    name: "wait_for_navigation",
    description: "Wait for navigation to complete in a Brave tab.",
    mutationLevel: "read",
    capabilities: ["navigation", "timing"],
    inputSchema: waitForNavigationInputSchema,
    outputSchema: waitForNavigationOutputSchema,
  },
  {
    name: "switch_to_tab",
    description: "Activate an existing Brave tab by id or by a URL/title match.",
    mutationLevel: "write",
    capabilities: ["tabs", "navigation"],
    inputSchema: switchToTabInputSchema,
    outputSchema: switchToTabOutputSchema,
  },
  {
    name: "focus_tab",
    description: "Focus an existing Brave tab by id.",
    mutationLevel: "write",
    capabilities: ["tabs", "navigation"],
    inputSchema: focusTabInputSchema,
    outputSchema: focusTabOutputSchema,
  },
  {
    name: "set_viewport",
    description: "Resize the containing window to target a viewport size.",
    mutationLevel: "write",
    capabilities: ["windows", "navigation"],
    inputSchema: setViewportInputSchema,
    outputSchema: setViewportOutputSchema,
  },
  {
    name: "click",
    description: "Click an element in the page.",
    mutationLevel: "write",
    capabilities: ["dom", "input"],
    inputSchema: clickInputSchema,
    outputSchema: clickOutputSchema,
  },
  {
    name: "hover",
    description: "Hover over an element in the page.",
    mutationLevel: "write",
    capabilities: ["dom", "input"],
    inputSchema: hoverInputSchema,
    outputSchema: hoverOutputSchema,
  },
  {
    name: "type_text",
    description: "Type text into a focused or selected element.",
    mutationLevel: "write",
    capabilities: ["dom", "input"],
    inputSchema: typeTextInputSchema,
    outputSchema: typeTextOutputSchema,
  },
  {
    name: "select_option",
    description: "Select an option in a page dropdown element.",
    mutationLevel: "write",
    capabilities: ["dom", "input"],
    inputSchema: selectOptionInputSchema,
    outputSchema: selectOptionOutputSchema,
  },
  {
    name: "press_key",
    description: "Press a keyboard key in the page context.",
    mutationLevel: "write",
    capabilities: ["input"],
    inputSchema: pressKeyInputSchema,
    outputSchema: pressKeyOutputSchema,
  },
  {
    name: "wait_for_selector",
    description: "Wait for an element to appear or become visible.",
    mutationLevel: "read",
    capabilities: ["dom", "timing"],
    inputSchema: waitForSelectorInputSchema,
    outputSchema: waitForSelectorOutputSchema,
  },
  {
    name: "get_visible_text",
    description: "Extract visible text from the page or a scoped element.",
    mutationLevel: "read",
    capabilities: ["dom", "content"],
    inputSchema: getVisibleTextInputSchema,
    outputSchema: getVisibleTextOutputSchema,
  },
  {
    name: "get_dom",
    description: "Extract serialized HTML from the page or a scoped element.",
    mutationLevel: "read",
    capabilities: ["dom", "content"],
    inputSchema: getDomInputSchema,
    outputSchema: getDomOutputSchema,
  },
  {
    name: "query_selector",
    description: "Inspect a single matched element and return useful metadata.",
    mutationLevel: "read",
    capabilities: ["dom"],
    inputSchema: querySelectorInputSchema,
    outputSchema: querySelectorOutputSchema,
  },
  {
    name: "query_elements",
    description: "Inspect multiple matched elements and return useful metadata.",
    mutationLevel: "read",
    capabilities: ["dom"],
    inputSchema: queryElementsInputSchema,
    outputSchema: queryElementsOutputSchema,
  },
  {
    name: "elements_from_point",
    description: "Return the DOM elements stacked at viewport coordinates.",
    mutationLevel: "read",
    capabilities: ["dom"],
    inputSchema: elementsFromPointInputSchema,
    outputSchema: elementsFromPointOutputSchema,
  },
  {
    name: "scroll_to",
    description: "Scroll the page to a selector or viewport coordinates.",
    mutationLevel: "write",
    capabilities: ["dom", "navigation"],
    inputSchema: scrollToInputSchema,
    outputSchema: scrollToOutputSchema,
  },
  {
    name: "drag_and_drop",
    description: "Drag one page element and drop it onto another element.",
    mutationLevel: "write",
    capabilities: ["dom", "input"],
    inputSchema: dragAndDropInputSchema,
    outputSchema: dragAndDropOutputSchema,
  },
  {
    name: "upload_file",
    description: "Upload one or more in-memory files to a page file input.",
    mutationLevel: "write",
    capabilities: ["dom", "input", "files"],
    inputSchema: uploadFileInputSchema,
    outputSchema: uploadFileOutputSchema,
  },
  {
    name: "download_asset",
    description: "Download an asset by URL through the Brave companion.",
    mutationLevel: "read",
    capabilities: ["network", "files"],
    inputSchema: downloadAssetInputSchema,
    outputSchema: downloadAssetOutputSchema,
  },
  {
    name: "capture_pdf",
    description: "Render the current page as a PDF.",
    mutationLevel: "read",
    capabilities: ["pdf", "files"],
    inputSchema: capturePdfInputSchema,
    outputSchema: capturePdfOutputSchema,
  },
  {
    name: "capture_screenshot",
    description: "Capture a screenshot of the visible tab viewport.",
    mutationLevel: "read",
    capabilities: ["screenshot"],
    inputSchema: captureScreenshotInputSchema,
    outputSchema: captureScreenshotOutputSchema,
  },
  {
    name: "get_console_logs",
    description: "Return captured console logs from a page.",
    mutationLevel: "read",
    capabilities: ["console", "diagnostics"],
    inputSchema: getConsoleLogsInputSchema,
    outputSchema: getConsoleLogsOutputSchema,
  },
  {
    name: "network_log",
    description: "Capture a short network activity log from a page.",
    mutationLevel: "read",
    capabilities: ["network", "diagnostics"],
    inputSchema: networkLogInputSchema,
    outputSchema: networkLogOutputSchema,
  },
  {
    name: "cookie_access",
    description: "Read cookies visible to the extension for a target URL or tab.",
    mutationLevel: "read",
    capabilities: ["cookies", "diagnostics"],
    inputSchema: cookieAccessInputSchema,
    outputSchema: cookieAccessOutputSchema,
  },
  {
    name: "request_intercept",
    description: "Configure tab-scoped request interception rules.",
    mutationLevel: "write",
    capabilities: ["network", "intercept"],
    inputSchema: requestInterceptInputSchema,
    outputSchema: requestInterceptOutputSchema,
  },
  {
    name: "mock_response",
    description: "Configure tab-scoped mocked network responses.",
    mutationLevel: "write",
    capabilities: ["network", "intercept"],
    inputSchema: mockResponseInputSchema,
    outputSchema: mockResponseOutputSchema,
  },
  {
    name: "throttle_network",
    description: "Apply or clear network throttling for a tab.",
    mutationLevel: "write",
    capabilities: ["network", "timing"],
    inputSchema: throttleNetworkInputSchema,
    outputSchema: throttleNetworkOutputSchema,
  },
  {
    name: "clear_storage",
    description: "Clear cookies and web storage for a tab origin.",
    mutationLevel: "write",
    capabilities: ["storage", "cookies"],
    inputSchema: clearStorageInputSchema,
    outputSchema: clearStorageOutputSchema,
  },
  {
    name: "session_export",
    description: "Export cookies and web storage for a tab session.",
    mutationLevel: "read",
    capabilities: ["storage", "cookies", "content"],
    inputSchema: sessionExportInputSchema,
    outputSchema: sessionExportOutputSchema,
  },
  {
    name: "set_user_agent",
    description: "Apply or clear a tab-scoped user agent override.",
    mutationLevel: "write",
    capabilities: ["network", "emulation"],
    inputSchema: setUserAgentInputSchema,
    outputSchema: setUserAgentOutputSchema,
  },
  {
    name: "emulate_media",
    description: "Apply or clear tab-scoped media emulation.",
    mutationLevel: "write",
    capabilities: ["emulation", "css"],
    inputSchema: emulateMediaInputSchema,
    outputSchema: emulateMediaOutputSchema,
  },
  {
    name: "grant_permissions",
    description: "Grant or reset site permissions for a page origin.",
    mutationLevel: "write",
    capabilities: ["permissions"],
    inputSchema: grantPermissionsInputSchema,
    outputSchema: grantPermissionsOutputSchema,
  },
  {
    name: "har_export",
    description: "Capture a HAR-formatted network trace from a page.",
    mutationLevel: "read",
    capabilities: ["network", "diagnostics", "files"],
    inputSchema: harExportInputSchema,
    outputSchema: harExportOutputSchema,
  },
  {
    name: "wait_for_idle",
    description: "Wait for a page to become mutation-idle for a target interval.",
    mutationLevel: "read",
    capabilities: ["timing", "dom"],
    inputSchema: waitForIdleInputSchema,
    outputSchema: waitForIdleOutputSchema,
  },
  {
    name: "execute_javascript",
    description: "Execute JavaScript in the tab context and return a serialized result.",
    mutationLevel: "write",
    capabilities: ["dom", "javascript"],
    inputSchema: executeJavaScriptInputSchema,
    outputSchema: executeJavaScriptOutputSchema,
  },
] as const satisfies ReadonlyArray<z.infer<typeof toolDefinitionSchema>>;

export type ToolDefinition = (typeof toolCatalog)[number];
export type ToolName = ToolDefinition["name"];
