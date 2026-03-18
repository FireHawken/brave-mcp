interface ExtensionSettings {
  daemonUrl: string;
  authToken: string;
}

interface BridgeStatus {
  state: "disconnected" | "connecting" | "connected";
  daemonUrl: string;
  authConfigured: boolean;
  lastAttemptAt: string | null;
  lastConnectedAt: string | null;
  lastError: string | null;
}

const DEFAULT_DAEMON_URL = "ws://127.0.0.1:39200/extension/connect";

interface QueryOverrides {
  daemonUrl?: string;
  authToken?: string;
  autosave: boolean;
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

async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await getStorage().set(settings);
}

function readQueryOverrides(): QueryOverrides {
  const params = new URLSearchParams(window.location.search);
  const daemonUrl = params.get("daemonUrl")?.trim() || undefined;
  const authToken = params.get("authToken")?.trim() || undefined;
  const autosaveValue = params.get("autosave")?.trim().toLowerCase();

  return {
    daemonUrl,
    authToken,
    autosave: autosaveValue === "1" || autosaveValue === "true",
  };
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element: ${id}`);
  }

  return element as T;
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "Never";
  }

  return new Date(value).toLocaleString();
}

function renderBridgeStatus(status: BridgeStatus): string {
  const stateLabel =
    status.state === "connected"
      ? "Connected"
      : status.state === "connecting"
        ? "Connecting"
        : "Disconnected";

  const lines = [
    `State: ${stateLabel}`,
    `Daemon URL: ${status.daemonUrl}`,
    `Auth token configured: ${status.authConfigured ? "Yes" : "No"}`,
    `Last attempt: ${formatTimestamp(status.lastAttemptAt)}`,
    `Last connected: ${formatTimestamp(status.lastConnectedAt)}`,
  ];

  if (status.lastError) {
    lines.push(`Last error: ${status.lastError}`);
  }

  return lines.join("\n");
}

async function requestBridgeStatus(): Promise<BridgeStatus> {
  return chrome.runtime.sendMessage({
    type: "get-bridge-status",
  }) as Promise<BridgeStatus>;
}

async function requestReconnect(): Promise<BridgeStatus> {
  return chrome.runtime.sendMessage({
    type: "reconnect-bridge",
  }) as Promise<BridgeStatus>;
}

async function persistAndReconnect(
  daemonUrl: string,
  authToken: string,
): Promise<BridgeStatus> {
  await saveSettings({
    daemonUrl: daemonUrl.trim() || DEFAULT_DAEMON_URL,
    authToken: authToken.trim(),
  });

  return requestReconnect();
}

async function main(): Promise<void> {
  const form = byId<HTMLFormElement>("settings-form");
  const daemonUrlInput = byId<HTMLInputElement>("daemon-url");
  const authTokenInput = byId<HTMLInputElement>("auth-token");
  const status = byId<HTMLParagraphElement>("status");
  const bridgeStatus = byId<HTMLPreElement>("bridge-status");
  const reconnectButton = byId<HTMLButtonElement>("reconnect-button");

  const settings = await loadSettings();
  const queryOverrides = readQueryOverrides();

  daemonUrlInput.value = queryOverrides.daemonUrl ?? settings.daemonUrl;
  authTokenInput.value = queryOverrides.authToken ?? settings.authToken;

  let latestStatus: BridgeStatus;
  if (
    queryOverrides.autosave &&
    (queryOverrides.daemonUrl !== undefined ||
      queryOverrides.authToken !== undefined)
  ) {
    latestStatus = await persistAndReconnect(
      daemonUrlInput.value,
      authTokenInput.value,
    );
    status.textContent = "Saved from launch parameters and reconnect requested.";
  } else {
    latestStatus = await requestBridgeStatus();
  }

  bridgeStatus.textContent = renderBridgeStatus(latestStatus);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
      const latestStatus = await persistAndReconnect(
        daemonUrlInput.value,
        authTokenInput.value,
      );
      bridgeStatus.textContent = renderBridgeStatus(latestStatus);
      status.textContent = "Saved and reconnect requested.";
    })();
  });

  reconnectButton.addEventListener("click", () => {
    void (async () => {
      const latestStatus = await requestReconnect();
      bridgeStatus.textContent = renderBridgeStatus(latestStatus);
      status.textContent = "Reconnect requested.";
    })();
  });

  window.setInterval(() => {
    void (async () => {
      bridgeStatus.textContent = renderBridgeStatus(await requestBridgeStatus());
    })();
  }, 2_000);
}

void main();
