---
"@objectstack/plugin-audit": minor
"@objectstack/spec": minor
"@objectstack/service-analytics": patch
---

refactor(plugin-audit)!: retire `export` and `permission_change` from the `sys_audit_log` action enum — two declared actions nothing has ever written (#8147, #7675, ADR-0049/ADR-0087)

<!-- adr-0087: registered audit-log-action-enum-retired -->

**BREAKING** (shipped as `minor` under the launch-window lockstep convention).

`sys_audit_log.action` declared ten actions. Two of them named events this
platform does not record, and has never recorded. Enumerating every
`sys_audit_log` writer in the repo finds exactly two:

- `plugin-audit/src/audit-writers.ts` — the generic hook writer, whose
  `actionFor()` maps `afterInsert`/`afterUpdate`/`afterDelete` to
  `create`/`update`/`delete` and **nothing else**;
- `plugin-auth/src/admin-import-users.ts` — the admin user-import run-level row.

Neither has ever emitted `export` or `permission_change`. The cost was not a
dormant string: `sys_audit_log` ships **list views** filtered on those values and
the platform dashboard ships **metric widgets** counting them, so an operator got
a permanently empty "Permission Changes" tile and an Auth view whose filter could
never match, while an auditor reading the enum believed the platform captured
permission changes and data exports. That is false compliance on a compliance
surface — the sharpest form of ADR-0049 declared-≠-enforced.

Maintainer ruling 2026-08-12 (#7675) split the finding in two: build the cheap
writers (`login`/`logout` in #8144, `config_change` in #8145) and retire the enum
values with no feature behind them. 原则记录:空 widget + 永远查不到东西的过滤器
是可见产品缺陷;审计面宁窄勿谎。

### Migration: FROM → TO

| Wrote | Write instead |
|:--|:--|
| a filter, saved query or dashboard on `action = 'permission_change'` | filter the permission objects' own `create` / `update` rows by `object_name` — a grant or binding write is an ordinary record write and the generic writer already ledgers it |
| a filter, saved query or dashboard on `action = 'export'` | delete it — no export feature ever wrote an audit row, so it returned nothing on every deployment |
| a `switch` / badge map with arms for either value | delete those arms; an exhaustive `switch` over the action type now fails to compile if they stay |

Every such query returned an empty result set before this change and returns the
same empty result set after it. What changed is that the contract stops promising
otherwise.

⚠️ **Existing rows are untouched and must stay untouched.** The enum is not
enforced on this object — `validateRecord` skips `readonly` fields and every
`sys_audit_log` field is `readonly: true` — so stored history parses and reads
back exactly as written. Audit history is append-only; do not migrate or delete
rows to satisfy a schema narrowing.

### Also in this change

- `auth_events` list view: filter narrowed to `['login', 'logout']`.
- `config_changes` list view: `export` dropped from the filter.
- `plugin-audit`'s generated translation bundles regenerated for all four locales.
- ADR-0087 registration as the semantic migration `audit-log-action-enum-retired`
  (D3 step 17). An enum-VALUE retirement, so nothing lands in
  `RETIRED_KEYS_BY_MAJOR` and the four surface ratchets are byte-identical by
  construction — no authorable key and no def changed.

### `import` is deliberately NOT retired

The 2026-08-12 ruling named `import` alongside the other two on the stated
premise 无此 feature. That premise is measurably false and the value stays:
`plugin-auth`'s admin user-import writes a real run-level row on every run
(`action: 'import'`, `record_id: null`), pinned by case W4 of
`packages/qa/dogfood/test/admin-identity-audit-trail.dogfood.test.ts`. Retiring
it would make the enum deny a value the platform writes — and silently, since
the enum is unenforced here. Referred back for a maintainer ruling on #8147.
