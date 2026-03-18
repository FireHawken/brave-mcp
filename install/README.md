# `install`

Installer and packaging area.

Current state:

- `brave-mcp-install.sh`
- `brave-mcp-install.ps1`
- `brave-mcp-install.mjs`

These scripts implement the current repo-local install flow. They build the local artifacts, create or reuse the daemon config directory, start the daemon, register the Codex MCP server, run a health check, and try to open `brave://extensions` so the unpacked extension can be loaded.

Example usage:

```sh
./install/brave-mcp-install.sh
```

```powershell
powershell -File .\install\brave-mcp-install.ps1
```

Useful flags:

- `--config-dir <path>` to override the daemon config location
- `--skip-build` to reuse existing `dist` artifacts
- `--skip-codex` to avoid writing Codex MCP config
- `--skip-open` to avoid opening Brave automatically
- `--repair` to re-run registration and setup guidance for an existing install

Current limitation:

- the installer still targets the local repo build outputs and registers the Node entrypoint in Codex
- packaged release downloads, OS service registration, and store-based extension distribution are still future work
