---
"@objectstack/objectql": minor
"@objectstack/spec": minor
---

fix(objectql,spec): run the pre-delete reference check under the system identity (#12166)

**Grade: `minor`, not `patch` — argued, because a permission-behaviour change
should not arrive as a bug-fix bump.** Configurations that returned `403` now
return `200`. Nothing gets more restrictive and no API changes shape, so this
is not `major`; but "records a role could never delete are now deletable" is a
security-surface accept-set change an upgrader must be able to see in a
release-notes heading, and a `patch` line is exactly where it would not be
looked for. The spec half ships `minor` alongside because the message catalog
gains two keys.

Deleting a record runs the platform's pre-delete reference check, which issues
a `find` against every referencing object. That probe ran as the **calling
operator**, so a caller with full delete rights on the target but no read grant
on any referencing object got a blanket `403 PERMISSION_DENIED` — regardless of
whether a reference actually existed. An **empty** referencing table 403'd too.
The reporting deployment (`@objectstack/*@17.2.0`) measured 17 role×object
pairs where the UI shows a delete button that always fails, with the A/B
control that granting read-only on the referencing object — touching *nothing*
about delete rights — turned the identical operation into a `200`.

It silently made "delete permission" mean "delete **plus read on every
referencing table**", a coupling invisible in the permission UI and impossible
for an administrator to self-diagnose: the refusal said only "You do not have
permission to perform this action."

Referential-integrity actions are engine responsibility executed under system
identity on every mainstream platform — the RDBMS FK baseline, Salesforce
(lookup clearing and cascade delete documented as bypassing sharing),
Dataverse, ServiceNow, Odoo. Caller identity here was the outlier. Maintainer
ruling 2026-08-26, option A.

**What changed.** The dependents probe now runs `sudo()`-shaped —
`{ ...context, isSystem: true }`, following the in-repo precedent in
`packages/objectql/src/integrity/dangling-reference-audit.ts`. The spread is
load-bearing: the caller's open transaction handle, **tenant scope** and
`userId` all survive, so the probe does not leave the caller's transaction and
does not read across the tenant wall.

**What did NOT change.** Only the reference *check* switches identity. The
caller's own delete authorisation on the target is untouched; the `set_null`
`UPDATE`, the `cascade` `DELETE` and the target's own delete all still run as
the caller. A caller without delete rights on the target is refused exactly as
before — pinned in both directions, because a relaxation must not become a
hole.

**Refusal copy.** Because the probe now sees rows the caller may hold no read
grant on, `DELETE_RESTRICTED` discloses the dependent **count** only when the
caller's own identity would have produced the same rows (compared on row
identity, so row-level narrowing counts too). Otherwise the count is withheld
and the refusal renders one of two new catalog keys,
`delete_restricted_opaque` / `delete_restricted_required_opaque` — the same
sentences minus `{{count}}`, in all four bundled locales. Without that, the
refusal would be an exact, repeatable cardinality oracle over a table the
caller may not read. The referenced **object** and the relation field are named
either way: those are declared metadata, and they are the whole of what makes
the refusal self-diagnosable. `dependentCount` is **absent** rather than `0` in
the withheld case — `0` would be a false statement about the rows.

**Audit.** The elevation is filed with both halves, the Salesforce/Dataverse
ledger shape: `triggeredBy` = the deleting operator, `executedAs: 'system'`,
plus the referenced object and relation field — never a row id, value or count.
It is filed *before* the probe, so a refused or failed check is recorded too.
Declared limit: this is an engine **log** record, not a `sys_audit_log` row —
the elevated operation is a read, and `plugin-audit`'s read writer declares and
pins that a system-elevated read produces no row. A durable row belongs to the
plugin that owns that shape.

**Upgrade note.** If a deployment was relying on the `403` as a de-facto delete
gate, that gate is gone. Under the industry baseline such usage is itself
non-standard and should be expressed as an explicit `deleteBehavior: 'restrict'`
on the relationship rather than as a read-permission side effect. No such
reliance was measured; the ruling records this as a known confidence gap.
