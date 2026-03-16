# Tool Implementation Checklist

This checklist defines the target browser tool surface for `brave-mcp`.

The reference point is Kapture's published MCP tool set from the project README:

- `navigate`
- `back`
- `forward`
- `reload`
- `click`
- `hover`
- `fill`
- `select`
- `keypress`
- `elements`

This project intentionally extends that baseline with Brave-specific tab management and a few MCP-friendly read tools.

## Naming Strategy

When Kapture names map cleanly to this repo, keep the same conceptual tool with a slightly more explicit name if needed.

- Kapture `navigate` -> `navigate`
- Kapture `reload` -> `reload_tab`
- Kapture `fill` -> `type_text`
- Kapture `keypress` -> `press_key`
- Kapture `elements` -> `query_elements` or `query_selector`
- Brave-specific additions -> `list_tabs`, `get_active_tab`, `open_tab`, `close_tab`

## Status Legend

- `[x]` implemented and verified in repo
- `[ ]` planned but not implemented
- `[~]` partially implemented or contract exists but runtime is missing

## Phase 1: Tab And Navigation Core

- `[x]` `list_tabs`
- `[x]` `list_windows`
- `[x]` `get_active_tab`
- `[x]` `open_tab`
- `[x]` `new_window`
- `[x]` `navigate`
- `[x]` `close_tab`
- `[x]` `close_window`
- `[x]` `reload_tab`
- `[x]` `back`
- `[x]` `forward`
- `[x]` `set_viewport`

Why this phase first:

- It proves the MCP -> daemon -> extension pipeline with minimal DOM complexity.
- It gives Codex enough control to open and reposition the browser before page interaction tools land.

## Phase 2: Element Discovery And Read Tools

- `[x]` `query_selector`
- `[x]` `query_elements`
- `[x]` `wait_for_selector`
- `[x]` `get_visible_text`
- `[x]` `get_dom`
- `[x]` `elements_from_point`

Reference mapping:

- Kapture `elements` maps to `query_elements`
- Kapture DOM resource maps to `get_dom`
- Kapture elements-from-point resource maps to `elements_from_point`

## Phase 3: Interaction Tools

- `[x]` `click`
- `[x]` `hover`
- `[x]` `type_text`
- `[x]` `select_option`
- `[x]` `press_key`
- `[x]` `scroll_to`
- `[x]` `drag_and_drop`
- `[x]` `upload_file`

Reference mapping:

- Kapture `click` -> `click`
- Kapture `hover` -> `hover`
- Kapture `fill` -> `type_text`
- Kapture `select` -> `select_option`
- Kapture `keypress` -> `press_key`

## Phase 4: Capture And Diagnostics

- `[x]` `capture_screenshot`
- `[x]` `capture_pdf`
- `[x]` `get_console_logs`
- `[x]` `get_tab_info`
- `[x]` `get_window_info`
- `[x]` `download_asset`
- `[x]` `execute_javascript`
- `[x]` `network_log`
- `[x]` `cookie_access`

Reference mapping:

- Kapture screenshot resource maps to `capture_screenshot`
- Kapture console resource maps to `get_console_logs`
- Kapture tab resource maps to `get_tab_info`

## Phase 5: Higher-Level Workflow Helpers

- `[x]` `wait_for_navigation`
- `[x]` `switch_to_tab`
- `[x]` `focus_tab`
- `[x]` `wait_for_idle`

These are not taken directly from Kapture but are pragmatic additions for Codex-driven workflows.

## Implementation Rule For Each Tool

Every tool is only marked implemented when all four layers exist:

- protocol schema
- daemon bridge support
- extension runtime support
- MCP exposure

And each tool must be verified in at least one automated path:

- simulated extension bridge verification
- real Brave smoke test

## Current Batch

This batch implements:

- `set_user_agent`
- `emulate_media`
- `grant_permissions`
- `har_export`

The next recommended tools after this batch:

1. `set_timezone`
2. `cpu_throttle`
3. `device_metrics_override`
4. `set_extra_headers`
5. `download_control`
