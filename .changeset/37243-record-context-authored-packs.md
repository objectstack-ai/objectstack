---
'@objectstack/mcp': patch
'@objectstack/runtime': patch
---

fix(mcp,runtime): `get_record_context` reads a package's context packs on both MCP doors

Clause-②: no
Metadata-protocol: none

A deployment serving context packs (`aiContexts`) answered every `get_record_context` call with `RESOURCE_NOT_FOUND` ("No context pack named … reads object …"), on the HTTP `/mcp` route and on stdio alike. Both doors read the packs from the protocol's served `ai_context` listing, which carries the read path's `_diagnostics` on every item; the record-context executor parses each pack with the closed `AiContextSchema`, so it dropped every one as an unrecognized key.

Both doors now hand the executor the authored packs: the listing passes through `stripReadDecorations` (`@objectstack/spec/kernel`), which removes exactly the read decorations (`METADATA_READ_DECORATIONS`) and keeps the ADR-0010 protection envelope (`_packageId`, `_provenance`, `_lock`, …) the schema declares. The executor's parse is unchanged. Nothing to do on upgrade.
