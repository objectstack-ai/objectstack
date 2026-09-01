---
"@objectstack/plugin-security": patch
---

test(plugin-security): the managed-deny floor now sees the evaluator's first grant route — `allowTransfer` (#14137)

The independent-property floor that derives which seeded default permission
sets MUST be managed-deny targets ("a default set whose `'*'` wildcard grants
a write", pinned in `default-permission-sets.test.ts` and diffed against
`MANAGED_DENY_TARGET_SETS`, #14029) read only the three CRUD write flags plus
`modifyAllRecords`. That missed the evaluator's FIRST grant route — the
direct bit read off `OPERATION_TO_PERMISSION` (`transfer: 'allowTransfer'`),
a real grant ENFORCED today through the insert/update `owner_id` door (#3004).
A future default set shaped `'*': { allowRead: true, allowTransfer: true }`
would have held ownership reassignment on every `managedBy: 'better-auth'`
identity table while tripping neither floor clause, so it was never required
to become a managed-deny target and would have kept its wildcard silently.

The floor now also checks `wc.allowTransfer === true` (a value test, never
key-existence — Zod materialises these bits with `.default(false)`, so they
are present-as-false; #14129 first review), and both exhaustive docblocks
name the first route. Zero behaviour delta today: no existing seeded set
carries a transfer-granting wildcard, every existing set keeps its exact
verdict (pinned), and the runtime deny application is byte-identical — this
hardens a CI-time pin, not the shipped permission surface.
