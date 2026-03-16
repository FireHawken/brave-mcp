# Brave MCP Implementation Blueprint

## Goal

Ship a public, low-friction solution that lets Codex control Brave safely through MCP without forcing users to hand-edit config files or install unpacked extensions.

## Product Shape

The recommended v1 architecture has three components:

- `apps/extension`: Chromium MV3 extension, published to the Chrome Web Store and used from Brave.
- `apps/daemon`: local companion app that exposes a localhost-only bridge to the extension and owns pairing, logs, persistence, and health checks.
- `apps/mcp`: MCP adapter that Codex launches locally.

Native messaging is explicitly deferred. It adds browser-specific host registration and OS-specific installation complexity. The v1 public path should be extension plus localhost daemon plus MCP adapter.

## Why This Architecture

- Brave users can install Chrome Web Store extensions, which gives the project a normal public distribution path.
- Codex already supports local MCP registration with a spawned command and also supports URL-based registration for HTTP MCP servers.
- A daemon separates browser transport concerns from MCP concerns, which keeps the MCP layer stable even if the extension transport changes later.
- Localhost transport is easier to install, inspect, log, and repair than native messaging.

## Recommended Package Choices

These are the initial package decisions for the first implementation pass.

### Workspace and Language

- Package manager: `pnpm` workspaces
- Language: TypeScript
- Node baseline: Node `22+`
- Repo style: monorepo with `apps/*` and `packages/*`

### `apps/extension`

- Build system: `wxt`
- UI layer: React only for onboarding, options, and diagnostics pages
- Browser APIs: `tabs`, `scripting`, `storage`, `activeTab`, `alarms`, `runtime`
- Transport to daemon: WebSocket to `ws://127.0.0.1:<port>`

Why `wxt`:

- It is purpose-built for MV3 extensions.
- It supports Chromium-family browsers cleanly.
- It reduces custom build tooling and simplifies store packaging.

### `apps/daemon`

- Runtime: Node `22+`
- HTTP framework: `fastify`
- WebSocket server: `ws`
- Validation: `zod`
- Logging: `pino`
- Persistence: `better-sqlite3`
- Packaging: `pkg` or `nexe` is not recommended as a first choice; prefer shipping plain Node builds first, then evaluate a single-file packaging tool later.

Why this stack:

- Fastify is simple and mature for a localhost control service.
- `ws` is enough for a controlled loopback-only bridge.
- SQLite gives the project a reliable place for session state, audit logs, and pairing records.

### `apps/mcp`

- MCP SDK: `@modelcontextprotocol/server`
- Optional Streamable HTTP adapter: `@modelcontextprotocol/node`
- Validation: `zod`
- Logging: `pino`

Transport policy:

- `stdio` is the default local Codex integration.
- Streamable HTTP is optional and can be added once the `stdio` path is stable.

### Shared Packages

- `packages/protocol`: shared Zod schemas, JSON Schemas, RPC types, capability enums, error codes
- `packages/sdk`: internal client library for talking to the daemon from the MCP adapter or test harnesses

## Monorepo Layout

```text
.
├── apps
│   ├── daemon
│   │   ├── src
│   │   │   ├── config
│   │   │   ├── db
│   │   │   ├── extension-bridge
│   │   │   ├── http
│   │   │   ├── pairing
│   │   │   ├── services
│   │   │   └── index.ts
│   │   └── README.md
│   ├── extension
│   │   ├── entrypoints
│   │   │   ├── background.ts
│   │   │   ├── content.ts
│   │   │   └── options
│   │   ├── public
│   │   └── README.md
│   └── mcp
│       ├── src
│       │   ├── server
│       │   ├── tools
│       │   ├── transport
│       │   └── index.ts
│       └── README.md
├── docs
│   └── implementation-blueprint.md
├── install
│   ├── README.md
│   ├── brave-mcp-install.sh
│   └── brave-mcp-install.ps1
├── packages
│   ├── protocol
│   │   ├── schemas
│   │   └── README.md
│   └── sdk
│       ├── src
│       └── README.md
└── specs
    └── tools
        └── brave-tools.schema.json
```

