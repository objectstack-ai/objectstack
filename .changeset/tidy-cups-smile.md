---
'@objectstack/objectql': minor
'@objectstack/metadata-protocol': minor
---

**BREAKING (behaviour):** a static `readonly` field is now stripped from a **non-system caller's INSERT payload inside `engine.insert`**, exactly as it already was on `engine.update`. A non-system create that used to write a read-only column now has that column dropped, reported through `onFieldsDropped` / `droppedFields`, logged at `warn`, and refused outright under `strictReadonlyWrites`. Seeding a read-only column at create time is a **system** act — use `context.isSystem`, a flow's `runAs: 'system'`, a system hook or a seed.

Until now the create-side strip lived only at the DataProtocol ingress (`stripReadonlyForInsert` in `@objectstack/metadata-protocol`), so `readonly` meant one thing on insert and another on update: every external REST/GraphQL/MCP create was stripped, while a caller reaching `engine.insert` directly — the automation engine's `create_record` among them — wrote the column with no refusal, no `WARN` and no dropped-field event.

- `stripReadonlyForInsert` and its five call sites in `@objectstack/metadata-protocol` are **deleted**, not kept as a second implementation; every create face (`createData`, `cloneData`, `createManyData`, `insertManyData`, `batchData`) now hands the caller's payload to the engine whole and reports the engine's own verdict, so `droppedFields` says the same thing at every seam.
- `create_record` (`@objectstack/service-automation`) starts receiving readonly drops on the `onFieldsDropped` channel it has been wired for since #3407 — a flow without `runAs: 'system'` that seeds a read-only column now reports a node warning and `output.droppedFields` instead of a clean success.
- Unchanged, deliberately: `isSystem` is still the exemption; `preserveAudit` is still an UPDATE-path exemption and a create that asks for it is told so out loud; runtime-owned types (`autonumber`) keep their own pass and their own wider whitelist; platform objects (`managedBy`, the `sys_` namespace) are still left to their own field-write guards; `readonlyWhen` still has no create-side strip. A stripped key's `defaultValue` is re-derived, so a forged `approval_status` becomes `draft` rather than NULL.
