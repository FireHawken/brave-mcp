import { spawn, type ChildProcess } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

const daemonConfigSchema = z.object({
  secret: z.string().min(1),
});

const HEALTH_TIMEOUT_MS = 15_000;
const HEALTH_POLL_INTERVAL_MS = 250;

let autoStartedDaemon: ChildProcess | null = null;
let autoStartedDaemonKey: string | null = null;
let autoStartPromise: Promise<void> | null = null;
let cleanupRegistered = false;

export interface EnsureDaemonOptions {
  daemonUrl: string;
  configDir: string;
  authToken?: string;
}

interface ParsedDaemonUrl {
  baseUrl: string;
  host: string;
  port: number;
}

function isChildRunning(child: ChildProcess | null): child is ChildProcess {
  return child !== null && child.exitCode === null && child.signalCode === null;
}

function daemonKey({ daemonUrl, configDir }: EnsureDaemonOptions): string {
  return `${daemonUrl}::${configDir}`;
}

function registerCleanup(): void {
  if (cleanupRegistered) {
    return;
  }

  process.once("exit", () => {
    if (isChildRunning(autoStartedDaemon)) {
      autoStartedDaemon.kill();
    }
  });
  cleanupRegistered = true;
}

function parseDaemonUrl(daemonUrl: string): ParsedDaemonUrl {
  const parsed = new URL(daemonUrl);
  if (parsed.protocol !== "http:") {
    throw new Error(
      `Daemon auto-start supports only http daemon URLs, received ${parsed.protocol}`,
    );
  }

  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error(
      `Daemon URL must be a bare origin without path or query, received ${daemonUrl}`,
    );
  }

  const port =
    parsed.port.length > 0
      ? Number(parsed.port)
      : 80;
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid daemon port in URL: ${daemonUrl}`);
  }

  return {
    baseUrl: parsed.origin,
    host: parsed.hostname,
    port,
  };
}

async function isDaemonHealthy(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/healthz`);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForDaemonHealth(baseUrl: string): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < HEALTH_TIMEOUT_MS) {
    if (await isDaemonHealthy(baseUrl)) {
      return;
    }

    await new Promise((resolvePromise) => {
      setTimeout(resolvePromise, HEALTH_POLL_INTERVAL_MS);
    });
  }

  throw new Error(`Timed out waiting for brave-mcp daemon at ${baseUrl}`);
}

async function readDaemonConfigAuthToken(configDir: string): Promise<string | null> {
  try {
    const raw = await readFile(resolve(configDir, "daemon-config.json"), "utf8");
    const parsed = daemonConfigSchema.parse(JSON.parse(raw));
    return parsed.secret;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    return null;
  }
}

async function resolveDaemonEntryPath(): Promise<string> {
  const daemonEntryPath = fileURLToPath(
    new URL("../../daemon/dist/index.js", import.meta.url),
  );
  await access(daemonEntryPath, constants.R_OK);
  return daemonEntryPath;
}

export async function ensureDaemonAvailable(
  options: EnsureDaemonOptions,
): Promise<void> {
  const parsed = parseDaemonUrl(options.daemonUrl);
  if (await isDaemonHealthy(parsed.baseUrl)) {
    return;
  }

  const key = daemonKey(options);
  if (
    isChildRunning(autoStartedDaemon) &&
    autoStartedDaemonKey === key
  ) {
    await waitForDaemonHealth(parsed.baseUrl);
    return;
  }

  if (autoStartPromise !== null) {
    await autoStartPromise;
    return;
  }

  autoStartPromise = (async () => {
    if (await isDaemonHealthy(parsed.baseUrl)) {
      return;
    }

    if (options.authToken) {
      const configAuthToken = await readDaemonConfigAuthToken(options.configDir);
      if (configAuthToken !== options.authToken) {
        throw new Error(
          "Cannot auto-start brave-mcp daemon with an explicit auth token unless it matches daemon-config.json in BRAVE_MCP_CONFIG_DIR.",
        );
      }
    }

    const daemonEntryPath = await resolveDaemonEntryPath();
    const daemonProcess = spawn(
      process.execPath,
      [
        daemonEntryPath,
        "--host",
        parsed.host,
        "--port",
        String(parsed.port),
        "--config-dir",
        options.configDir,
        "--silent",
      ],
      {
        stdio: "ignore",
      },
    );

    registerCleanup();
    autoStartedDaemon = daemonProcess;
    autoStartedDaemonKey = key;
    daemonProcess.unref();
    daemonProcess.once("exit", () => {
      if (autoStartedDaemon === daemonProcess) {
        autoStartedDaemon = null;
        autoStartedDaemonKey = null;
      }
    });

    const waitForExit = new Promise<never>((_, reject) => {
      daemonProcess.once("exit", (code, signal) => {
        reject(
          new Error(
            `brave-mcp daemon exited before becoming healthy (code=${code ?? "null"}, signal=${signal ?? "null"})`,
          ),
        );
      });
      daemonProcess.once("error", (error) => {
        reject(error);
      });
    });

    await Promise.race([waitForDaemonHealth(parsed.baseUrl), waitForExit]);
  })().finally(() => {
    autoStartPromise = null;
  });

  await autoStartPromise;
}

export async function shutdownAutoStartedDaemon(): Promise<void> {
  if (!isChildRunning(autoStartedDaemon)) {
    autoStartedDaemon = null;
    autoStartedDaemonKey = null;
    return;
  }

  const daemonProcess = autoStartedDaemon;
  autoStartedDaemon = null;
  autoStartedDaemonKey = null;

  const exited = new Promise<void>((resolve) => {
    daemonProcess.once("exit", () => {
      resolve();
    });
  });

  daemonProcess.kill();
  await exited;
}
