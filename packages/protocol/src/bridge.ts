import { z } from "zod";

import {
  daemonErrorResponseSchema,
  daemonMethodSchema,
  daemonSuccessResponseSchema,
} from "./rpc.js";

export const bridgeHelloMessageSchema = z.object({
  type: z.literal("hello"),
  browser: z.enum(["brave", "chromium"]),
  version: z.string().min(1),
});

export const bridgeRequestMessageSchema = z.object({
  type: z.literal("request"),
  id: z.string().min(1),
  method: daemonMethodSchema,
  params: z.record(z.unknown()).default({}),
});

export const bridgeSuccessResponseMessageSchema = daemonSuccessResponseSchema.extend({
  type: z.literal("response"),
});

export const bridgeErrorResponseMessageSchema = daemonErrorResponseSchema.extend({
  type: z.literal("response"),
});

export const bridgeResponseMessageSchema = z.union([
  bridgeSuccessResponseMessageSchema,
  bridgeErrorResponseMessageSchema,
]);

export const bridgeClientMessageSchema = z.union([
  bridgeHelloMessageSchema,
  bridgeResponseMessageSchema,
]);

export type BridgeHelloMessage = z.infer<typeof bridgeHelloMessageSchema>;
export type BridgeRequestMessage = z.infer<typeof bridgeRequestMessageSchema>;
export type BridgeResponseMessage = z.infer<typeof bridgeResponseMessageSchema>;
export type BridgeClientMessage = z.infer<typeof bridgeClientMessageSchema>;

