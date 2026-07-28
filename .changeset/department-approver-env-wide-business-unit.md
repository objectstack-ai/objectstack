---
"@objectstack/plugin-approvals": patch
---

fix(approvals): a `department` approver resolves against env-wide business units (#3807)

`expandBusinessUnitUsers` scoped its `sys_business_unit` reads with a strict
`organization_id = <request org>` equality, so a unit whose `organization_id`
is `null` was invisible: the seed check found no row, the expansion returned
`[]`, and the approver fell back to the dead `department:<id>` literal that
routes to nobody.

That is the normal case, not an edge case. An app's org tree is seeded, and a
seed cannot know the organization id the runtime mints at boot, so every seeded
unit carries `organization_id = null` — while an approval request always
carries an org. Every business unit a flow author could pick therefore resolved
to nobody, silently: the request opens, the slate is empty, and (with
`lockRecord`) the record stays locked with no one able to act (#3424 is the
downstream shape of the same dead end). Verified against a live showcase stack:
a `{ type: 'department', value: 'bu_hq_finance' }` approver produced
`pending_approvers: "department:bu_hq_finance"` while the unit's member sat
right there in `sys_business_unit_member`.

Both the seed check and the subtree descent now scope to **this org ∪
env-wide** — `$or: [{ organization_id: <org> }, { organization_id: null }]` —
the same predicate `sys_metadata`'s pending-draft listing settled on for the
identical reason (a strict equality silently dropping env-wide rows). The wall
between two organizations is unchanged: another org's unit still fails the
match, and a null-org parent does not drag another org's child unit into the
subtree.

Note the same strict-equality scope exists in `plugin-sharing`'s
`BusinessUnitGraphService.orgScope`. It is not reachable today — every
materialized `sys_sharing_rule` row carries `organization_id = null`, so the
filter is skipped — and is left alone here rather than widen an
access-granting path on a defect that cannot currently fire.
