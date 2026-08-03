---
---

Docs-only: bring the v17 platform release page (`content/docs/releases/v17.mdx`)
up to date for the **17.0.0-rc.2** cut — the layer-3 "big picture" the
releases-maintenance playbook compiles centrally at release time, sourced from
the 209 changesets the window left pending since the `rc.1` version commit (46
`major`-class, 74 `minor`, 55 `patch`, 34 releasing nothing) and the
`.objectui-sha` pin, which is unchanged at `785b8a5d432c`.

Adds a **Landed since 17.0.0-rc.1** section covering the window: the #4535
dual-source convergence closing all seventeen clusters (C1–C17) plus #4537 /
#4538 / #4539 and the #4446 symbol-identity ratchet; #4001's final batches
closing the authorable surface; the ADR-0049 enforce-or-remove sweep reaching
the driver, datasource and service contracts (`DriverCapabilities`,
`findStream`, `IDataEngine.batch`, the four datasource blocks, `openApi31`,
`activationEvents`, the standalone `validation` kind, the `job` runtime door,
`sys_comment.visibility`); the ADR-0078 completeness gate with its Phase 4
runtime twin and the #4463 runtime authoring gate; ADR-0119 atomicity and the
migration journal with ADR-0118's actor contract; the protocol/wire and
authoring behaviour changes (batch row shape, hook and validation predicate
semantics, `script` nodes, datasource routing); the security corrections
(`sys_comment` record-level access, the `areas[]` navigation gate, the two
fail-open area gates, unscoped attachment deletes, analytics scoping, sharing
withdrawal, OTP hardening); and the new backend capabilities (bulk data event
contract, client-react bulk hooks, blueprint formula/roll-up declarations,
analytics correctness).

Extends the upgrade checklist with the rc.2 migrations (spec import-path and
rename table, datasource and driver cleanups, bulk/batch `atomic` semantics,
hook and validation predicate behaviour, `script` nodes, standalone validation
artifacts, jobs, `managedBy: 'system-data'`, app areas, comments,
`getSuspendedScreen`, runtime metadata writes, and the new completeness
errors), adds two release highlights, and records the window's ADRs and issues
in References.

Releases nothing.
