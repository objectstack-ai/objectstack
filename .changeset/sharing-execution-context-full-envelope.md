---
"@objectstack/spec": minor
---

feat(spec): sharing / approval / report enforcement takes the full `ExecutionContext`; the six-field context is migration residue (#6523, #6206 ruling default)

`ISharingService`, `ISharingRuleService`, `IApprovalService` and
`IReportService` now declare their context parameter as the complete
`ExecutionContext` envelope instead of the six-field
`SharingExecutionContext` — 36 signatures across the three contract files.
Every one of those methods ADJUDICATES access (the read-filter contribution,
both write gates and their tri-state forms, share management, rule definition
and evaluation, approval decisions and recalls, report runs and schedules), so
each needs the whole `resolveAuthzContext` result: `accessible_org_ids` (the
`group`-posture Layer 0 wall, ADR-0105 D2), `org_user_ids`, `systemPermissions`,
`posture` (ADR-0095 D2 — resolved once, carried, never re-derived at the
enforcement site) and `tabPermissions` included.

`SharingExecutionContext` was the fourth and widest twin of the family #6206
ruled on (converge to the full envelope, keep no per-site subset contracts);
that ruling's sweep had reached only the share-link site (#6430).

The damage ran in the MIRROR direction of the share-link case, which is worth
stating because it is the direction a reviewer does not expect. Nothing here
trimmed a value: `plugin-sharing`'s engine middleware passes its whole
execution context down (`buildReadFilter(ctx.object, exec ?? {})`), so the
values always arrived complete. It was the declared TYPE that was narrow, so
the receiving implementation could not read what it had been handed without
casting out of its own contract — measurably, `plugin-approvals`'
privileged-override gate reaching for the resolved posture as
`(context as any).posture`.

`SharingExecutionContext` is retained and unchanged in shape, now documented as
migration residue: nothing in `packages/spec` takes it any more, and the three
plugin implementations that still annotate their own parameters with it are the
consumer half, separated exactly as #6430's contract and plugin halves were.
Widening it field by field is explicitly refused — that would rebuild the
per-site subset the ruling removed.

Contract-only, no runtime behaviour change and no acceptance-surface change
(these are TypeScript interfaces, not Zod schemas — nothing authorable moves).
Existing implementations keep compiling: the two types are mutually assignable
(all fields optional, all six present in the wider type), so neither direction
of the parameter change breaks them.
