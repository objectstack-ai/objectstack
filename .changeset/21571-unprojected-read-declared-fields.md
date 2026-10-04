---
'@objectstack/objectql': minor
---

fix(objectql)!: a read with no projection serves the object's declared fields and the platform's system columns, never a column no metadata declares (#21571)

**BREAKING (narrowing)** — what a released read door serves shrinks. A column that
no metadata declares, typically a field retired in an upgrade whose column additive
schema sync leaves in the table until `os migrate apply --allow-destructive`, is no
longer returned by any read through the engine.

| read | before | now |
| --- | --- | --- |
| `POST /api/v1/data/:object/query` or `GET /api/v1/data/:object` with no `fields` | every column of the table, retired ones and their values included | the declared fields, the registry's system columns, `id`, `created_at`, `updated_at` |
| `GET /api/v1/data/:object/:id`, export, search hits, the RPC dispatcher, `expand`ed records | the same whole row | the same declared set |
| `engine.find` / `engine.findOne` in process (hooks, flows, plugins), no `fields` | the whole row | the declared set |
| an explicit `fields` naming a declared field whose column does not exist yet (driver-sql retries `select('*')`) | the whole row, retired columns included | the declared set |
| `POST /api/v1/data/:object/:id/clone` of a record whose table carries a retired column | refused `INVALID_FIELD` (the copy carried the retired column into the insert) | cloned |

**Unchanged:** naming a retired column in `fields` still answers `400 INVALID_FIELD`
on the data door. Declared fields keep their treatment: `internal: true` omission,
credential masking, formula evaluation and the hidden `__search` strip run as
before, and the registry-injected tenant, owner and audit columns are still served.
No driver changed: the engine shapes the rows any driver returns, so the answer is
the same on every driver and every door. Writes, and the rows a write returns, are
not changed by this release.

**If you still read a retired column's values** (for example a one-time conversion
that copies the old columns into their replacement field): run that conversion
BEFORE upgrading to this release, while the old field is still declared, or, once
it lands, read the unmapped columns through the operator-only `os migrate` read
(objectstack#21573). There is no flag that re-opens undeclared columns on a runtime
door. An in-process reader that needs a column must declare it as a field.

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No authorable key, spelling, export, config field or stored shape is removed or renamed, and no stored row is read or rewritten: the change narrows which physical columns the engine's read verbs return, to the field map the metadata already declares. A retired column's values stay in the table; what an app does with them is an operator action stated above (convert before upgrading, or the operator-only os migrate read), not a FROM to TO mapping that objectstack migrate meta could apply. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers a read projection (not registered / already-registered); and the change is runtime behaviour, not a declaration (not runtime-interface-only / type-surface-only). -->