## Responsibility Boundaries

### Extension Responsibilities

- Maintain a single authenticated WebSocket connection to the daemon.
- Execute browser-facing actions:
  - tab discovery
  - navigation
  - DOM queries
  - user input simulation
  - screenshots
- Surface onboarding and health status to the user.
- Request optional site permissions when needed.
- Reject unsafe commands that exceed the granted permission set.

### Daemon Responsibilities

- Bind only to `127.0.0.1`.
- Generate and persist the local pairing secret.
- Authorize extension connections.
- Track connected browsers and tabs.
- Translate MCP-facing requests into extension RPC calls.
- Store structured logs and basic audit entries.
- Expose health and version endpoints for installers and diagnostics.

### MCP Responsibilities

- Register the Brave tool catalog with Codex.
- Validate tool inputs and normalize errors.
- Route requests to the daemon.
- Support `stdio` first.
- Support Streamable HTTP later without changing tool semantics.

## V1 Tool Surface

The machine-readable source of truth lives in [specs/tools/brave-tools.schema.json](../specs/tools/brave-tools.schema.json).

The initial v1 tool surface should be:

- `list_tabs`
- `get_active_tab`
- `open_tab`
- `close_tab`
- `navigate`
- `reload_tab`
- `click`
- `type_text`
- `press_key`
- `wait_for_selector`
- `get_visible_text`
- `query_selector`
- `capture_screenshot`

The v1 tool design rules are:

- Prefer a small stable set over broad automation coverage.
- Every mutating tool should support `tabId`.
- Every DOM-targeting tool should accept a `selector` and a timeout.
- Read-only and mutating tools should be distinguishable in metadata.
- Unsafe primitives such as raw arbitrary JavaScript evaluation are out of scope for v1.

## RPC Contract Between MCP and Daemon

Use a simple JSON RPC shape over loopback transport:

```json
{
  "id": "req_123",
  "method": "tabs.list",
  "params": {},
  "authToken": "redacted"
}
```

Responses:

```json
{
  "id": "req_123",
  "ok": true,
  "result": {
    "tabs": []
  }
}
```

```json
{
  "id": "req_123",
  "ok": false,
  "error": {
    "code": "BRAVE_SELECTOR_NOT_FOUND",
    "message": "Selector not found before timeout.",
    "retryable": false
  }
}
```

## Auth and Security Model

The security posture should be explicit from the start.

- Daemon binds to `127.0.0.1` only.
- Daemon issues a per-user secret during install.
- Extension pairing is explicit and revocable.
- HTTP endpoints reject requests without the secret.
- Logs redact page text by default unless diagnostic mode is enabled.
- Tool calls that mutate page state are clearly marked in the MCP metadata.
- No cookie export, password extraction, or hidden background browsing in v1.
- No browser-wide `<all_urls>` permission by default if optional permissions can cover the same path.

## Install Flow

The public install path should look like this.

### macOS and Linux

1. User runs a one-line installer.
2. Installer downloads the daemon and MCP binaries from GitHub Releases.
3. Installer creates a per-user config directory.
4. Installer generates a local secret and writes a config file.
5. Installer registers an auto-start service.
6. Installer opens the Chrome Web Store listing for the extension.
7. Installer asks the user to click the extension onboarding page after install.
8. Installer runs:

```sh
codex mcp add brave -- ~/.local/share/brave-mcp/bin/brave-mcp stdio
```

9. Installer runs a health check against the daemon.
10. User completes extension pairing in Brave.

### Windows

1. User runs a PowerShell installer.
2. Installer downloads signed binaries.
3. Installer writes config under `%LOCALAPPDATA%`.
4. Installer creates startup registration or a per-user service.
5. Installer opens the Chrome Web Store listing in Brave.
6. Installer runs:

```powershell
codex mcp add brave -- "$env:LOCALAPPDATA\brave-mcp\bin\brave-mcp.exe" stdio
```

