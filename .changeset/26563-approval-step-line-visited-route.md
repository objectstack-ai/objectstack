---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(app-shell): the approval step line draws the route the request's run took, not the flow graph's first branch

Clause-②: no
Metadata-protocol: none

The approval step line used to draw the request's `flow_steps`. The approvals read builds that list by walking the flow from its start and taking the `approve` edge, else the `true` edge, else the first edge at every node. So a request that a decision routed down another branch showed rungs it never reaches. A contract routed from the manager to the finance-only rung read "manager · legal + finance (joint) · executive · general manager" while it waited on the finance controller.

What changes:

- On a business record's approvals panel, the line now shows the steps the pending request's flow run has passed, oldest first, then the pending step. Each step comes from a request the run actually opened: same flow run, another node, approved, and opened before the pending one. A step approved in several rounds is shown once. Nothing ahead of the pending step is shown, because no request row says which branch the run takes next.
- The approvals list serves a request only to its participants, so a step the viewer had no part in is left out rather than guessed. With fewer than two steps, no line is drawn.
- On the approval request page, the decision panel no longer draws a step line. Its row proves only its own step, which the page header already names. The line returns there once the approvals read serves the route the run takes.

What to do: nothing. Nothing a flow, page or object declares changes.
