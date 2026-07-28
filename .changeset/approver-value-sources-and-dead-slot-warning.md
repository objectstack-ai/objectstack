---
"@objectstack/spec": minor
"@objectstack/plugin-approvals": patch
---

feat(spec)+fix(approvals): publish approver value data sources, order the type enum for authors, stop silent dead approver slots (#3508 / #3807 follow-ups)

Four follow-ups from browser-verifying the #3508 approver work end to end.

**`APPROVER_VALUE_SOURCES` — the designer stops guessing where candidates live.**
`xRef.map` only ever named a picker KIND (`'team'`), never where that picker's
rows come from, so the designer carried its own copy of the data contract — and
the first copy was wrong: every directory kind was wired to `GET
/api/v1/meta/:type`, the metadata REGISTRY, which does not hold `sys_user` /
`sys_team` / `sys_business_unit` / `sys_position` rows. Candidates came back
empty and the control degraded to free text (#3508). The binding is now
projected onto the published JSON schema as `xRef.sources` — `{ source: 'data',
object, valueField }` for the record-backed kinds, the closed enum inline for
`org_membership_level` — derived from `APPROVER_VALUE_BINDINGS` so the two
cannot drift, and inheriting its `satisfies` exhaustiveness (a new
`ApproverType` member that declares no source is a compile error). Presentation
— which field to show, whether to open a people-picker, what subtitle to use —
stays a renderer decision.

**`ApproverType` declaration order is now the authoring recommendation.**
objectui#2834 argued for leading with indirect bindings and shipped that order
in its own options array — which the Studio inspector never reads: it derives
the picker from this enum via the published schema, so `user` still came first.
The intent only takes effect if the enum carries it, so the enum now reads
`manager, position, department, team, field, expression, org_membership_level,
user` (deprecated `role` / `queue` still parse and stay out of every picker via
`xEnumDeprecated`). Binding one specific person is the least portable choice an
author can make — it breaks when the flow moves to another environment (that id
does not exist there) and again when that person leaves.

**A graph approver that expands to nobody no longer does it in silence.**
`queue` already warned (#3508); every OTHER graph type — `team`, `department`,
`position`, `org_membership_level`, `manager` — fell back to the same
unactionable `type:value` literal without a word. That silence is what let
#3807 hide for as long as it did: the request opened with an empty slate and
the first symptom was a permanently stuck approval (#3424). The fallback stays
(15.x slots and substring fixtures depend on it); it now logs the type, value
and organization that produced it. `user` / `field` stay quiet — they take the
id they were given and never had an "expanded to nobody" state.

**`plugin-sharing`'s identical org scope is pinned by tests.**
`BusinessUnitGraphService.orgScope` has the same strict `organization_id`
equality #3807 fixed in approvals. It is unreachable today — every materialized
`sys_sharing_rule` carries `organization_id = null`, so the filter is skipped —
and widening an authorization path on a defect that cannot currently fire is
not a change to make blind. New tests lock both the reachable paths and the
divergence itself, so if sharing ever adopts the null-org=env-wide reading it
is a deliberate edit to a named test rather than a silent behaviour change.
