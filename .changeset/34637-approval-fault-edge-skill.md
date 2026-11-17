---
'@objectstack/skills': patch
---

docs(skills): `objectstack-automation` teaches the `fault` edge on a write after an approval decision, and what `RESUME_FAILED` carries without one

Clause-②: no
Metadata-protocol: none

`references/state-machines-and-approvals.md` § Branching, side-effects & rejection gains one bullet. When a step on the `approve` / `reject` branch writes a record that a record hook, a validation rule or a permission may refuse, the flow draws a `fault` edge from that step to a handler: the refusal takes that edge and the decision answers normally. Without the edge `POST …/approve` (or `/reject`) answers `500 RESUME_FAILED`: the decision stands (`finalized: true`), the run is stranded, and the body carries `innerRefusal` (`{ code, message }`) and the hook's declared `userMessage`. One eval case covers it.

Paid in place, the token ceiling does not move. Four restatements were cut, each keeping another home: the send-back section's text diagram (the paragraph above it and the snippet below it trace the same path), and three bullets of § Branching: "Conditional step" (the discount-approval example's `needs_director` node and the comment on its `e1` edge), the send-back pointer (the section it pointed to), and "Hard reject" (the examples' `reject` edges into an `end` node).
