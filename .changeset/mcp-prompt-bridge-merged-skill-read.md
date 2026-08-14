---
"@objectstack/mcp": patch
---

fix(mcp): the skill prompt bridge reads the protocol's merged metadata listing, so a runtime `PUT /api/v1/meta/skill/<name>` reaches MCP prompts (#8328)

The bridge read `IMetadataService.list('skill')` — one layer below where the
`sys_metadata` overlay merge happens — so an override returned 200 and never
reached the prompt surface while `GET /api/v1/meta/skill` served it. The
long-lived (stdio) server's bridge now takes its items from the protocol's
`getMetaItems` when the host can supply it, and keeps the #6504 completeness
verdict by asking `listDiagnosed` for it alongside. A host assembled without the
metadata protocol reads exactly as before, and a merged read that throws does not
fall back to the un-merged listing.
