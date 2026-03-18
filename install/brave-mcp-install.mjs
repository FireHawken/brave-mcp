#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import { constants, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 39200;
const DEFAULT_MCP_NAME = "brave-mcp";
const HEALTH_TIMEOUT_MS = 15_000;
const HEALTH_POLL_INTERVAL_MS = 250;

function printHelp() {
  console.log(`brave-mcp local installer

Usage:
  node install/brave-mcp-install.mjs [options]
  install/brave-mcp-install.sh [options]
  powershell -File install/brave-mcp-install.ps1 [options]

Options:
  --config-dir <path>   Override the config directory
  --host <host>         Daemon host (default: ${DEFAULT_HOST})
  --port <port>         Daemon port (default: ${DEFAULT_PORT})
  --mcp-name <name>     Codex MCP server name (default: ${DEFAULT_MCP_NAME})
  --brave-path <path>   Brave executable to open for extension setup
  --skip-build          Reuse existing dist artifacts
  --skip-codex          Skip Codex MCP registration
  --skip-open           Skip opening Brave to brave://extensions
  --repair              Re-register the Codex entry and print repair guidance
  --dry-run             Print the actions without changing anything
  --help                Show this help
`);
}

function defaultConfigDir() {
  if (process.platform === "win32") {
    const localAppData =
      process.env.LOCALAPPDATA ??
      join(homedir(), "AppData", "Local");
    return resolve(localAppData, "brave-mcp");
  }

  return resolve(homedir(), ".local", "share", "brave-mcp");
}

function parseArgs(argv) {
  const options = {
    configDir: defaultConfigDir(),
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    mcpName: DEFAULT_MCP_NAME,
    bravePath: "",
    skipBuild: false,
    skipCodex: false,
    skipOpen: false,
    repair: false,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--config-dir") {
      options.configDir = resolve(argv[index + 1] ?? "");
      index += 1;
      continue;
    }
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
    if (value === "--mcp-name") {
      options.mcpName = argv[index + 1] ?? DEFAULT_MCP_NAME;
      index += 1;
      continue;
    }
    if (value === "--brave-path") {
      options.bravePath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (value === "--skip-build") {
      options.skipBuild = true;
      continue;
    }
    if (value === "--skip-codex") {
      options.skipCodex = true;
      continue;
    }
    if (value === "--skip-open") {
      options.skipOpen = true;
      continue;
    }
    if (value === "--repair") {
      options.repair = true;
      continue;
    }
    if (value === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (value === "--help" || value === "-h") {
      options.help = true;
      continue;
    }

    throw new Error(`Unknown argument: ${value}`);
  }

  if (!Number.isInteger(options.port) || options.port <= 0) {
    throw new Error(`Invalid port: ${options.port}`);
  }

  return options;
}

function logStep(message) {
  console.log(`==> ${message}`);
}

function quoteForDisplay(value) {
  return /\s/.test(value) ? JSON.stringify(value) : value;
}

function renderCommand(command, args = []) {
  return [command, ...args].map((value) => quoteForDisplay(value)).join(" ");
}

function runCommand(command, args, options = {}) {
  const { cwd = repoRoot, env = process.env, dryRun = false } = options;
  logStep(renderCommand(command, args));

  if (dryRun) {
    return;
  }

  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `${command} exited with status ${result.status ?? "unknown"}`,
    );
  }
}

function runCommandCapture(command, args, options = {}) {
  const { cwd = repoRoot, env = process.env, ignoreFailure = false } = options;
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error && !ignoreFailure) {
    throw result.error;
  }

  if (!ignoreFailure && result.status !== 0) {
    const stderr = result.stderr?.trim();
    throw new Error(
      stderr.length > 0
        ? stderr
        : `${command} exited with status ${result.status ?? "unknown"}`,
    );
  }

  return result;
}

async function ensureFileReadable(path) {
  await access(path, constants.R_OK);
}

