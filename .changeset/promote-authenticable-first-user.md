---
'@objectstack/plugin-security': minor
---

Fix: the platform-admin promotion targets the oldest human that can SIGN IN, not the oldest `sys_user` row

Under the `single` posture the first-boot promotion ranked candidates by age
alone, and "human" was its only filter. On an app that declares people in
`defineStack({ data })` that picked the wrong row every time: a declared person
is a credential-less directory row, the declarative seed is awaited inside
`AppPlugin.start()` (kernel Phase 2), so those rows are always older than any
account created at `kernel:ready` or later.

Measured on a driven composed boot, not inferred: `admin_full_access` was
granted to `person0@demo.example` — a row with no `sys_account`, on a database
whose `sys_account` table was entirely empty — and `claimSeedOwnership` handed
that same unusable row both seeded business records. A real sign-up arriving
afterwards was never promoted, because the promotion had already short-circuited
on "an admin exists". The grant was written, unexercisable, and permanent.

The target is now the oldest human holding a `sys_account`. Any provider counts:
a federated or SSO account is a login, and narrowing to `credential` would
recreate this defect for SSO-only deployments. When human rows exist but none can
authenticate, nobody is promoted and no grant row is written — an `info` line
says so, and the bootstrap replay now also fires on `sys_account` inserts, so the
first real login is promoted the moment it exists. That second half is
load-bearing rather than incidental: a sign-up writes its `sys_user` row before
its `sys_account` row, so the pre-existing `sys_user` trigger fires while the
registrant still has no login.

Deployments that already carry a platform-admin grant are untouched. The
"an admin already exists" short-circuit runs before any target selection, so this
changes which row a FRESH bootstrap promotes and nothing else — moving an
already-granted platform admin is not this change's to make.
