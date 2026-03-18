import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 39200;
const DEFAULT_CONFIG_DIR = "/tmp/brave-mcp-smoke";
const DEFAULT_BRAVE_APP = "Brave Browser";
const DEFAULT_PROFILE_DIR = "/tmp/brave-mcp-profile";
const DEFAULT_HEALTH_TIMEOUT_MS = 15_000;
const DEFAULT_READY_TIMEOUT_MS = 15_000;

function parseArgs(argv) {
  const options = {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    configDir: DEFAULT_CONFIG_DIR,
    braveApp: DEFAULT_BRAVE_APP,
    profileDir: "",
    loadExtension: false,
    openFreshWindow: false,
    silentDaemon: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--host") {
      options.host = argv[index + 1] ?? DEFAULT_HOST;
      index += 1;
      continue;
    }
    if (value === "--port") {
      options.port = Number(argv[index + 1] ?? DEFAULT_PORT);
      index += 1;
      continue;
    }
    if (value === "--config-dir") {
      options.configDir = argv[index + 1] ?? DEFAULT_CONFIG_DIR;
      index += 1;
      continue;
    }
    if (value === "--brave-app") {
      options.braveApp = argv[index + 1] ?? DEFAULT_BRAVE_APP;
      index += 1;
      continue;
    }
    if (value === "--profile-dir") {
      options.profileDir = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (value === "--load-extension") {
      options.loadExtension = true;
      continue;
    }
    if (value === "--open-fresh-window") {
      options.openFreshWindow = true;
      continue;
    }
    if (value === "--daemon-logs") {
      options.silentDaemon = false;
      continue;
    }
    throw new Error(`Unknown argument: ${value}`);
  }

  if (!Number.isInteger(options.port) || options.port <= 0) {
    throw new Error(`Invalid port: ${options.port}`);
  }

  return options;
}

async function sleep(ms) {
  await new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unexpected status ${response.status} from ${url}`);
  }

  return response.json();
}

async function waitForHealth(baseUrl, timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await fetchJson(`${baseUrl}/healthz`);
    } catch {
      await sleep(250);
    }
  }

  throw new Error(`Timed out waiting for ${baseUrl}/healthz`);
}

async function getReadyState(baseUrl) {
  try {
    return await fetchJson(`${baseUrl}/readyz`);
  } catch {
    return null;
  }
}

async function waitForReady(baseUrl, timeoutMs = DEFAULT_READY_TIMEOUT_MS) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const readyState = await getReadyState(baseUrl);
    if (readyState?.extensionConnected && readyState?.paired) {
      return readyState;
    }

    await sleep(250);
  }

  return getReadyState(baseUrl);
}

function spawnDaemon({ host, port, configDir, silentDaemon }) {
  const daemonEntryPath = resolve(repoRoot, "apps/daemon/dist/index.js");
  const daemonArgs = [
    daemonEntryPath,
    "--host",
    host,
    "--port",
    String(port),
    "--config-dir",
    configDir,
  ];

  if (silentDaemon) {
    daemonArgs.push("--silent");
  }

  const child = spawn(process.execPath, daemonArgs, {
    cwd: repoRoot,
    stdio: silentDaemon ? "ignore" : "inherit",
  });

  child.unref();
}

function resolveBraveExecutable(braveApp) {
  if (braveApp.includes("/")) {
    return braveApp;
  }

  return `/Applications/${braveApp}.app/Contents/MacOS/${braveApp}`;
}

function openBrave({
  braveApp,
  host,
  port,
  profileDir,
  loadExtension,
  openFreshWindow,
}) {
  const extensionDistPath = resolve(repoRoot, "apps/extension/dist");
  const braveExecutable = resolveBraveExecutable(braveApp);
  const launchTarget = `http://${host}:${port}/readyz`;
  const args = ["--no-first-run", "--no-default-browser-check"];

  if (profileDir) {
    args.push(`--user-data-dir=${profileDir}`);
  }

  if (loadExtension) {
    if (!existsSync(extensionDistPath)) {
      throw new Error(
        `Extension bundle not found at ${extensionDistPath}. Run npm run build:extension first.`,
      );
    }

    args.push(`--disable-extensions-except=${extensionDistPath}`);
    args.push(`--load-extension=${extensionDistPath}`);
  }

  if (openFreshWindow) {
    args.push("--new-window");
  }

  args.push(launchTarget);

  const child = spawn(braveExecutable, args, {
    cwd: repoRoot,
    stdio: "ignore",
  });
  child.unref();

  return new Promise((resolvePromise, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("spawn", () => {
      resolvePromise();
    });
  });
}