async function sleep(ms) {
  await new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unexpected ${response.status} from ${url}`);
  }

  return response.json();
}

async function fetchReady(baseUrl) {
  return fetchJson(`${baseUrl}/readyz`);
}

function commandExists(command) {
  if (command.includes("/") || command.includes("\\")) {
    return existsSync(command);
  }

  const lookupCommand = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(lookupCommand, [command], {
    stdio: "ignore",
  });
  return result.status === 0;
}

async function validateRunningDaemon(baseUrl, expectedConfigDir) {
  const ready = await fetchReady(baseUrl);
  const actualConfigDir =
    typeof ready.configDir === "string" ? resolve(ready.configDir) : null;

  if (actualConfigDir && actualConfigDir !== resolve(expectedConfigDir)) {
    throw new Error(
      `A brave-mcp daemon is already running at ${baseUrl} with config dir ${actualConfigDir}. Stop it or rerun the installer with --config-dir ${actualConfigDir}.`,
    );
  }

  return ready;
}

async function waitForHealth(baseUrl, timeoutMs = HEALTH_TIMEOUT_MS) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await fetchJson(`${baseUrl}/healthz`);
    } catch {
      await sleep(HEALTH_POLL_INTERVAL_MS);
    }
  }

  throw new Error(`Timed out waiting for ${baseUrl}/healthz`);
}

async function maybeHealth(baseUrl) {
  try {
    return await fetchJson(`${baseUrl}/healthz`);
  } catch {
    return null;
  }
}

function spawnDetached(command, args, options = {}) {
  const { cwd = repoRoot, env = process.env } = options;
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: "ignore",
    detached: process.platform !== "win32",
  });
  child.unref();
}

async function buildArtifacts(options) {
  if (options.skipBuild) {
    await ensureFileReadable(resolve(repoRoot, "apps/daemon/dist/index.js"));
    await ensureFileReadable(resolve(repoRoot, "apps/mcp/dist/index.js"));
    await ensureFileReadable(resolve(repoRoot, "apps/extension/dist/manifest.json"));
    return;
  }

  runCommand("npm", ["run", "build:extension"], { dryRun: options.dryRun });
  runCommand("npm", ["run", "build:mcp"], { dryRun: options.dryRun });
}

async function loadDaemonConfigModule() {
  const modulePath = resolve(repoRoot, "apps/daemon/dist/config.js");
  await ensureFileReadable(modulePath);
  return import(pathToFileURL(modulePath).href);
}

async function ensureConfig(options) {
  if (options.dryRun) {
    return {
      configPath: resolve(options.configDir, "daemon-config.json"),
      config: {
        secret: "<generated during install>",
      },
    };
  }

  const daemonConfigModule = await loadDaemonConfigModule();
  const config = await daemonConfigModule.loadOrCreateConfig(options.configDir);
  const configPath = daemonConfigModule.configFilePath(options.configDir);
  return { configPath, config };
}

async function ensureDaemon(options) {
  const baseUrl = `http://${options.host}:${options.port}`;
  const currentHealth = await maybeHealth(baseUrl);
  if (currentHealth) {
    await validateRunningDaemon(baseUrl, options.configDir);
    return currentHealth;
  }

  const daemonEntryPath = resolve(repoRoot, "apps/daemon/dist/index.js");
  const daemonArgs = [
    daemonEntryPath,
    "--host",
    options.host,
    "--port",
    String(options.port),
    "--config-dir",
    options.configDir,
    "--silent",
  ];

  logStep(`starting daemon: ${renderCommand(process.execPath, daemonArgs)}`);
  if (options.dryRun) {
    return {
      ok: true,
      service: "brave-mcp-daemon",
      version: "dry-run",
      extensionConnected: false,
    };
  }

  spawnDetached(process.execPath, daemonArgs, {
    env: {
      ...process.env,
      BRAVE_MCP_CONFIG_DIR: options.configDir,
    },
  });

  const health = await waitForHealth(baseUrl);
  await validateRunningDaemon(baseUrl, options.configDir);
  return health;
}

function codexServerExists(name) {
  const result = runCommandCapture(
    "codex",
    ["mcp", "get", name, "--json"],
    { ignoreFailure: true },
  );
  return result.status === 0;
}

