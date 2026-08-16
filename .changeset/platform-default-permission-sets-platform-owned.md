---
"@objectstack/plugin-security": patch
---

fix(security): platform default permission sets are stamped `managed_by: 'platform'`, so `os meta resync` stops skipping every one of them (#8692)

<!-- adr-0087: not-required (no-migration-prescription) One column value added to
one seeder's INSERT, plus a reworded warn line. Nothing authorable is renamed,
retired or tombstoned, so there is no conversion to register — and the ruling
this implements explicitly prescribes NO migration for existing rows (see
below), which is the opposite of a migration prescription rather than an omitted
one. -->

`bootstrapPlatformAdmin` seeded the default permission sets
(`admin_full_access` / `member_default` / `viewer_readonly` …) **without writing
`managed_by`**, so the value fell to the declared `defaultValue: 'admin'` on
`sys_permission_set`. `os meta resync` only reconciles rows the platform still
owns (`managed_by` absent or `'platform'`), so the platform's own default sets
took the skip branch — **measured on a real engine: `resynced 0` /
`resyncSkipped 8`, every shipped set**, each one logged as an *"intentional
override"* for a row no admin had ever touched.

That is the exact inverse of what the resync flag was built for (#2705:
*"reconcile the row to the shipped dist so a dev source edit takes effect
without `--fresh`"*). The command could not perform, for the rows it names in
its own help text, the one job it exists to do.

**The seed insert now stamps `managed_by: 'platform'` explicitly**, which also
puts this seeder in line with its two siblings in the same package —
`bootstrap-builtin-positions.ts` and `bootstrap-system-capabilities.ts` both
stamp `'platform'` rather than inheriting a default. A fresh install's default
sets are now platform-owned, and a resync reconciles all of them. Admin-takeover
protection is unchanged in shape and becomes *real* rather than nominal: a set
an admin takes over in Setup is stamped `'admin'` by the projection path, so
platform-seeded and admin-authored rows finally carry **different** values
instead of the same one.

**Forward-stamp only — existing rows are deliberately NOT migrated.** A stored
`'admin'` is indistinguishable between "the old seeder's field default" and "an
administrator took this set over in Setup". Restamping legacy rows to
`'platform'` would make genuine admin customizations reconcilable and could
silently overwrite them on the next `os meta resync`, so pre-existing rows keep
the skip permanently and by decision. Report, don't rewrite. A legacy install
that wants its platform defaults reconciled has to re-own the rows deliberately
(or re-seed with `--fresh`) — an operator's choice, not one a boot makes for
them. The seeder's docblock records this so the next reader finds a decision
rather than a mystery.

**The skip warning stops claiming intent.** It read
`… row is admin-owned (intentional override)`; on any pre-existing install that
sentence is false, because the only writer may have been this same seeder one
call earlier. It now reads `… row is admin-owned` — provenance and action, no
claim about anybody's intent.

Two comments asserting that the insert-once posture *"keeps the platform
defaults env-authored — the posture `bootstrapDeclaredPermissions` relies on"*
are removed: that reliance was measured false. `bootstrapDeclaredPermissions`
special-cases only `managed_by === 'package'`; every other value — `'platform'`
included — falls to the same `skippedEnvAuthored` branch, so its behaviour is
identical before and after this change.

The pin suite added by the measurement round now asserts both sides of the line
the ruling drew: a fresh install stores `'platform'` and resyncs everything, and
a pre-ruling `'admin'` row is still skipped with its content intact.
