import { daemonResponseSchema, type DaemonMethod } from "@brave-mcp/protocol";

import type { McpRuntimeConfig } from "./config.js";

export class DaemonClient {
  constructor(private readonly config: McpRuntimeConfig) {}

  async call(method: DaemonMethod, params: Record<string, unknown> = {}) {
    const response = await fetch(`${this.config.daemonUrl}/rpc`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        id: `req_${Date.now()}`,
        method,
        params,
        authToken: this.config.authToken,
      }),
    });

    const parsed = daemonResponseSchema.parse(await response.json());
    if (!parsed.ok) {
      throw new Error(`${parsed.error.code}: ${parsed.error.message}`);
    }

    return parsed.result;
  }
}

