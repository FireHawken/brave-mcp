import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import {
  bridgeClientMessageSchema,
  bridgeRequestMessageSchema,
  daemonRequestSchema,
  daemonResponseSchema,
  toolCatalog,
  type DaemonMethod,
  type DaemonResponse,
} from "@brave-mcp/protocol";
import { WebSocketServer, type WebSocket } from "ws";

import { loadOrCreateConfig, resolveConfigDir, type DaemonConfig } from "./config.js";

export interface RuntimeState {
  configDir: string;
  config: DaemonConfig;
  extensionConnected: boolean;
  paired: boolean;
  startedAt: string;
}

export interface CreateDaemonAppOptions {
  configDir?: string;
  logger?: boolean;
}

export async function createDaemonApp(
  options: CreateDaemonAppOptions = {},
): Promise<{ app: FastifyInstance; state: RuntimeState }> {
  const configDir = resolveConfigDir(options.configDir);
  const config = await loadOrCreateConfig(configDir);
  const state: RuntimeState = {
    configDir,
    config,
    extensionConnected: false,
    paired: false,
    startedAt: new Date().toISOString(),
  };

  const app = Fastify({
    logger: options.logger ?? true,
  });
  const pendingRequests = new Map<
    string,
    {
      resolve: (response: DaemonResponse) => void;
      timeout: NodeJS.Timeout;
    }
  >();
  const bridgeServer = new WebSocketServer({
    noServer: true,
  });
  let extensionSocket: WebSocket | null = null;

  function setDisconnected(): void {
    extensionSocket = null;
    state.extensionConnected = false;
    state.paired = false;
    for (const pending of pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.resolve({
        id: "disconnected",
        ok: false,
        error: {
          code: "BRAVE_EXTENSION_OFFLINE",
          message: "Extension disconnected while a request was in flight.",
          retryable: true,
        },
      });
    }
    pendingRequests.clear();
  }

  async function callExtension(
    method: DaemonMethod,
    params: Record<string, unknown>,
  ): Promise<DaemonResponse> {
    if (!extensionSocket || extensionSocket.readyState !== extensionSocket.OPEN) {
      return {
        id: randomUUID(),
        ok: false,
        error: {
          code: "BRAVE_EXTENSION_OFFLINE",
          message: "No extension bridge is currently connected.",
          retryable: true,
        },
      };
    }

    const id = randomUUID();
    const message = bridgeRequestMessageSchema.parse({
      type: "request",
      id,
      method,
      params,
    });
    const requestTimeoutMs =
      typeof params.timeoutMs === "number"
        ? Math.max(5_000, params.timeoutMs + 500)
        : 5_000;

    return new Promise<DaemonResponse>((resolve) => {
      const timeout = setTimeout(() => {
        pendingRequests.delete(id);
        resolve({
          id,
          ok: false,
          error: {
            code: "BRAVE_TIMEOUT",
            message: `Timed out waiting for extension method ${method}.`,
            retryable: true,
          },
        });
      }, requestTimeoutMs);

      pendingRequests.set(id, { resolve, timeout });
      extensionSocket?.send(JSON.stringify(message));
    });
  }

  app.server.on("upgrade", (request, socket, head) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (requestUrl.pathname !== "/extension/connect") {
      socket.destroy();
      return;
    }

    if (requestUrl.searchParams.get("authToken") !== state.config.secret) {
      socket.destroy();
      return;
    }

    bridgeServer.handleUpgrade(request, socket, head, (ws) => {
      bridgeServer.emit("connection", ws, request);
    });
  });

  bridgeServer.on("connection", (socket) => {
    extensionSocket?.close();
    extensionSocket = socket;
    state.extensionConnected = true;

    socket.on("message", (raw) => {
      try {
        const message = bridgeClientMessageSchema.parse(JSON.parse(raw.toString()));
        if (message.type === "hello") {
          state.paired = true;
          return;
        }

        if (message.type === "ping") {
          return;
        }

        const pending = pendingRequests.get(message.id);
        if (!pending) {
          return;
        }

        clearTimeout(pending.timeout);
        pendingRequests.delete(message.id);
        pending.resolve(daemonResponseSchema.parse(message));
      } catch (error) {
        app.log.error(error);
      }
    });

    socket.on("close", () => {
      if (extensionSocket === socket) {
        setDisconnected();
      }
    });
  });

  app.get("/healthz", async () => {
    return {
      ok: true,
      service: "brave-mcp-daemon",
      version: "0.11.0",
      startedAt: state.startedAt,
      toolCount: toolCatalog.length,
      extensionConnected: state.extensionConnected,
    };
  });

  app.get("/readyz", async (_, reply) => {
    reply.code(200);
    return {
      ok: true,
      ready: true,
      extensionConnected: state.extensionConnected,
      paired: state.paired,
      configDir: state.configDir,
    };
  });

  app.post("/rpc", async (request, reply) => {
    const parsed = daemonRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return {
        id: "invalid",
        ok: false,
        error: {
          code: "BRAVE_INTERNAL_ERROR",
          message: "Invalid daemon request payload.",
          retryable: false,
          details: {
            issues: parsed.error.issues,
          },
        },
      } satisfies DaemonResponse;
    }

    if (parsed.data.authToken !== state.config.secret) {
      reply.code(401);
      return {
        id: parsed.data.id,
        ok: false,
        error: {
          code: "BRAVE_AUTH_REQUIRED",
          message: "Invalid daemon auth token.",
          retryable: false,
        },
      } satisfies DaemonResponse;
    }

    const response = await callExtension(parsed.data.method, parsed.data.params);
    if (!response.ok) {
      reply.code(
        response.error.code === "BRAVE_TIMEOUT"
          ? 504
          : response.error.code === "BRAVE_AUTH_REQUIRED"
            ? 401
            : 503,
      );
    }

    return daemonResponseSchema.parse(response);
  });

  return { app, state };
}
