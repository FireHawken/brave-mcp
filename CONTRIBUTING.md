# Contributing

The project rule is simple: do not mark a tool as implemented until the full stack exists.

For each tool, all four layers should be present:

- protocol schema
- daemon bridge support
- extension runtime support
- MCP exposure

And every completed tool should be verified through at least one of:

- the simulated bridge path
- a real Brave smoke test

## Development Notes

- Keep the daemon loopback-only.
- Prefer typed contracts over loose ad hoc payloads.
- Keep the MCP layer thin.
- Avoid adding browser-specific behavior directly into the MCP package.
- Do not expand the public tool list with flaky behavior just because the raw browser API exists.

## Before Opening A PR

Run:

```sh
npm run verify:protocol
npm run verify:daemon
npm run verify:mcp
npm run verify:extension
```

If you change the public contract, also update:

- `specs/tools/brave-tools.schema.json`
- `specs/rpc/daemon-rpc.schema.json`
- `docs/tool-implementation-checklist.md`
- `README.md` if the visible surface changed
