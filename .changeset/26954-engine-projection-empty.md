---
'@objectstack/spec': patch
---

fix(spec)!: `EngineQueryOptionsSchema.fields` and the RPC request's `select` declare the projection their transport siblings declare, instead of any list (#26954)

Clause-②: no (narrowing) — the published engine-side declarations of a read's projection (`EngineQueryOptionsSchema.fields`, and the deprecated `select` of the RPC query options reached through `DataEngineFindRequestSchema`, `DataEngineFindOneRequestSchema` and `DataEngineRequestSchema`) refuse a list naming no field, which they admitted before. Nothing is widened and no key is added, removed or renamed.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped and no metadata type or stored shape moves: these are engine and RPC request declarations, never stored, and no metadata type embeds them. A caller names at least one field or leaves the projection out; there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing of published declarations (`@objectstack/spec/data`). No runtime in this repository parses either member, so no request served here changes; what can break is code outside it that parses with these exported schemas, or a client generated from their JSON Schema, and sent an empty projection.

- **Before.** `EngineQueryOptionsSchema.fields` and the RPC query's `select` admitted any list of strings: `[]`, and a list with a blank or whitespace-only name.
- **Now.** A list must hold at least one name, and no name may be blank (JSON Schema `minItems: 1`, and a non-blank pattern on each name). Both read this rule from the same declaration as `QueryTransportParamsSchema.select` / `$select` and `GetDataRequestSchema.select`, so the refusal messages are the same.
- **Unchanged.** The inferred types (`string[]`), a named projection, and leaving the projection out. The in-process ObjectQL engine does not parse its options with this schema: `engine.find(object, { fields: [] })` still reads every column, as before.

**The remedy.** Name at least one field, or leave `fields` / `select` out to read every column.
