---
"@objectstack/core": patch
"@objectstack/objectql": patch
"@objectstack/service-automation": patch
---

fix(objectql)!: a `runAs: 'system'` flow's record writes keep the reference check while keeping their authorization elevation (#28881)

Clause-②: no (narrowing) — a `runAs: 'system'` flow's `create_record` / `update_record` (and any custom node writing through `resolveRunDataContext`) that names a lookup, user or master-detail id resolving to no row is refused, which it admitted before. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped. The write-time reference check the user path already applies now also applies to an elevated flow's record writes, with the same reference_not_found refusal; the mark that keeps it on is an internal symbol on the run's context, not an authorable key, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at an elevated flow's record writes (`@objectstack/objectql`, `@objectstack/service-automation`).

- **Before.** The write-time reference check returned early for every system context. A flow that runs as system writes with `isSystem: true`, so its `create_record` / `update_record` stored a reference to a deleted row with no error, while the same write on the user path was refused `reference_not_found`.
- **Now.** `resolveRunDataContext` marks a system run's data context (`markFlowWriteReferenceCheck`, `@objectstack/core`: a symbol, in no schema, not authorable), and the check keeps checking a marked write. The refusal is the user path's own: `VALIDATION_FAILED` with the field's `reference_not_found` error, carried as the node's inner refusal.
- **Unchanged.** The run's authorization elevation: it still writes rows other people own, past RLS and FLS, inside the trigger's organization. Every system writer outside a flow run keeps the exemption: seed replay, package install, boot provisioning, import under a system principal, restore and migration, the cascade and set-null legs of a delete no flow made, and a hook's or action body's writes when no flow-run write set them off.
- **Writes a flow write sets off.** They carry the mark too and are checked as the flow's own, as on the user path: a hook's `ctx.api` (and its `runAs: 'system'` or `ctx.api.sudo()` elevation) under a flow's write, and the engine's cascade legs under a flow's delete. A cascade leg writes no new link, so only the value it writes is judged.
- **Who sees it.** A system flow that writes an id naming no row in its organization, including the owner it stamps from its trigger user when that user has no `sys_user` row. A flow that wants to tolerate a missing target clears the field first. One case surfaces data that is already wrong: a flow's `delete_record` whose `set_null` cascade removes the deleted id from a `multiple: true` reference field rewrites the members that remain, so if one of them already names a row that is gone, the cascade write is refused `reference_not_found` and the delete fails. The same delete on the user path fails the same way; a multi-value field keeping a deleted id is tracked in #29062.

**The remedy.** Write an id that resolves, or leave the field empty.
