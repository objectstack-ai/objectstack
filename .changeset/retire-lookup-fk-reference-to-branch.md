---
"@objectstack/driver-sql": patch
---

fix(driver-sql): retire the lookup FOREIGN KEY branch gated on the rejected alias `reference_to`, and refuse the key instead of honouring it (#11567)

`SqlDriver.createColumn` emitted `table.foreign(name).references('id')` for a
relationship field carrying `reference_to`. `reference` is the only relationship
spelling `@objectstack/spec` declares — `reference_to` is a **rejected alias**,
answered by `FieldSchema` with `unrecognized_keys` and *"Did you mean
`reference_to` → `reference`?"* — so that branch could not fire for any
spec-conformant lookup, and never had.

**This is not a behaviour change for any authored deployment.** Measured across
all 44 exported platform objects on live PostgreSQL 16.13 and MySQL 8.0.46
before the change: **0** FOREIGN KEY constraints. `reference_to` has zero
non-test assignments repo-wide; the branch was reachable only by metadata that
went around Zod through raw `registerObject` (which deliberately skips it).

What changes is that the driver no longer disagrees with the spec in silence. A
field still carrying `reference_to` at DDL time now throws
`VALIDATION_ERROR`/400 naming it as a rejected alias of `reference`, in the same
words `FieldSchema` uses, rather than quietly changing the physical schema. One
key, one answer, on both doors.

Fix, if you have such metadata — the same rename the schema has always asked for:

| Wrote | Write instead |
|---|---|
| `{ type: 'lookup', reference_to: 'account' }` | `{ type: 'lookup', reference: 'account' }` |

Referential integrity is unchanged and remains the **engine's**, applied via
`deleteBehavior` (the `409 DELETE_RESTRICTED`) — which is what
`content/docs/protocol/objectql/types.mdx` has documented since 2026-07-30.

**Not graded as declared-breaking, deliberately.** ADR-0087's ledger reaches
upgraders about *authorable metadata* that must be rewritten. `reference_to` is
not authorable: the spec refuses it at the authoring door today and did before
this change, so no conformant object definition behaves differently and no
migration is owed to any deployment `objectstack migrate meta` can see. The
prescription above exists for metadata that bypassed validation, not for a
surface this repo ever published as writable.
