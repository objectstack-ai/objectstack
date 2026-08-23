---
'@objectstack/service-storage': patch
---

Fix attachment tombstoning silently no-opping on a predicate (`multi: true`) delete

Deleting `sys_attachment` join rows by PREDICATE left the file they referenced at
`status='committed'` with `deleted_at` NULL, even when the deleted row was the
file's last reference. The tombstone hooks handed file ids from `beforeDelete` to
`afterDelete` on the hook context itself, on the premise that the engine passes
the same `HookContext` to both events. Since ADR-0058 Addendum II (D1/D2) a
predicate write dispatches one FRESH context per matched row in each phase, so
that hand-off never arrived and no tombstone was written.

The bytes were stranded permanently rather than late: `sys_file`'s declared
lifecycle nominates a sweep candidate only via `ttl { field: 'deleted_at' }` or
`retention { onlyWhen: { status: 'pending' } }`, and an untombstoned orphan
matches neither — so the reap guard was never asked about it. The by-id delete
verb, and both dispatch paths of the update verb, were unaffected.

The departed id now comes from `ctx.previous.file_id`, which the engine binds on
both phases and both dispatch paths — the same slot the update verb's detach leg
already reads.

**What an upgrader needs to know.** New predicate deletes tombstone correctly
from this version on. Files ALREADY stranded by the old behaviour are not
retro-actively tombstoned by this change: they sit at `status='committed'` with
live storage bytes and no join row, and nothing in the platform sweep will
nominate them. Recovering that existing backlog needs a one-off reconciliation
pass over `sys_file` (attachments-scope, `status='committed'`, zero
`sys_attachment` references) and is deliberately not part of this fix.