function readDaemonSecret(configDir) {
  const configPath = resolve(configDir, "daemon-config.json");
  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    return typeof parsed.secret === "string" && parsed.secret.length > 0
      ? parsed.secret
      : null;
  } catch {
    return null;
  }
}

function tryReadPreferences(profileDir) {
  const candidatePaths = [
    resolve(profileDir, "Default", "Preferences"),
    resolve(profileDir, "Default", "Secure Preferences"),
  ];

  for (const preferencesPath of candidatePaths) {
    if (!existsSync(preferencesPath)) {
      continue;
    }

    try {
      const parsed = JSON.parse(readFileSync(preferencesPath, "utf8"));
      const settings = parsed?.extensions?.settings;
      if (settings && typeof settings === "object") {
        return parsed;
      }
    } catch {
      // Continue to the next candidate file.
    }
  }

  return null;
}

async function waitForExtensionId(profileDir, extensionPath, timeoutMs = 10_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const preferences = tryReadPreferences(profileDir);
    const settings = preferences?.extensions?.settings;
    if (settings && typeof settings === "object") {
      for (const [extensionId, extensionInfo] of Object.entries(settings)) {
        if (
          extensionInfo &&
          typeof extensionInfo === "object" &&
          typeof extensionInfo.path === "string" &&
          resolve(extensionInfo.path) === extensionPath
        ) {
          return extensionId;
        }
      }
    }

    await sleep(250);
  }

  return null;
}

async function openExtensionOptions({
  braveApp,
  profileDir,
  extensionId,
  daemonUrl,
  authToken,
}) {
  const braveExecutable = resolveBraveExecutable(braveApp);
  const optionsUrl = new URL(`chrome-extension://${extensionId}/options.html`);
  optionsUrl.searchParams.set("daemonUrl", daemonUrl);
  optionsUrl.searchParams.set("authToken", authToken);
  optionsUrl.searchParams.set("autosave", "1");

  const args = [
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${profileDir}`,
    optionsUrl.toString(),
  ];

  const child = spawn(braveExecutable, args, {
    cwd: repoRoot,
    stdio: "ignore",
  });
  child.unref();

  return new Promise((resolvePromise, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("spawn", () => {
      resolvePromise();
    });
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const baseUrl = `http://${options.host}:${options.port}`;
  const extensionDistPath = resolve(repoRoot, "apps/extension/dist");
  const profileDir =
    options.profileDir || (options.loadExtension ? DEFAULT_PROFILE_DIR : "");

  let health = null;
  try {
    health = await waitForHealth(baseUrl, 750);
  } catch {
    spawnDaemon(options);
    health = await waitForHealth(baseUrl);
  }

  await openBrave({
    ...options,
    profileDir,
  });
  await sleep(1500);

  let readyState = await getReadyState(baseUrl);
  let extensionId = null;

  if (options.loadExtension && profileDir) {
    extensionId = await waitForExtensionId(profileDir, extensionDistPath);
    const authToken = readDaemonSecret(options.configDir);
    if (extensionId && authToken) {
      await openExtensionOptions({
        braveApp: options.braveApp,
        profileDir,
        extensionId,
        daemonUrl: `ws://${options.host}:${options.port}/extension/connect`,
        authToken,
      });
      readyState = await waitForReady(baseUrl);
    }
  }

  console.log(
    JSON.stringify(
      {
        daemon: health,
        ready: readyState,
        launch: {
          braveApp: options.braveApp,
          braveExecutable: resolveBraveExecutable(options.braveApp),
          profileDir: profileDir || null,
          loadExtension: options.loadExtension,
          openFreshWindow: options.openFreshWindow,
        },
        extensionId,
        note:
          readyState?.extensionConnected && readyState?.paired
            ? "Bridge connected."
            : "Brave is open, but the extension is not connected yet. If this is a first-time or fresh-profile run, finish extension pairing once. On a configured profile, the extension should now reconnect automatically on browser activity.",
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Unknown launcher error occurred.",
  );
  process.exitCode = 1;
});
