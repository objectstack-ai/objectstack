---
"@objectstack/plugin-approvals": patch
---

**Ops:** a one-off, idempotent backfill for the platform rows the pre-#10101 writers stranded with no organization — dry run first (#11308).

#10101 fixed the WRITERS: a `sys_approval_request` and a `sys_automation_run` are now stamped from the SUBJECT record's organization, with the acting context as the ruled fallback. It wrote nothing to existing rows, so the population produced before it persists — a **pending** org-less approval request LOCKS the record it is about while being invisible in every organization-scoped inbox, its own owner's included, and automation-run history stays unattributed. This is the repair for those rows, on the maintainer's 2026-08-23 ruling (direction 3).

`packages/plugins/plugin-approvals/src/backfill-platform-row-organizations.ts` sweeps `sys_approval_request` (with its `sys_approval_action` / `sys_approval_approver` children, which move with their request) and `sys_automation_run`. It scans only rows whose organization column is unset, re-reads each row's subject at repair time — live record first, the write-time snapshot (`payload_json` / `context_json`'s `record`) second for a subject that has since been deleted — and stamps the platform row with the subject's own organization.

**Dry run first, and by default.** `planPlatformRowOrganizationBackfill(engine)` reads only and returns a per-object report naming every row it would touch; `runPlatformRowOrganizationBackfill(engine, { dryRun: false })` writes. Nothing runs at boot and nothing is scheduled: this is an operator-invoked module, run once against an affected install.

**Rows whose subject is equally org-less are counted and named, never written.** The acting-context fallback the writers apply is not available to a repair — the acting context is gone — and inventing one stays vetoed. Those ids are reported so the population is checkable and stays visible.

**`sys_api_key`'s divergence is preserved, not flattened.** Both the column read on a subject and the column written on a platform row are resolved from the registered schema through the shared `createRecordOrganizationResolver` (`@objectstack/metadata-core`), so a platform row ABOUT an API key is repaired from that object's stamp-only `active_organization_id` (limb 0, #8778) and the credential table itself is never written to.

**Idempotent, and asserted rather than claimed.** Every scan is `WHERE <organization column> IS NULL` and every write fills that column, so a repaired row cannot match again; the test suite runs the sweep twice and pins the second run at zero writes.

Publishes no runtime code: the module is not exported from the package index and not bundled into `dist` (`tsup` builds `src/index.ts`). It is graded rather than skipped because the release notes are where an operator of an affected install learns the repair exists, what it will and will not touch, and that the dry run comes first.
