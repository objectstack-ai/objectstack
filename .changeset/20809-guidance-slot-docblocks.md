---
'@objectstack/spec': patch
---

docs(spec): the `strictObject` `guidance` option and the `ToolSchema` guidance table no longer describe `guidance` rows as tombstones for retired keys

Clause-②: no

`StrictObjectOptions.guidance` (in the published declarations) and the docblock above
`TOOL_RETIRED_KEY_GUIDANCE` in `src/ai/tool.zod.ts` (shipped as source) called the slot a
place for "tombstones for retired keys". A tombstone is `retiredKey()` in the shape, which
keeps the key declared, and a `guidance` row for a declared key never fires. The docblocks
now say what the slot is for: prescriptions for keys the shape does not declare —
wrong-layer pointers, and the upgrade for a spelling removed from the shape.

Text only: no schema, no guidance entry, no prescription and no parse behaviour changes.
