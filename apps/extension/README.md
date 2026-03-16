# `apps/extension`

Brave-compatible MV3 extension package.

Current responsibilities:

- maintain the authenticated WebSocket bridge to the daemon
- execute browser actions through Brave extension APIs
- run DOM interaction code through injected scripts
- expose the options page for connection setup and diagnostics

Current implementation includes:

- background service worker
- options UI
- tab and window control
- DOM query and interaction tools
- debugger-backed capture, network, and emulation helpers

This package is the browser-facing runtime of the stack.
