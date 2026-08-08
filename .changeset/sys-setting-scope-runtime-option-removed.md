---
"@objectstack/platform-objects": patch
---

fix(platform-objects): `sys_setting.scope` drops the never-implemented `runtime` option (#6036)

The `scope` select declared four cascade layers while the platform only ever had
three. `SpecifierScopeSchema` (`packages/spec/src/system/settings-manifest.zod.ts`)
is `z.enum(['global', 'tenant', 'user'])`, `SettingsService` never mentions the
string `'runtime'` anywhere, and its `scopeRank()` switch handles only those same
three — so no code path could write such a row and none could read one back. The
sibling audit object `sys_setting_audit.scope` already declared only three. This
was a declared-but-unenforced value domain of the ADR-0049 kind: nobody could hit
it, but the next reader of the object definition would reasonably conclude the
platform supports a fourth scope layer.

Removed rather than implemented — there is no runtime-scope product intent, and
the spec enum stays the reference truth for what the cascade's layers are. A new
pin (`sys-setting.scope-options.test.ts`) compares the object's option list
against `SpecifierScopeSchema` directly, so a future divergence in either
direction lands as a red test instead of a second silent one.

Removal was gated on a measurement, not on the zero-write-path prediction: a real
engine booted over the platform objects, driven through the real
`/api/settings/:namespace` write path, stored 4 rows (`tenant` 3, `global` 1) and
**0** with `scope='runtime'` — with a positive control proving the query does
surface such a row when one is injected directly.

No stored data is affected and no consumer read the option, so this is a
definition-only correction.
