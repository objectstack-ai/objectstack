---
"@objectstack/platform-objects": patch
---

fix(platform-objects): `sys_setting`'s declared unique index becomes per-organization (#8555)

`sys_setting` declared its row identity as a table-level index with bare
`unique: true`. At the DECLARED-index level that is the positional spelling of
`'global'` — the listed columns verbatim — so `(namespace, key, scope, user_id)`
materialized as an **installation-wide** unique index on a tenant-scoped object.
(Field-level `unique: true` means the opposite, per-organization, and has since
#3696; `packages/lint` names that divergence "the #4986 trap".) This is the sixth
instance of the class ruled on 2026-08-13, after #8461, #8556 and #8554's five.

| object | package | was | now |
|---|---|---|---|
| `sys_setting` | `platform-objects` | `[namespace, key, scope, user_id]` global | same columns, per organization |

## Why per-organization, when this object had an argument for staying global

`sys_setting` carries a `scope` column, so the card that filed this asked a real
question first: if `scope` itself encoded tenancy, the installation-wide key was
correct and the fix was to spell `'global'` explicitly. It does not. `scope` is
the cascade LAYER — `global | tenant | user`, a priority ladder walked
env > global > tenant > user > default — and the organization is carried by
`organization_id` and nothing else. `SettingsService.loadRows` says so outright
("per-tenant isolation for `tenant`-scope rows is still enforced by the engine"),
`upsertRow` bypasses the tenant audit only for `scope='global'` rows "because
global rows are platform-wide", and the `lifecycle` manifest depends on the
per-organization reading: `retention_overrides` is `scope: 'tenant'` precisely so
that "regulated tenants set years; dev sets days ... one deployment can carry
both" (ADR-0057 §3.2).

The `scope='global'` layer is **not** lost by scoping the index. The organization
key part is NULL-safe (`COALESCE(organization_id, '__global__')`, ADR-0120 D3),
and platform rows carry no organization — so they share one bucket and stay
unique among themselves, which is exactly the installation-wide platform default
the resolver reads at rung 2.

## Measured live on a real engine before the fix

Two organizations, the same `(namespace, key)`, `OS_TENANCY_POSTURE=isolated`,
driving the real shipped declaration:

```
scope='user'    org_jia POST (mail, smtp_host, user, usr_1) → 201
                org_yi  POST the SAME                       → 409 UNIQUE_VIOLATION
                org_yi  POST an unused key                  → 201    ← the control
                org_yi  GET  the colliding key              → total 0
scope='tenant'  org_jia 201 / org_yi the SAME → 201
scope='global'  platform 201 / platform the SAME → 201
```

The 409 is the class defect: a per-value refusal on a row the caller cannot read
is a cross-tenant existence oracle, and two organizations could not hold
independent per-user settings for the same key.

⚠️ **The two 201s are a second, independent defect that this release does NOT
fix.** `user_id` is NULL on every `tenant` and `global` row, and SQL UNIQUE is
NULL-distinct, so the declared row identity is unenforced on those limbs — even
within one organization, two rows for the same `(namespace, key, scope)` are
accepted. The organization key part is NULL-safe; the author-declared `user_id`
column is not. Closing that needs a contract decision about null-safety on
author-declared columns plus a duplicate pre-flight for databases that have
already accumulated duplicates, so it is filed separately rather than smuggled in
here. It is pinned as a live fact in the driver suite so this change cannot be
read as having fixed it.

## ⚠️ Operators: a migration is REQUIRED, and deploying this release is not it

Respelling a declared index changes its generated **name**. On an existing
database `initObjects` is additive: it creates the new per-organization composite
at boot and **never drops the old global index**, which goes on enforcing. Until
the retirement is applied, a deployed installation that has taken this release
still refuses a second organization's per-user setting — that is asserted as a
test, not assumed.

```
os migrate plan       # one `replace_unique_index` on sys_setting, categorised safe
os migrate apply      # no --allow-destructive needed
```

It plans as **one pure relaxation**, not as two findings. That matters: if it
read as "composite missing" (safe) plus "old global index orphaned"
(destructive, opt-in), an operator applying only the safe half would keep the
global index — keep the defect — while the plan read as applied. The `#8461`
`replace_unique_index` arm covers it unchanged (no driver change in this
release), applies CREATE-before-DROP so uniqueness is never unenforced in
between, drops the legacy index only once the replacement is confirmed present,
and converges to no drift.

Two notes worth an operator's attention:

- The replacement index name,
  `uniq_sys_setting_organization_id_namespace_key_scope_user_id`, is exactly 60
  characters — the limit — so it is emitted untruncated rather than
  hash-suffixed.
- Because the replacement does **not** tighten the `user_id` column, the
  migration still applies cleanly to a database that already carries duplicate
  `scope='tenant'` rows (which the old index permitted). Row counts are
  preserved; nothing is deduplicated.

## Not breaking

A relaxation admits key pairs that were previously refused and refuses nothing
that previously succeeded, so no caller that worked before fails now. Every write
to `sys_setting` goes through `SettingsService.set()`, whose upsert keys on
`(namespace, key, scope, user_id)` under the engine's tenant scoping — the shape
this index now matches.
