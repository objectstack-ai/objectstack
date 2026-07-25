---
"@objectstack/spec": patch
"@objectstack/objectql": patch
"@objectstack/driver-sql": patch
"@objectstack/rest": patch
---

feat(rest): `treatAsHistorical` import also preserves the original audit timeline (#3493)

Follow-up to #3479/#3483. `treatAsHistorical` solved the FSM half — mid-lifecycle
rows are no longer rejected by `initialStates` — but the OTHER half of a historical
migration, preserving the original timeline, still didn't hold: an imported ticket
that closed in 2021 stored `updated_at` = the import day (and `updated_by` = the
importer), and a `writeMode: 'upsert'` refresh silently dropped business `readonly`
fields (`closed_at`, `resolved_by`). Reports, audit, and "recently modified"
sorting all came out wrong.

Three layers were force-overwriting the timeline; all three now respect a single
new opt-in flag, `ExecutionContext.preserveAudit`, which `treatAsHistorical` sets
alongside `skipStateMachine`:

- **spec**: `ExecutionContext.preserveAudit` (server-set only, never client-supplied)
  and `DriverOptions.preserveAudit` (threaded to the driver's update stamp).
- **objectql** — the built-in audit hook (`plugin.ts`) now treats `updated_at` /
  `updated_by` as CLIENT-PREFERRED (`?? now` / `?? userId`) under `preserveAudit`,
  symmetric with how `created_at` / `created_by` already behave on insert; and the
  static-`readonly` write strip (`stripReadonlyFields`) admits a WHITELIST — the
  audit/timestamp family plus author-declared business `readonly` fields — so an
  upsert refresh no longer drops them.
- **driver-sql** — the SQL `update` path keeps a supplied `updated_at` instead of
  force-advancing it to `now` when `DriverOptions.preserveAudit` is set (fills-only-
  empty, mirroring the insert stamp).
- **rest** — the import runner sets `preserveAudit` on the write context iff the
  request opts into `treatAsHistorical`.

Deliberately a WHITELIST, not the blanket `isSystem` exemption: platform-managed
`system` columns OUTSIDE the audit family (`organization_id` / tenancy, generated
columns) STAY stripped, so a historical import reinstates established facts without
becoming a backdoor to forge tenancy. Permissions / RLS / field-level security are
unaffected — this changes only which audit/readonly values the runtime overwrites,
never who may write the record. Fully opt-in: a normal write still auto-stamps
`updated_at`/`updated_by` and strips `readonly` exactly as before. The objectui
"Import as historical data" checkbox (objectui#2815) now drives both halves — no new
UI.
