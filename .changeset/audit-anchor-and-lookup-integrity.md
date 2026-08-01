---
"@objectstack/objectql": minor
"@objectstack/spec": minor
---

fix(data): the audit anchor is engine-owned, and a lookup must resolve (#4447, #4441)

Two write-path contract holes from the v17 verification sweep.

**#4447 — `created_at` was client-writable on an ordinary PATCH.** Its two
siblings only looked protected: the audit hook force-advances `updated_at` /
`updated_by` on every update, so a forged value is overwritten. `created_at` is
insert-only, so nothing overwrote it. The root cause is a *declared* audit
field shadowing the platform's: `applySystemFields` skips its injection when
the object already carries the name, and the merge lets the declared one win —
correct for an authored business field, wrong for the audit family. A built app
artifact ships a materialized `created_at` carrying only FieldSchema defaults
(`readonly: false`), which shadowed the engine-owned definition, so the
readonly strip had nothing to key off. The audit family's **governance**
(`readonly` / `system` / `type` / `reference`) is now forced by the platform
while presentation (label, description, hidden, group …) stays the author's.
Back-dating is unaffected: `preserveAudit` (#3479/#3493) and `isSystem` writes
still reinstate the original timeline. The strip now also reports through
`droppedFields`, giving the #3794 contract its first live producer on this axis.

**#4441 — a `lookup` accepted an id that exists in no row of its target.**
Including `sys_position_permission_set.permission_set_id`, where a dangling row
is a security-surface record that resolves to nothing and the audience-anchor
gate has to resolve that very set to evaluate the grant. Writes are now refused
with `400 VALIDATION_FAILED` and a `fields[]` entry
(`code: 'reference_not_found'`, naming the field, the target and the
unresolvable id) — the catalogued `FieldErrorCode` that had no emitter until
now, with its message in the four platform locales.

Scope for #4441 is deliberately narrow: caller-supplied keys only (so server
stamps are never reported as the caller's bad reference), non-system writes only
(seed replay and package install keep their ordering freedom), empty means "no
link", and it fails OPEN when the target cannot be checked. The existence probe
is unscoped, because existence is a fact about the database — whether the caller
may create the binding stays the RBAC/RLS layer's decision.
