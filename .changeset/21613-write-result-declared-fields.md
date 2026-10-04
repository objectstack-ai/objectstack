---
'@objectstack/objectql': minor
---

fix(objectql)!: the record a write returns, and the prior read it binds as `previous`, serve the object's declared fields and the platform's system columns, never a column no metadata declares (#21613)

**BREAKING (narrowing)** — what a released write door returns shrinks. A column that
no metadata declares, typically a field retired in an upgrade whose column additive
schema sync leaves in the table until `os migrate apply --allow-destructive`, is no
longer returned by any write through the engine. This completes the read-side rule of
the previous release (#21571) for writes.

| write | before | now |
| --- | --- | --- |
| `PATCH /api/v1/data/:object/:id`, batch `update`, `updateMany` | the post-write row read back with `select *`: retired columns with their stored values | the declared fields, the registry's system columns, `id`, `created_at`, `updated_at` |
| `POST /api/v1/data/:object`, `POST /api/v1/data/:object/:id/clone`, `createMany`, batch `create` / `upsert`, `insertMany` outcomes | the inserted row from `returning('*')`: retired columns as `null` | the same declared set |
| `data.record.created` / `data.record.updated` events, and the webhook deliveries that carry them as `after` | the same whole row | the declared set |
| `engine.insert` / `engine.update` in process (actions, flows, plugins), and a hook's `ctx.result` | the whole row | the declared set |
| a hook's `ctx.previous` on update and delete (by id and per row), and the audit ledger's delete `old_value` and create `new_value` | the whole stored row, retired columns and their values included | the declared set |

**Unchanged:** declared fields keep their treatment. An `internal: true` field is still
returned whole on the engine-level write result to the privileged writer that just
wrote it, and still stripped from every data-door response; formulas are still
hydrated onto the result; the registry-injected tenant, owner and audit columns are
still returned. No driver changed: the engine shapes the rows any driver returns, so
the answer is the same on every driver and every door. A retired column's values stay
in the table.

**If you still read a retired column's values off a write** (for example a hook, a
flow or a webhook receiver that copied an old column into its replacement): run that
conversion BEFORE upgrading to this release, while the old field is still declared, or,
once it lands, read the unmapped columns through the operator-only `os migrate` read
(objectstack#21573). There is no flag that re-opens undeclared columns on a write. A
reader that needs a column must declare it as a field; a validation rule, a
`readonlyWhen` or a hook condition that reads a column must name a declared field too.

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No authorable key, spelling, export, config field or stored shape is removed or renamed, and no stored row is read or rewritten: the change narrows which physical columns the engine's write verbs and their prior reads return, to the field map the metadata already declares. A retired column's values stay in the table; what an app does with them is an operator action stated above (convert before upgrading, or the operator-only os migrate read), not a FROM to TO mapping that objectstack migrate meta could apply. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers a write result's projection (not registered / already-registered); and the change is runtime behaviour, not a declaration (not runtime-interface-only / type-surface-only). -->
