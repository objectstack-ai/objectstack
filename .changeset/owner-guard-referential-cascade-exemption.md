---
'@objectstack/plugin-security': patch
'@objectstack/objectql': patch
---

fix(security): exempt engine referential FK clears from the owner_id transfer guard (#3023)

Follow-up to the #3004 ownership-anchor guard. `owner_id` is a lookup to `sys_user`
with the default `deleteBehavior: 'set_null'`, so deleting a `sys_user` makes
`cascadeDeleteRelations` null `owner_id` on every dependent row. That cascade write
re-entered the write middleware under the deleter's context, where the #3004 guard
read the `owner_id = null` as a user-initiated disown and denied it — aborting the
cascade mid-way (no transaction, so partial state) for any deleter without the
transfer grant on the child object (e.g. a member clearing a `public_read_write`
child that RLS would otherwise have allowed).

The cascade FK clear is engine-mandated referential integrity consequent to an
already-authorized parent delete, not a user ownership change. `cascadeDeleteRelations`
now tags the `set_null` write with a server-derived `__referentialFieldClear` context
marker (set by the engine, never built from a request — same trust model as
`__expandRead`), and the ownership-anchor guard skips when that marker is present.
Ordinary user writes are unaffected; the marker cannot be forged from client input,
so it can never slip a real ownership transfer past the guard.
