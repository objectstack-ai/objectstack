---
'@objectstack/example-showcase': patch
---

showcase: stop the Invoice Dual Sign-off approval demo stranding its flow run

`showcase_invoice_signoff`'s `notify_cleared` node addressed `{record.account.owner}`
while its `start` node declared no `config.expand`, so the hop read a scalar foreign key
and resolved to nothing. The notify node refuses a run with no recipients, so approving
the showcase's marquee approval demo recorded the decision and then stranded the flow
run — the "Notify: Cleared" inbox message never arrived.

The hop was unfixable as written: `showcase_account` has no `owner` field, so hydrating
the relation would not have helped. The notice now addresses `showcase_invoice.owner`
(the seeded rep, and the object's own row-level-security anchor), while the start node
declares `expand: ['account']` and the message body reads `{record.account.name}` — so
the demo still teaches the relation-hydration path, with a field the account really has.

The same resume-time pattern is fixed in `showcase_task_done_notify_owner`, which hopped
`{record.project.owner}` into a subflow's notify with no `expand` on its start node.
