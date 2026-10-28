---
'@objectstack/spec': patch
'@objectstack/plugin-approvals': patch
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

feat(spec,plugin-approvals,app-shell): the approvals get serves a request's own route, and both approval step lines draw it

Clause-②: yes (widening)
Metadata-protocol: none

The single request read (`GET /api/v1/approvals/requests/:id`) served one step list, `flow_steps`: the flow's trunk, walked from its start by taking the `approve` edge, else the `true` edge, else the first edge. A request a decision routed off the trunk was not on it. A contract routed from the manager to the finance-only rung was served the manager, the joint legal + finance rung, the executive and the general manager, all upcoming, and not its own rung.

What changes:

- `ApprovalRequestRow` gains `flow_route`, served on the same single reads as `flow_steps`. Its `steps` are the approval steps the request's flow run has passed (earlier requests of the same run, on another node, approved, in the order the run opened them, one entry per step), then the request's own step, then, for a pending request, the steps ahead that the flow's graph decides on its own when each step approves.
- Nothing past an undecided branch is listed. The walk ahead stops at a decision node, a conditioned edge, several out-edges, a loop back, or a node that runs other nodes (`subflow`, `map`, `loop`). `ahead` then reads `undecided`. It reads `end` when the walk reached the flow's end, and `decided` for a request that is already decided, whose route ends at itself.
- `flow_steps` is served unchanged. Its doc now says it is the trunk and that a step line never draws it.
- The business record's approvals panel draws the pending request's `flow_route`, so a viewer who took no part in an earlier rung now sees it too. Before, the panel rebuilt the line from the request rows the list read served that viewer.
- The approval request page draws its request's `flow_route`, at any status, where it had stopped drawing a step line at all.

What to do: nothing. A client that reads `flow_steps` reads what it read before. A client that draws a request's progress should draw `flow_route` instead.
