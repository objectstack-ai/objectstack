---
'@objectstack/plugin-approvals': patch
---

fix(plugin-approvals): a `field` approver id, or an out-of-office delegate, that names no account no longer opens a slot no one can take

Clause-②: no
Metadata-protocol: none

#27397 made a `{ type: 'user' }` approver that names no account expand to nobody. Its two siblings now follow it:

- **`type: 'field'`.** Each id the record field holds is a slot only when an account carries it (the same predicate the reassign door asks, with no organization). An id no account carries logs the shared "expanded to nobody" warning, naming the field and the id, and adds no slot, so a slate it leaves empty reaches the node's `onEmptyApprovers`. A failed directory read keeps the slot.
- **Out-of-office delegation.** A delegation chain that ends on a delegate no account carries routes the slot back to the original approver, with an "expanded to nobody" warning naming both. It never empties the slate, and no `ooo_substitute` action or notification is recorded for it. A failed read keeps the delegate. A removed delegator whose delegate is live still routes to the delegate, as before.
