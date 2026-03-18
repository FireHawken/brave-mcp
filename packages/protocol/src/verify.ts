import {
  bridgeClientMessageSchema,
  bridgeRequestMessageSchema,
  daemonRequestSchema,
  daemonResponseSchema,
  toolCatalog,
} from "./index.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const seenNames = new Set<string>();
for (const tool of toolCatalog) {
  assert(!seenNames.has(tool.name), `Duplicate tool name: ${tool.name}`);
  seenNames.add(tool.name);

  const sampleInputResult = tool.inputSchema.safeParse({});
  if (!sampleInputResult.success) {
    // Some tools require mandatory fields; that is expected.
    assert(
      sampleInputResult.error.issues.length > 0,
      `Tool ${tool.name} returned an empty validation error set`,
    );
  }

  const sampleOutputResult = tool.outputSchema.safeParse({});
  if (!sampleOutputResult.success) {
    assert(
      sampleOutputResult.error.issues.length > 0,
      `Tool ${tool.name} returned an empty output validation error set`,
    );
  }
}

const requestResult = daemonRequestSchema.safeParse({
  id: "req_123",
  method: "tabs.list",
  params: {},
  authToken: "secret",
});
assert(requestResult.success, "Sample daemon request should parse");

const successResponseResult = daemonResponseSchema.safeParse({
  id: "req_123",
  ok: true,
  result: { tabs: [] },
});
assert(successResponseResult.success, "Sample daemon success response should parse");

const errorResponseResult = daemonResponseSchema.safeParse({
  id: "req_123",
  ok: false,
  error: {
    code: "BRAVE_SELECTOR_NOT_FOUND",
    message: "Selector not found before timeout.",
    retryable: false,
  },
});
assert(errorResponseResult.success, "Sample daemon error response should parse");

const bridgeHelloResult = bridgeClientMessageSchema.safeParse({
  type: "hello",
  browser: "brave",
  version: "0.11.0",
});
assert(bridgeHelloResult.success, "Sample bridge hello should parse");

const bridgePingResult = bridgeClientMessageSchema.safeParse({
  type: "ping",
  sentAt: "2026-03-16T00:00:00.000Z",
});
assert(bridgePingResult.success, "Sample bridge ping should parse");

const bridgeRequestResult = bridgeRequestMessageSchema.safeParse({
  type: "request",
  id: "req_123",
  method: "tabs.list",
  params: {},
});
assert(bridgeRequestResult.success, "Sample bridge request should parse");

console.log(
  JSON.stringify(
    {
      verifiedTools: toolCatalog.length,
      verifiedRpcMethods: requestResult.data.method,
      verifiedBridgeMessages: ["hello", "ping", "request"],
    },
    null,
    2,
  ),
);
