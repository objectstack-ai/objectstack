---
'@objectstack/objectql': patch
---

fix(objectql)!: the in-process engine refuses an empty projection, as every published declaration of a read's projection does (#27008)

Clause-②: no (narrowing) — `ObjectQL.find` / `findOne` refuse `fields: []`, and an `expand` entry's `fields: []` at any depth, which they read before as every column. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: EngineQueryOptionsSchema.fields already declares the refusal, and the engine now enforces it at its entry. There is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at the in-process read entry (`@objectstack/objectql`).

- **Before.** The HTTP doors refuse `select: []` with `400 VALIDATION_ERROR`, and `EngineQueryOptionsSchema.fields` declares the same refusal, but `engine.find(object, { fields: [] })` and `findOne` never parsed their options with that schema. The empty list reached the driver, which serves it as no projection: every column came back, owner, organization and audit columns included, and the caller was not told. An `expand: { rel: { fields: [] } }` entry expanded every column of the related record the same way.
- **Now.** Both entries refuse an empty projection before any driver read: the top-level `fields`, and every `expand` entry's `fields` at any depth. The error carries `status: 400` and `code: 'VALIDATION_ERROR'`, the answer the HTTP doors give, so `mapDataError` serves an in-process caller and a REST caller alike. Its words are the declaration's own (`Name at least one field`), read off `EngineQueryOptionsSchema.fields`. A system-context read is refused too: the rule is about the shape, not the caller.
- **Unchanged.** An absent or `null` `fields` still reads every column. A non-empty projection projects as before, including the tolerance for an unknown plain column.
- **Who sees it.** A plugin, hook, flow or other in-process caller that passed an empty projection, by mistake or by building one that came out empty. No in-repo caller does.

**The remedy.** Leave `fields` out to read every column, or name the columns to read.
