---
"@objectstack/plugin-sharing": patch
---

fix(plugin-sharing): the `business_unit` sharing-rule recipient expands exactly one unit, not its whole subtree (#7807)

⚠️ **This is an intentional over-grant fix, and it REDUCES visible rows for any
deployment that authored `business_unit` sharing rules.** Read the migration note
below before upgrading if you use that recipient kind.

## What was wrong

The two business-unit recipient kinds were **declared** as two different widths
and **enforced** as the same width. `SharingRuleService.expandRecipient` routed
both through the identical `BusinessUnitGraphService.expandUsers` call, whose
first act is a BFS over `parent_business_unit_id` — so the two branches differed
only in their comments.

A rule authored as `recipient_type: 'business_unit'`, which the authoring spec
(`ShareRecipientType`), the org-axis lint red-line table and ADR-0057 D5 all
describe as *"exactly one business unit's members (no subtree)"*, in fact reached
that unit **plus every descendant unit's members**. On a three-level tree a rule
anchored at a division silently granted to every department and office beneath
it.

Two consequences, and the second is why this is filed as security rather than
tidiness: the narrow spelling over-granted **silently**, which is the worst
failure shape for generated security metadata (an agent that asks for the narrow
grant should get the narrow grant); and `unit_and_subordinates`, documented as
the *strictly wider* grant of the pair, was not wider at all, leaving the
distinction the lint red-line draws unenforceable in practice.

## What changed

`business_unit` now resolves through a new
`BusinessUnitGraphService.expandUnitMembers()` — members whose
`business_unit_id` equals the named unit, with no descent. It keeps every other
guarantee the subtree walk had: an inactive or out-of-tenant anchor unit
contributes nobody, and an unreadable unit fails closed rather than granting.

`unit_and_subordinates` is **unchanged** and keeps the subtree walk — it is the
kind whose declared semantics *is* the hierarchy widening (ADR-0057 D5). The two
kinds remain two kinds; neither is merged into the other or retired.
`expandUsers()` also keeps its meaning for the `bu:` approver prefix and org
rollups, which are subtree consumers by contract.

Grant recomputation on business-unit graph writes (#7729) still covers both
recipient kinds, because a unit-only expansion still reads `sys_business_unit`
for its anchor's `active` flag and tenant scope and `sys_business_unit_member`
for its members. What changed there is blast radius, not coverage: re-parenting a
unit no longer moves a `business_unit` rule's recipients, while deactivating the
anchor or editing its membership still does.

## Migration

**In-tree cost is zero** — no shipped example app or seeded rule authors
`business_unit` (the showcase and CRM apps use `position` and
`unit_and_subordinates`), so nothing in this repository changes behaviour.

**Out-of-tree deployments:** if you authored a `business_unit` rule and were
relying — knowingly or not — on it reaching descendant units, those descendant
members **lose the grants that rule materialised**. Grants are reconciled on the
next evaluation pass, so the reduction lands without any action on your part.

If the subtree reach was what you actually wanted, change the rule's recipient to
`unit_and_subordinates`, which has always meant exactly that and is unaffected by
this release. If you wanted the narrow grant, you now have it.
