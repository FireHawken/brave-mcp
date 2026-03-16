# `apps/daemon`

Local companion daemon for `brave-mcp`.

Responsibilities:

- bind to loopback only
- generate and persist the shared auth secret
- accept the extension bridge connection
- expose health and RPC endpoints
- route MCP requests to the browser bridge

Current implementation includes:

- config bootstrap and secret generation
- `/healthz`, `/readyz`, and `/rpc`
- request/response routing over the extension bridge
- verification with a simulated extension bridge