function registerCodex(options) {
  if (options.skipCodex) {
    return;
  }

  if (options.dryRun) {
    logStep(
      renderCommand("codex", [
        "mcp",
        "add",
        options.mcpName,
        "--env",
        `BRAVE_MCP_CONFIG_DIR=${options.configDir}`,
        "--env",
        `BRAVE_MCP_DAEMON_URL=http://${options.host}:${options.port}`,
        "--",
        process.execPath,
        resolve(repoRoot, "apps/mcp/dist/index.js"),
      ]),
    );
    return;
  }

  if (codexServerExists(options.mcpName)) {
    runCommand("codex", ["mcp", "remove", options.mcpName]);
  }

  runCommand("codex", [
    "mcp",
    "add",
    options.mcpName,
    "--env",
    `BRAVE_MCP_CONFIG_DIR=${options.configDir}`,
    "--env",
    `BRAVE_MCP_DAEMON_URL=http://${options.host}:${options.port}`,
    "--",
    process.execPath,
    resolve(repoRoot, "apps/mcp/dist/index.js"),
  ]);
}

function openTarget(command, args) {
  if (!commandExists(command)) {
    return false;
  }

  try {
    spawnDetached(command, args);
    return true;
  } catch {
    return false;
  }
}

function openExtensionFlow(options) {
  if (options.skipOpen) {
    return false;
  }

  const braveUrl = "brave://extensions";
  if (options.dryRun) {
    logStep(`open ${braveUrl}`);
    return true;
  }

  if (options.bravePath) {
    return openTarget(options.bravePath, [braveUrl]);
  }

  if (process.platform === "darwin") {
    return openTarget("open", ["-a", "Brave Browser", braveUrl]);
  }

  if (process.platform === "win32") {
    return openTarget("cmd.exe", ["/c", "start", "", braveUrl]);
  }

  const linuxCandidates = [
    ["brave-browser", [braveUrl]],
    ["brave", [braveUrl]],
    ["xdg-open", [braveUrl]],
  ];

  for (const [command, args] of linuxCandidates) {
    if (openTarget(command, args)) {
      return true;
    }
  }

  return false;
}

function printSummary({ options, configInfo, health, openedExtensionFlow }) {
  const daemonUrl = `ws://${options.host}:${options.port}/extension/connect`;
  const baseUrl = `http://${options.host}:${options.port}`;

  console.log("");
  console.log(options.repair ? "Repair complete." : "Install complete.");
  console.log(`Config dir: ${options.configDir}`);
  console.log(`Config file: ${configInfo.configPath}`);
  console.log(`Daemon health: ${JSON.stringify(health, null, 2)}`);
  console.log(`Extension path: ${resolve(repoRoot, "apps/extension/dist")}`);
  console.log(`Extension daemon URL: ${daemonUrl}`);
  console.log(`Extension auth token: ${configInfo.config.secret}`);
  console.log(`Codex MCP name: ${options.mcpName}`);
  console.log(`Codex daemon URL: ${baseUrl}`);
  console.log("");
  console.log("Next steps:");
  console.log("1. In Brave, enable Developer mode at brave://extensions.");
  console.log(
    `2. Click Load unpacked and select ${resolve(repoRoot, "apps/extension/dist")}.`,
  );
  console.log("3. Open the extension options page.");
  console.log(`4. Set daemon URL to ${daemonUrl}.`);
  console.log(`5. Set auth token to ${configInfo.config.secret} and click Reconnect Now.`);
  console.log("6. Start a fresh Codex session to pick up the registered MCP server.");

  if (!openedExtensionFlow) {
    console.log("");
    console.log("Brave was not opened automatically. Open brave://extensions manually.");
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  if (!commandExists("npm")) {
    throw new Error("npm is required but was not found in PATH.");
  }
  if (!options.skipCodex && !options.dryRun && !commandExists("codex")) {
    throw new Error("codex is required for MCP registration. Rerun with --skip-codex to skip that step.");
  }

  logStep(options.repair ? "repairing brave-mcp local install" : "installing brave-mcp locally");
  await buildArtifacts(options);
  const configInfo = await ensureConfig(options);
  const health = await ensureDaemon(options);
  registerCodex(options);
  const openedExtensionFlow = openExtensionFlow(options);
  printSummary({ options, configInfo, health, openedExtensionFlow });
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Unknown installer error occurred.",
  );
  process.exitCode = 1;
});
