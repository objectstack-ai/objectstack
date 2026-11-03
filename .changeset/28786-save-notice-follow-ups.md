---
'@objectstack/spec': patch
'@objectstack/lint': patch
---

fix: the `save_notice` placement refusal names an array `triggerType`, and the flow lint classifies `save_notice` (#28786)

Clause-②: no
Metadata-protocol: none

Follow-ups to #28251. The verdicts do not change: what was refused is still refused, and what was accepted is still accepted.

- **Spec: the array trigger form is named.** A flow whose start writes `triggerType` as an array (`['record-after-create', 'record-after-update']`) was refused at parse with "this flow's start has no record trigger", which misnames the shape. The refusal now quotes the array, says that form is not supported and never binds, and tells the author to give the start node one trigger type (`'record-after-write'` fires on both a create and an update).
- **Lint: `save_notice` joins the node-type lists.** The executor never reads `condition`, so a `condition` written on a `save_notice` node now draws the inert-condition finding, as it does for the other builtins that ignore it. The node can also fail at run time on data alone (a leg resumed after a suspension, a subflow or map child, or a message whose every hole rendered empty), so it is now counted with the other fallible builtins: one in a loop body with no `try_catch` around it draws the uncontained-loop-body warning (`flow-loop-body-uncontained`).
