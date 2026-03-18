# `install`

Installer and packaging area.

Current state:

- shell and PowerShell installer placeholders exist
- local development launcher exists as `npm run launch:brave`
- the public installer flow is designed but not yet implemented

Target installer behavior:

- download release artifacts
- create config directory
- initialize the daemon secret
- register the Codex MCP server
- run a health check
- open the extension install flow

Repair and re-pair flows should be part of the public installer from the start.
