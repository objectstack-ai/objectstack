---
"@objectstack/spec": minor
---

feat(spec): `ShareRecipientType` gains `field` — a sharing rule can share each matched record with the user or users a field on that record names (#14103)

Maintainer ruling 2026-09-02 (B): a criteria sharing rule may now be authored as
`sharedWith: { type: 'field', value: 'assignees' }`, where `value` is the snake_case
name of a user-typed field on the shared object. Each record the rule's `condition`
matches is shared with the user or users that column holds on that record; a field
with `multiple: true` shares with every user it names; an empty column shares with
nobody (fail-closed). Unlike every other recipient, which resolves once per rule,
a `field` recipient expands once per matched record, and its grants re-materialise
when the record's own write changes that column.

There is deliberately **no `manager` member**. "Share with the owner's manager" is
authored as a user field the application stores on the record (a snapshot or kept
in sync — the application's explicit choice) plus a `field` recipient naming it. A
`manager` member would walk `sys_user.manager_id` from the record and re-introduce
the graph-change re-materialisation obligation that once removed the `owner`
recipient type; with `field` the recipient stays visible on the record.

What this release ships is the **contract**: the enum member, the `sharedWith`
describe text, a `field`-scoped refinement on `value` (an empty name or a dotted
path such as `owner.manager_id` is refused at parse — a field name, never a graph
walk), the stored-row mirror `SharingRuleRecipientType` in `contracts/sharing-service.ts`
widened in step, and the generated JSON schema / authorable surface / reference
docs. The per-record executor (`plugin-sharing` `expandRecipient`, the
`sys_sharing_rule.recipient_type` select, re-materialisation on the record's own
update) is the services half, #15072; until it lands the declared-rule bootstrap
skips a `field` rule with a logged warning rather than seeding it.

Accept-set widening only: every sharing rule that parsed before parses
identically — the refinement is scoped to `type: 'field'`, and the other members'
`value` stays the opaque string it was.
