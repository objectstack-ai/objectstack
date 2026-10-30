---
'@objectstack/plugin-approvals': patch
---

fix(plugin-approvals): an `expression` approver id that names no account no longer opens a slot no one can take

Clause-②: no
Metadata-protocol: none

#27397 (`user`) and #27752 (`field`, out-of-office delegate) made an approver id that no account carries expand to nobody. The third sibling now follows them: an `expression` approver resolved as users (`resolveAs: 'user'`, the default) keeps a slot for each id its expression yields only when an account carries it. An id no account carries logs the shared "expanded to nobody" warning, naming the id and the expression, and adds no slot, so a slate it leaves empty reaches the node's `onEmptyApprovers`. A failed directory read keeps the slot. A dead out-of-office delegate on an expression id routes back to that id, as it does for `user` and `field`.
