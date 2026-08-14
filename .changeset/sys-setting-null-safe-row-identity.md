---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): `sys_setting`'s declared row identity is enforced on the tenant and global layers — a runtime NULL-safe UNIQUE index over `COALESCE(user_id, '')` (#8629)

<!-- adr-0087: not-required (no-migration-prescription) Adds one runtime index
migration module and its exports to `@objectstack/metadata-protocol`, armed at
`kernel:ready`. No authorable metadata surface is added, renamed, retired or
tombstoned — `packages/spec` and the `sys_setting` declaration itself are
untouched, deliberately: expressing NULL-safe uniqueness in the declared
vocabulary is the deferred route-2 half. Nothing exists for `objectstack migrate
meta` to rewrite, and no author has to change any file. -->

`sys-setting.object.ts` declares the object's row identity as
`{ fields: ['namespace', 'key', 'scope', 'user_id'], unique: 'organization' }`,
and the object's own header calls that the row identity. It was not one.
`user_id` is NULL on every row that is not `scope='user'` — `SettingsService.set`
computes it as `scope === 'user' ? ctx.userId ?? null : null` — and SQL UNIQUE
treats NULLs as mutually distinct, so the constraint was **void on the `tenant`
and `global` limbs**: exactly the two carrying organization-level and
platform-level configuration.

Measured on a real engine, before this fix: two identical `scope='tenant'` rows
in ONE organization both landed (`201`, `201`), two identical `scope='global'`
platform defaults both landed, while the same rows with a non-NULL `user_id`
were refused — the control that identifies the mechanism as the NULL rather than
the `scope` value. `SettingsService` then resolves a layer with a positional
`rows.find(...)` and `set()` upserts against `{ namespace, key, scope, user_id }`,
so which value an organization got for a tenant-scoped key was unspecified and
two rows could disagree indefinitely with no way for an admin to see why the
effective value was not the one they set. `lifecycle.retention_overrides` is a
live tenant-scoped key, so this reached real retention behaviour.

The fix follows the paradigm that has shipped twice in this package
(`ensureOverlayIndex`, `ensureViewDefinitionActiveIndex`): at `kernel:ready` the
declared index is rebuilt in raw SQL with both nullable key parts folded —
`COALESCE(organization_id, '__global__')` (ADR-0120 D3's tenant form, unchanged
from what the driver already emits) and `COALESCE(user_id, '')` (the
`ensureOverlayIndex` spelling for a non-tenant nullable discriminator). Storage
is untouched: the row keeps its NULL, only the index folds it. The index reuses
the **declared name**, so the additive `syncDeclaredIndexes` — which skips by
name — never re-imposes the NULL-distinct form on a later boot, and the drift
reconciler leaves it alone because an index carrying a non-tenant expression key
part is not sync-reproducible.

**⚠️ Operator-visible: this is a TIGHTENING, and on an installation that has
already accumulated duplicate settings rows it will REFUSE to build the index.**
That is the intended behaviour, not a failure mode to work around. Those
duplicates exist precisely because the constraint has been void, and settings
rows are admin-authored configuration, so no row is discarded automatically and
no deterministic keep-one rule is applied. On refusal:

- **nothing is deleted, rewritten or reordered**, and the boot continues;
- the **previous index stays in place** — the tightening is proved buildable
  under a throwaway probe name before the declared name is ever dropped, so the
  table never spends a moment with no unique index at all;
- one `error` line names the key that is not enforced, the consequence (duplicate
  tenant-scope and global-scope rows can still be created, and `SettingsService`
  has no defined answer for which one wins), and ships the **exact query that
  lists the offending rows**, so the operator has the list from the boot log
  without waiting for `os migrate plan`;
- the migration keeps refusing on every boot until an operator decides which row
  survives, then converges on the next restart.

Two hosts are deliberately quiet rather than degraded: a kernel composed without
the optional `service-settings` has no `sys_setting` table at all, which is
probed for and is a silent no-op; and a MySQL/MariaDB server that rejects
functional key parts keeps the previous index and is told what is not enforced,
the same degradation `SqlDriver.createNullSafeUniqueIndex` already reports for
this class of event.
