---
"@objectstack/spec": major
---

chore(spec)!: retire `IDataEngine.batch?` — declared for the life of the contract, implemented by nothing, called by no one (ADR-0119 D3, #4618)

**FROM → TO**

| Removed | Use instead |
|---|---|
| `IDataEngine.batch?(requests, { transaction })` | `IObjectQLEngine.transaction(cb)` for in-process multi-write atomicity |
| — a batch over ONE object | the metadata protocol's `batchData` with `options.atomic: true` |
| — a cross-object batch over the wire | `POST {basePath}/batch` |
| `DataEngineBatchRequestSchema` / `data/DataEngineBatchRequest` JSON schema | nothing — it described only the removed member |

**One-line fix:** delete the `batch` implementation from any engine that has one (there were none in this repo) and route multi-write atomicity through `engine.transaction(cb)`.

## Why

`batch?` was declared on `IDataEngine` for as long as that contract has existed and was **never implemented by any engine** — `ObjectQL` has no `batch` method, and there is no other engine in the tree. It also had **no caller**: `DataEngineRequest` was imported by exactly one file, the contract declaring the member.

Its entire specification was a three-word doc comment, "Batch Operations (Transactional)", which settles nothing about partial failure, ordering, cross-object references, rollback scope, or what `transaction: false` was supposed to mean — the questions a batch API exists to answer. Contrast its neighbours `getDefaultDriverName?` / `getDriverByName?`, whose optionality is evidenced: each names its implementer and its probing caller.

The tell that nobody ever designed against it is in the schema. `DataEngineBatchRequestSchema.requests` nested the request union **recursively** — a batch could contain batches — with no statement anywhere about what that meant for ordering or rollback.

The only test was a type pin: an ad-hoc object literal carrying a `batch` property, asserting the property was defined. It could not fail while the declaration existed, and would have passed unchanged for the member's entire life with no engine implementing it. A test that asserts a contract member is *declared* is not evidence the contract is *honoured*.

A declared capability that cannot be exercised is ADR-0049's enforce-or-remove target. What this one claimed is now covered by members that are real — ADR-0119 D1 made `transaction` reachable through the contract, D4 made `batchData`'s `atomic` honest — so the removal deletes a false affordance, not a capability.

## Scope notes

- **The wire batch is untouched.** `POST {basePath}/batch` validates with `CrossObjectBatchRequestSchema` / `BatchUpdateRequestSchema` from `api/batch.zod.ts` — a different schema that never had anything to do with the removed one.
- **`DataEngineRequestSchema` stays**, minus its `batch` arm. Every remaining arm now has zero readers in this repo (there is no Virtual Data Engine implementation, only this schema describing one), which makes the whole block a further enforce-or-remove candidate — tracked separately, because retiring a published wire protocol is a different decision from retiring `batch?` and does not belong in a change whose title promised something narrower.
- **Deliberately no `retiredKey()` tombstone.** A tombstone delivers its prescription through a *parse*, and nothing ever parsed `DataEngineBatchRequestSchema`. A prescription nobody can receive is noise (the `spec-property-retirement` playbook's third route). Its three `authorable-surface.json` baseline lines and its `json-schema.manifest.json` entry are therefore dropped in this change, deliberately, along with the now-stale `docs-import-surface.baseline.json` line that excused its missing type export. The enforced channel here is `tsc`, and it points at callers.
