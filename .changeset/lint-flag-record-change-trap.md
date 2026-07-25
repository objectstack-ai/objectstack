---
"@objectstack/lint": patch
---

fix(lint): flag every never-firing `record-`-prefixed trigger token, incl. `record-change` (#3427)

Generalizes the `flow-trigger-unknown-event` rule: it now flags ANY `record-`-prefixed
`triggerType` that is not a valid firing token
(`record-{before,after}-{create,insert,update,delete,write}`) — not just
`record-(before|after)-<bad-op>` typos. This closes the `record-change` trap: the
engine routes `record-change` ("Record changed (any)") to the record-change trigger,
which maps it to no hook so it never fires — now caught at `os validate` time instead
of only a runtime warn. Also covers bad-phase tokens like `record-during-update`.
Warning severity, unchanged.
