---
"@objectstack/spec": minor
"@objectstack/metadata-protocol": patch
"@objectstack/metadata": patch
"@objectstack/objectql": patch
"@objectstack/service-automation": patch
---

feat(spec,metadata-protocol,metadata,objectql,service-automation): stored metadata replays the full conversion chain at rehydration (#3903)

Every mechanism the platform has for evolving the metadata contract — schema
transforms, the ADR-0087 D2 conversion layer, the D3 migration chain, the
protocol-17 tombstones — operated on **authored source** only. Metadata **at
rest** (`sys_metadata` rows written by Studio or the runtime authoring APIs)
was rehydrated unparsed and unconverted, so the authored and stored contracts
silently diverged: a pre-17 row carrying `conditionalRequired` or `execute`
read as whatever each ad-hoc consumer happened to do with it.

**New spec primitive — `applyConversionsToStoredItem(type, item, options?)`**
(exported from the package root). Wraps one stored item of a given metadata
type and replays the **full** conversion chain over it — `retiredFromLoadPath`
entries included, because retirement is an *authoring-surface* event: the
window exists to teach a live author, and a row at rest has no author to
teach. Idempotent, never throws, never validates.

Wired at every stored-row rehydration seam:

- `metadata-protocol`: `loadMetaFromDb`, `getMetaItems` (active + draft
  preview), `getMetaItem` (active + draft), `getMetaItemLayered`, and
  `duplicatePackage` (a copy re-saves through the schema gate, so legacy
  sources now duplicate successfully — and the copy is canonical).
- `metadata`: the DatabaseLoader's live-row reads (`load` / `loadMany`).
  History reads stay verbatim — history records what was written.
- `objectql`: the authored-action / authored-hook direct table reads, so
  runtime-authored actions stored with the removed `execute` alias dispatch
  via `target` again.
- `service-automation`: `AutomationEngine.registerFlow` now passes
  `includeRetired` — stored flows keep canonicalizing after their conversions
  graduate out of the load window. (The generic metadata seams deliberately
  skip `type: 'flow'`: flow conversions carry the open-namespace conflict
  guard, which needs this engine's live executor registry.)

**Boot hydration diagnoses instead of shrugging.** `loadMetaFromDb` now
returns `{ loaded, errors, invalid }`: each row is validated against its
type's spec schema *after* conversion, and a genuine contract violation is
counted and warned with a stable `[metadata_spec_invalid]` marker — but still
registered, deliberately: refusing at boot would unhook live tables and make
the row unlistable and unfixable in Studio. The write path (`saveMetaItem` →
422) and the read-side `_diagnostics` envelope remain the enforcing gates; the
`SchemaRegistry.registerItem` validation hook is now documented as exactly
that diagnostic.

**Retired accommodation.** With the chain running on every stored read path,
the rule-validator's `requiredWhen ?? conditionalRequired` fallback — kept in
#3883 with a retirement promise that had no mechanism — is deleted. If you
call `evaluateValidationRules` directly with raw legacy field definitions,
convert them first (`applyConversionsToStoredItem('object', def)`) or author
`requiredWhen`; the platform's own read paths already hand you canonical
shapes.
