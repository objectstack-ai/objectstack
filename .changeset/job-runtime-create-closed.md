---
"@objectstack/spec": major
---

feat(spec)!: `job` is a code artifact — runtime creation and org overrides are withdrawn (#4509)

A `job` metadata item created at runtime could never be scheduled. `JobSchema.handler`
names a function in the **compiled bundle's function table** — the schema says so
("must match a key in `defineStack({ functions })`") and the scheduler is built that
way: `AppPlugin` sources jobs from `bundle.jobs` alone and resolves each handler
through `collectBundleFunctions(bundle)`, skipping any job whose handler is not in
that table. Yet the type was registered `allowRuntimeCreate: true` (and
`allowOrgOverride: true`), so a job authored in Studio or through `PUT /meta` parsed,
saved, reported success — and never ran.

Unlike the sibling disconnects closed in this batch, this one **cannot be bridged**.
The runtime writer does not have the bundle and cannot name a function inside it; the
missing piece is a handler-binding design, not an ingestion path. Under ADR-0049
enforce-or-remove, the honest move is to close the door:

- `allowRuntimeCreate: false` — no "create job" in Studio or via `PUT /meta`.
- `allowOrgOverride: false` — no per-org job fork, which was unreachable for the same
  reason.

**`job` remains a first-class authorable type.** `*.job.ts` / `*.job.yml` /
`*.job.json` files and `defineStack({ jobs })` are the supported doors, and they are
fully enforced — every schedule shape, `retryPolicy`, `timeout` and `enabled` reach
the scheduler. The kind stays in the metadata registry because its file loader is
genuinely consumed (ADR-0088 admission test).

**If you were creating jobs at runtime:** move the definition into your stack
(`defineStack({ jobs, functions })`) so the handler resolves against a real function.
Rows already in `sys_metadata` are left untouched — they were never scheduled, so
nothing changes behaviorally; `migrateStoredMetadata` now reports them `skipped`, the
same way it does for `agent`.

Re-opening the type means constraining `handler` to something a runtime writer can
name — an already-registered flow, or a named and separately governed function — and
building the bridge to `IJobService.schedule`. Flipping the flag without that work
just restores the silent no-op.
