---
'@objectstack/rest': patch
'@objectstack/runtime': patch
'@objectstack/mcp': patch
---

fix(rest,runtime)!: seeing a datasource's remote structure needs the read capability on every route, writes included

Clause-②: yes (narrowing) — `POST /api/v1/datasources/:name/external/refresh-catalog` and `POST /api/v1/datasources/:name/external/tables/:remote/import`, and the MCP `import_object` tool, now require `manage_platform_settings` as well as `manage_metadata`; `@objectstack/rest` adds two exports, `federationCapabilityRefusal` and the type `FederationCallKind`.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, no stored row or authorable spelling moves, and no export is removed or narrowed: two exports are added, and the federation family's two write doors and the MCP import tool ask one more platform capability of the caller. The remedy is a grant on the caller's permission set, never a rewrite of a package source or a stored row, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing on two published HTTP doors and one MCP tool. Maintainer ruling, 2026-11-03 (verbatim: 「两个写接口同时要求读权限 (Recommended)」).

- **The rule.** Seeing a datasource's remote structure needs the read capability, `manage_platform_settings`, on every route of the federation family, writes included. The two writes answer with that structure (the refresh with the catalog snapshot, the import with the definition it generated), so each requires the read capability AND the write capability, `manage_metadata`. The three read routes are unchanged.
- **Before.** The refresh and the import required `manage_metadata` only.
- **Now.** They require `manage_metadata` and `manage_platform_settings`. A caller holding `manage_metadata` without `manage_platform_settings` is refused with the read routes' own answer: `403 PERMISSION_DENIED`, the message naming `manage_platform_settings`. A caller holding neither is told both capabilities in one answer. The refusal comes before the service is looked up, so a refused import saves nothing.
- **MCP.** `import_object` asks the same rule, through the same function. A connection whose user holds `manage_metadata` without `manage_platform_settings` can pass neither federation call now, so `tools/list` omits `list_remote_tables` and `import_object` for it, as it already did for a connection holding neither capability.
- **One rule, one place.** `federationCapabilityRefusal(kind, held)` (`@objectstack/rest`) is the family's capability decision: the REST routes and the MCP bridge both call it, so no door admits a caller another refuses.
- **Who sees it.** A credential (session, `sys_api_key`, or an MCP connection) whose permission sets grant `manage_metadata` without `manage_platform_settings` and that calls `datasources.external.refreshCatalog`, `datasources.external.importObject` or the MCP `import_object` tool. The shipped `admin_full_access` set grants both, so a stock administrator is unaffected; a purpose-built set is the case to check. Studio's datasource page already required `manage_platform_settings` to list and draft remote tables, so its import flow is unchanged.

**The remedy.** Grant `manage_platform_settings` to the calling credential's permission set, beside `manage_metadata`.
