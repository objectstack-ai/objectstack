---
'@objectstack/objectql': minor
---

Report stored `lookup` references that resolve to nothing (#4551)

#4441 made the write path refuse an unresolvable reference id, but deliberately
exempted `isSystem` writes so seed replay, package install and boot-time
provisioning keep their ordering freedom. That exemption is unchanged — and it
left a residual: the platform itself could still write a reference into the void
with nothing saying so.

New: `ObjectQL.inspectDanglingReferences()` — a **read-only** audit that walks
stored rows and reports every non-`readonly` `lookup` / `master_detail` /
`user` / `tree` value that names no row of its declared target. It runs as a leg
of the existing `LifecycleService` sweep, so the finding surfaces without an
operator knowing to go looking for it.

- **It never rewrites.** The rows were genuinely written; auto-nulling a
  dangling id would make the stored data disagree with what happened, and the
  remedy (re-seed the target vs. clear the link) is an operator's call.
- **Unknown is not absent.** A probe that cannot run (target unregistered, no
  driver, probe throws) counts as `undetermined`; an object whose rows cannot be
  listed lands in `unreadableObjects`; a run that hits its row budget names the
  object in `truncatedObjects`. So `dangling: []` can never be misread as
  "everything is fine".
- **RBAC link tables are scanned first** (`sys_position_permission_set` and the
  rest of `plugin-security`'s tables, derived from `PLATFORM_OBJECTS_BY_PACKAGE`):
  a dangling row there is a security-surface record resolving to nothing, and
  the audience-anchor gate must resolve exactly that permission set to evaluate
  the grant.

The existence oracle is the engine's own — the same predicate #4441's write-path
guard uses — so the report can never be stricter or looser than the rule it
reports on.

Tuning: `ObjectQLPlugin`'s `lifecycle.referenceAudit` (`enabled`, `rowsPerObject`,
`maxRows`, `objects`). Nothing is authorable in metadata; no spec key was added.
