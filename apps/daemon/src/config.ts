import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { z } from "zod";

export const daemonConfigSchema = z.object({
  version: z.literal(1),
  secret: z.string().min(1),
  createdAt: z.string().datetime(),
  lastStartedAt: z.string().datetime(),
});

export type DaemonConfig = z.infer<typeof daemonConfigSchema>;

export function resolveConfigDir(explicitDir?: string): string {
  if (explicitDir) {
    return resolve(explicitDir);
  }

  if (process.env.BRAVE_MCP_CONFIG_DIR) {
    return resolve(process.env.BRAVE_MCP_CONFIG_DIR);
  }

  return join(homedir(), ".local", "share", "brave-mcp");
}

export function configFilePath(configDir: string): string {
  return join(configDir, "daemon-config.json");
}

function nowIso(): string {
  return new Date().toISOString();
}

function createConfig(): DaemonConfig {
  const timestamp = nowIso();
  return {
    version: 1,
    secret: randomBytes(32).toString("hex"),
    createdAt: timestamp,
    lastStartedAt: timestamp,
  };
}

export async function loadOrCreateConfig(configDir: string): Promise<DaemonConfig> {
  await mkdir(configDir, { recursive: true });
  const path = configFilePath(configDir);

  try {
    const raw = await readFile(path, "utf8");
    const parsed = daemonConfigSchema.parse(JSON.parse(raw));
    const updated: DaemonConfig = {
      ...parsed,
      lastStartedAt: nowIso(),
    };
    await writeFile(path, JSON.stringify(updated, null, 2));
    return updated;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      try {
        // Surface schema violations with a clean message.
        const parsed = daemonConfigSchema.parse(
          JSON.parse(await readFile(path, "utf8")),
        );
        return parsed;
      } catch {
        // Fall through to rewriting a valid config.
      }
    }

    const config = createConfig();
    await writeFile(path, JSON.stringify(config, null, 2));
    return config;
  }
}

