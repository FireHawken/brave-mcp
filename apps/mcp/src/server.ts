import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { resolveRuntimeConfig, type ResolveRuntimeConfigOptions } from "./config.js";
import { DaemonClient } from "./daemon-client.js";
import { getToolDefinitions, handleToolCall } from "./tools.js";

export async function createMcpServer(
  options: ResolveRuntimeConfigOptions = {},
): Promise<Server> {
  const runtimeConfig = await resolveRuntimeConfig(options);
  const client = new DaemonClient(runtimeConfig);

  const server = new Server(
    {
      name: "brave-mcp",
      version: "0.11.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: getToolDefinitions(),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await handleToolCall(
      client,
      request.params.name,
      request.params.arguments ?? {},
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  });

  return server;
}

export async function runStdioServer(
  options: ResolveRuntimeConfigOptions = {},
): Promise<void> {
  const server = await createMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
