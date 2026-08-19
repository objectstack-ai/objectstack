---
"@objectstack/runtime": minor
---

feat(runtime): a flow ACTION that ran and failed now carries the flow author's `errorMessage` and the run `summary` in `error.details` at the `/actions` door (#9585)

Dispatching a flow through `POST /api/v1/actions/:object/:action` (a `type: 'flow'`
action — the documented way to expose a flow on a record page) answered `400
FLOW_FAILED` with only the raw engine error. The trigger door
(`POST /api/v1/automation/:name/trigger`) additionally ships two things in
`error.details` of the ADR-0112 envelope: `errorMessage` — the failure text the
flow's AUTHOR wrote for exactly this case (`flow.errorMessage`, the single field
the console reads, objectui `flowResponse.ts`) — and `summary`, the run's
per-node accounting that says WHICH node failed. At the action door the author's
text was declared-but-never-delivered.

Maintainer ruling (2026-08-19, Option B on #9585): `dispatchFlowAction` now
throws a typed refusal carrier (`FlowActionRefusal`) on the ran-and-failed row,
and the `/actions` handler recognises it ahead of its generic catch, serving
`errorMessage` and `summary` exactly as the trigger door does — same field
names, same source, pinned door-against-door so the two cannot drift apart
again. Bounded deliberately:

- the shared `resolveThrownHttpError` (`@objectstack/types`) stays untouched —
  its closed `details` list remains the rule for every other thrower; no
  general "any throw declares wire payload" widening;
- only the ran-and-failed row carries the artefacts — a never-dispatched
  refusal (404 / 409 `FLOW_DISABLED` / 422 `FLOW_NO_START_NODE`) has no run to
  report and ships neither, at both doors;
- a caller that does not recognise the carrier (the MCP `run_action` bridge)
  serves exactly the previous answer — the carrier stamps `status`, `code` and
  `message` identically to the plain throw it replaces;
- no new schema keys; both doors keep agreeing on `400 FLOW_FAILED`.