7. User completes pairing.

### Repair Flow

The installer must also support a repair mode:

- re-create config
- rotate secret
- re-register Codex MCP config
- verify extension-to-daemon connectivity
- dump diagnostic logs

## Release and Distribution

### Extension

- Publish to the Chrome Web Store.
- Document Brave installation using the store listing, not unpacked mode.
- Keep requested permissions minimal to improve review odds.

### Binaries

- Release binaries on GitHub Releases.
- Add Homebrew support after macOS is stable.
- Add `winget` after Windows is stable.
- Linux package managers are a later milestone.

### Signing

- macOS: notarize installer artifacts before broad distribution.
- Windows: code-sign binaries before announcing general availability.
- Extension: store-signed package through the Chrome Web Store pipeline.

## Testing Plan

### Unit Tests

- schema validation
- RPC serialization
- tool input normalization
- error mapping

### Integration Tests

- MCP adapter to mocked daemon
- daemon to mocked extension bridge
- installer health check flow

### End-to-End Tests

- fresh install on macOS
- fresh install on Windows
- Brave extension pairing
- Codex `list_tabs`, `navigate`, `get_visible_text`, and `capture_screenshot`

## Observability

Implement this on day one:

- `brave-mcp doctor`
- `brave-mcp version`
- `brave-mcp logs`
- daemon `/healthz`
- daemon `/readyz`
- structured request IDs across MCP, daemon, and extension logs

## Milestone Checklist

### M0: Contracts and Repo Bootstrap

- create workspace
- define tool schemas
- define daemon RPC schema
- write ADR for localhost bridge over native messaging

Exit criteria:

- repo builds empty packages cleanly
- schema package is versioned
- design decisions are documented

### M1: Daemon and MCP Happy Path

- implement daemon config and secret handling
- implement daemon health endpoint
- implement MCP `stdio` server
- wire `list_tabs` and `get_active_tab` through a mocked bridge

Exit criteria:

- Codex can call mocked tools through the real MCP server

### M2: Extension Happy Path

- build MV3 extension shell
- add WebSocket pairing
- implement real tab discovery and navigation
- expose onboarding page

Exit criteria:

- real Brave session can list tabs and navigate

### M3: DOM Interaction Tools

- implement `click`
- implement `type_text`
- implement `wait_for_selector`
- implement `get_visible_text`
- implement `query_selector`

Exit criteria:

- a sample website can be controlled without manual page refreshes

### M4: Screenshots and Diagnostics

- implement screenshot pipeline
- add audit logs and request IDs
- add `doctor` and `logs`
- document repair path

Exit criteria:

- failures are diagnosable without reading source code

### M5: Installer and Distribution

- build `install.sh`
- build `install.ps1`
- automate Codex MCP registration
- document Brave install path

Exit criteria:

- fresh-machine install takes under three minutes

### M6: Hardening and Public Launch

- security review
- permission review
- Chrome Web Store submission
- binary signing and notarization
- public docs and demo video

Exit criteria:

- extension approved
- binaries signed
- install path tested on clean machines

## Deliberate Non-Goals for V1

- arbitrary JavaScript evaluation
- CDP or `chrome.debugger` support
- native messaging host installation
- multi-browser support beyond Brave and Chromium compatibility
- cloud relay or remote browser control

## Open Decisions to Revisit After M2

- whether the daemon should also expose Streamable HTTP MCP directly
- whether screenshots should be PNG only or PNG and JPEG
- whether optional site permissions are enough or if host permissions need a broader default
- whether the onboarding UI needs a popup in addition to an options page

## Immediate Next Build Steps

1. Create `packages/protocol` with Zod-first tool and RPC schemas.
2. Create `apps/mcp` with a `stdio` server exposing only mocked `list_tabs` and `get_active_tab`.
3. Create `apps/daemon` with config, secret storage, and `/healthz`.
4. Create `apps/extension` with a pairing page and a background WebSocket client stub.
5. Add installer scripts that only perform config generation and Codex registration at first.
