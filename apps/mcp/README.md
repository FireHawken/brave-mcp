# `apps/mcp`

Codex-facing MCP adapter.

Responsibilities:

- expose the Brave tool catalog over MCP
- validate inputs against shared protocol schemas
- forward calls to the local daemon
- normalize daemon failures into predictable tool errors

Current implementation includes:

- `stdio` MCP server bootstrap
- full current tool catalog exposure
- daemon-backed verification path
