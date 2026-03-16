# Local Install And Smoke Test

This guide is for developers running the current repo directly.

## Prerequisites

- Node `22+`
- Brave browser
- Codex CLI with MCP support

## 1. Build The Workspace

```sh
cd /path/to/brave-mcp

npm run build:protocol
npm run build:sdk
npm run build:daemon
npm run build:extension
npm run build:mcp
```

## 2. Start The Daemon

```sh
node apps/daemon/dist/index.js --port 39200 --config-dir /tmp/brave-mcp-smoke
```

The pairing secret is written to:

```text
/tmp/brave-mcp-smoke/daemon-config.json
```

## 3. Load The Extension In Brave

1. Open `brave://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select `apps/extension/dist`
5. Open the extension options page
6. Set:
   - daemon URL: `ws://127.0.0.1:39200/extension/connect`
   - auth token: the `secret` from `daemon-config.json`

If needed, click `Reconnect Now`.

## 4. Verify Bridge Health

```sh
curl -s http://127.0.0.1:39200/readyz | jq
```

Expected shape:

```json
{
  "ok": true,
  "ready": true,
  "extensionConnected": true,
  "paired": true
}
```

## 5. Register The MCP Server In Codex

```sh
codex mcp add brave-smoke --env BRAVE_MCP_CONFIG_DIR=/tmp/brave-mcp-smoke -- node /absolute/path/to/apps/mcp/dist/index.js
```

Then start a fresh Codex session.

## 6. Smoke Test

Useful daemon checks:

```sh
curl -s http://127.0.0.1:39200/healthz | jq
curl -s http://127.0.0.1:39200/readyz | jq
```

Useful repo verifiers:

```sh
npm run verify:protocol
npm run verify:daemon
npm run verify:mcp
npm run verify:extension
```
