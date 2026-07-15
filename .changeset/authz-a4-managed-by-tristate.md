---
"@objectstack/plugin-security": minor
---

feat(plugin-security): A4 — managed_by tri-state unification + listView exposure (#2920)

Unifies the record-level provenance vocabulary across the three RBAC catalogs
(`sys_capability`, `sys_permission_set`, `sys_position`) onto a single tri-state
— **platform / package / admin** — so an administrator reads one vocabulary for
"who owns this" everywhere.

- **`sys_permission_set.managed_by`** and **`sys_position.managed_by`** converted
  from free `text` to a constrained `select` matching `sys_capability` (options
  `platform` / `package` / `admin`, `defaultValue: 'admin'`, `readonly`).
- **Writers re-stamped to canonical vocab:** built-in identity/anchor positions
  now seed `managed_by: 'platform'` (was `'system'`); env/Studio-authored
  permission sets project as `managed_by: 'admin'` (was `'user'`). Declared
  package sets (`'package'`) and platform capabilities (`'platform'`) were
  already canonical.
- **`sys_position` list views** (`active` / `default_positions` / `custom` /
  `all_positions`) now surface the `managed_by` column, matching the capability
  and permission-set views.
- **Back-compat, no destructive migration.** No runtime path branches on the
  legacy values — every access decision keys on `'package'` / `'platform'`
  (both unchanged) — so the rename never changes an authorization outcome.
  Built-in positions and declared sets self-heal on their next bootstrap upsert;
  a new idempotent `kernel:ready` reconciler (`normalizeManagedByVocab`) rewrites
  the residual legacy values (`system`→`platform`, `config`→`package`,
  `user`→`admin`) on existing `sys_position` / `sys_permission_set` rows.
- **i18n:** `managed_by` field + option labels (`platform` / `package` / `admin`)
  added for `sys_capability` / `sys_permission_set` / `sys_position` across
  en / zh-CN / ja-JP / es-ES.

Pairs with objectui `feat(app-shell): A4 — provenance tri-state badge`
(framework#2920).
