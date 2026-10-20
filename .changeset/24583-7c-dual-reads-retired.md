---
'@objectstack/plugin-webhooks': minor
'@objectstack/platform-objects': minor
---

refactor(plugin-webhooks,platform-objects)!: 18.x step 7c retires the dual reads steps 1–2 added for 18.0 databases. Any `sys_webhook` row that holds a declared webhook's name now answers as itself. `sys_setting_audit.scope` no longer declares `global`.

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No key of any metadata schema is removed, renamed or re-shaped, and no public export, type or error code is removed or renamed. Two things narrow at run time. The dispatcher no longer skips a pristine seeded webhook row in favour of its declaration (an internal reader, never exported). A stored select value is refused on one platform object. Both apply only to rows the v18 ownership ceremony settles or moves before a database is certified, and the v18 boot guard refuses a database it has not certified. -->

**BREAKING** narrowing, shipped as `minor` under the launch-window convention for breaking changes (ADR-0087, the ratified pre-launch launch-window section; the decisions retired here are ADR-0131 D2, D6 and D7). The 18.x upgrade ceremony settles every row these readers existed for before a database is certified, so a certified database and a fresh install read the same either way.

- **Declared webhooks (plugin-webhooks).** Before: a `sys_webhook` row seeded by the 18.0 seeder under a declared name, and never edited (`managed_by` `package`/`platform`, not `customized`), was skipped as a "mirror". The declaration answered in its place, for dispatch and for redelivery. Now: any row holding a declared name answers as itself and the declaration is withheld, reported once per name (regime C). The ceremony (step 5a) deletes or settles every such copy, so on a certified database this changes one case only. A seeded row the ceremony kept, because no package declared its name then, now withholds a declaration of that name added later, where before it was skipped. **Remedy:** rename or delete that row, and the declaration answers. The provenance stamp (`customized`) stays: the ceremony still reads it when a superseding reviewed plan re-runs the ceremony from the start.
- **Settings audit (platform-objects).** Before: `sys_setting_audit.scope` declared `global`, `tenant` and `user`, and a reader of the global rung's history read both `sys_setting_audit` and `sys_platform_setting_audit`. Now: `sys_setting_audit.scope` declares `tenant` and `user` only, and an insert with `scope: 'global'` is refused (`VALIDATION_FAILED` on `scope`). The global rung's history is `sys_platform_setting_audit` alone. The settings service already wrote global-rung rows there, and the ceremony (step 5b) moves every 18.0 row. **Remedy:** none for a certified database. A script that wrote audit rows by hand writes global-scope rows to `sys_platform_setting_audit`.
- **Unchanged.** Identity mail: only docblocks change. The tenant mail log keeps its body read gate, and a mail job with no object still reads `sys_email`, because a tenant mail row an 18.0 process queued stays there.
