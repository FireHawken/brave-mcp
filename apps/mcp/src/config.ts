import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { z } from "zod";

const daemonConfigSchema = z.object({
  version: z.literal(1),
  secret: z.string().min(1),
});

export interface McpRuntimeConfig {
  daemonUrl: string;
  authToken: string;
}

export interface ResolveRuntimeConfigOptions {
  daemonUrl?: string;
  authToken?: string;
  configDir?: string;
}

function defaultConfigDir(): string {
  return join(homedir(), ".local", "share", "brave-mcp");
}

export async function resolveRuntimeConfig(
  options: ResolveRuntimeConfigOptions = {},
): Promise<McpRuntimeConfig> {
  const daemonUrl =
    options.daemonUrl ??
    process.env.BRAVE_MCP_DAEMON_URL ??
    "http://127.0.0.1:39200";

  if (options.authToken ?? process.env.BRAVE_MCP_AUTH_TOKEN) {
    return {
      daemonUrl,
      authToken: options.authToken ?? process.env.BRAVE_MCP_AUTH_TOKEN ?? "",
    };
  }

  const configDir = resolve(
    options.configDir ??
      process.env.BRAVE_MCP_CONFIG_DIR ??
      defaultConfigDir(),
  );
  const raw = await readFile(join(configDir, "daemon-config.json"), "utf8");
  const parsed = daemonConfigSchema.parse(JSON.parse(raw));
  return {
    daemonUrl,
    authToken: parsed.secret,
  };
}

