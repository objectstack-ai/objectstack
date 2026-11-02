---
'@objectstack/runtime': patch
---

fix(runtime): an MCP grant that holds no federation capability is no longer listed `list_remote_tables` / `import_object` (#28938)

Clause-②: no — no call that passed before is refused now, and none that was refused passes: what changes is that a request whose every federation call would answer `403 PERMISSION_DENIED` is no longer listed the pair.
Metadata-protocol: none

The `/mcp` door hands an OAuth agent the delegating user's system capabilities only when the grant names `actions:execute`. A `metadata:write`-only grant therefore holds none, yet it was listed `list_remote_tables` and `import_object`, and every call answered `403 PERMISSION_DENIED`, even when the user is an administrator.

- **Now.** The runtime's MCP bridge carries the pair only when the request holds `manage_platform_settings` (the listing's capability) or `manage_metadata` (the import's). Without either, `tools/list` omits both, the way `list_actions` omits an action its caller may not run. The listing decision and the per-call check read the same capabilities, so they cannot disagree.
- **Unchanged.** A grant naming `metadata:write` and `actions:execute`, for a user who holds the capabilities, lists and calls both as before. A request holding one capability is still listed both, and the call that needs the other still answers `403`. API keys and sessions are still not listed the pair.
- **To use the pair from an MCP client:** connect with `metadata:write` and `actions:execute`, as a user who holds the capability.
