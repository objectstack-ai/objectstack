---
'@objectstack/spec': minor
---

feat(spec): an approval step's `excludeSubmitter` option, default off — declared ahead of the approval engine that honours it

Clause-②: yes (widening)
Metadata-protocol: added

An approval node's `config` accepts `excludeSubmitter: boolean`. Each approval step is an approval node, so this is the step-level option: when `true`, the request's submitter (the user whose action started the flow run, recorded on the approval request as `submitter_id`) is to be removed from the slate the node's `approvers` resolve to, whatever approver type produced them, so a manager who submits their own request cannot approve it. If that leaves nobody, the request takes the node's `onEmptyApprovers` route and never passes silently, and the approval record shows that the exclusion changed the route.

- **Declared, not yet honoured.** This release carries the protocol half only. The approval engine parses the key with the rest of the node config and does not read it yet, so the submitter is NOT removed today. The key's describe opens with `[PLANNED — not yet enforced]` and says so. Keep any guard you rely on (an `expression` approver or a validation rule) until the approval engine honours the key.
- **Off by default, and absent when off.** The key is optional with no default: a node that does not author it parses to exactly the output it did before, so stored approval nodes and the config snapshot each request keeps are unchanged.
- **Step-level only.** It is one switch per node. Written on an approver row, on the flow node beside `config`, or on the flow, it is still refused as an unknown key.
