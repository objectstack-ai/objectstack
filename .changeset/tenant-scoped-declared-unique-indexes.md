---
"@objectstack/plugin-security": patch
"@objectstack/plugin-sharing": patch
"@objectstack/plugin-webhooks": patch
"@objectstack/platform-objects": patch
"@objectstack/service-messaging": patch
"@objectstack/spec": patch
---

fix(plugin-security,plugin-sharing,plugin-webhooks,platform-objects,service-messaging,spec): five tenant-scoped declared unique indexes become per-organization (#8554)

Five platform objects declared their uniqueness as a table-level index with bare
`unique: true`. At the DECLARED-index level that is the positional spelling of
`'global'` — the listed columns verbatim — so on a tenant-scoped object each
materialized an **installation-wide** unique index. (Field-level `unique: true`
means the opposite, per-organization, and has since #3696; `packages/lint` names
that divergence "the #4986 trap" and warns on it via
`unique/unscoped-declared-index`.) These are the fourth act of the class ruled on
2026-08-13, after `sys_user_preference` / `sys_capability` (#8461) and
`sys_position` (#8556).

| object | package | was | now |
|---|---|---|---|
| `sys_permission_set` | `plugin-security` | `[name]` global | `[name]` per organization |
| `sys_sharing_rule` | `plugin-sharing` | `[name]` global | `[name]` per organization |
| `sys_webhook` | `plugin-webhooks` | `[name]` global | `[name]` per organization |
| `sys_email_template` | `platform-objects` | `[name, locale]` global | `[name, locale]` per organization |
| `sys_notification_preference` | `service-messaging` | `[user_id, topic, channel]` global | same, per organization |

Measured live on a real engine before the fix — two organizations, the same key,
`OS_TENANCY_POSTURE=isolated`, driving the real shipped declarations. All five
reproduced identically:

```
org_jia POST the key   → 201
org_yi  POST the SAME  → 409 UNIQUE_VIOLATION
org_yi  POST an unused → 201            ← the control that makes it an oracle
org_yi  GET  the key   → total 0        ← refused by a row it cannot see
```

Two consequences, both removed. **A cross-tenant existence oracle:** the 409 is a
per-value answer about a row the caller cannot read, so an organization could
enumerate another organization's permission-set, sharing-rule, webhook and
template naming. **A functional dead end:** the second organization simply could
not use the name, and the refusal did not say why. For
`sys_notification_preference` the shape is the one #8323 measured on
`sys_user_preference` — a user belonging to two organizations could not hold
independent per-topic delivery toggles.

## ⚠️ Operators: a migration is REQUIRED, and deploying this release is not it

Respelling a declared index changes its generated **name**. On an existing
database `initObjects` is additive: it creates the new per-organization composite
at boot and **never drops the old global index**, which goes on enforcing. Until
the retirement is applied, a deployed installation that has taken this release is
still enumerable — that is asserted as a test, not assumed.

Run the migration:

```
os migrate plan       # shows one `replace_unique_index` per object, categorised `safe`
os migrate apply      # no --allow-destructive needed
```

Each object plans as **one pure relaxation**, not as two findings. That matters:
if it read as "composite missing" (safe) plus "old global index orphaned"
(destructive, opt-in), an operator applying only the safe half would keep the
global index — keep the defect — while the plan read as applied. The `#8461`
`replace_unique_index` arm covers all five unchanged (no driver change in this
release), applies CREATE-before-DROP so uniqueness is never unenforced in
between, drops the legacy index only once the replacement is confirmed present,
preserves every row, and converges to no drift.

Two columns are worth an operator's attention:

- `sys_notification_preference`'s replacement index name is **hash-suffixed** —
  `uniq_sys_notification_preference_a22d7d27` — because the natural name is 70
  characters and the limit is 60. That is expected, not corruption.
- Rows with no `organization_id` (platform/seed rows) stay unique **among
  themselves**: the organization key part is NULL-safe
  (`COALESCE(organization_id, '__global__')`, ADR-0120 D3), so seeding by name
  keeps working and a tenant may hold its own row of the same name.

## Not breaking

A relaxation admits key pairs that were previously refused and refuses nothing
that previously succeeded, so no caller that worked before fails now. Every read
path for these five objects goes through the tenant-scoped data API, so no
consumer resolves one of these names across organizations expecting at most one
row. Shipped as `patch` for that reason — the same call #8556 made for the same
shape.

Published text carrying the bare uniqueness claim was corrected at its source and
the generated reference pages regenerated (`security/permission.mdx`,
`automation/webhook.mdx`, and `integration/connector.mdx`, which embeds the same
webhook schema), together with the `sys_permission_set` field description, its
clone-dialog help text, the `sys_webhook` field description, and the matching
translation bundles in all four shipped locales.
