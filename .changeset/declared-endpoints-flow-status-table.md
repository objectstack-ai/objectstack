---
"@objectstack/runtime": minor
---

fix(runtime): a declared `type: 'flow'` endpoint answers the #9378 flow-dispatch status table, from the one shared definition (#9462)

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable
changes: no spec schema, no metadata key, no stored `sys_metadata` shape. The
change is which HTTP status and `error.code` one transport seam writes for a
flow dispatch that was refused or failed, so `objectstack migrate meta` has
nothing it could rewrite and there is no conversion-layer entry to register. The
existing declaration for such an endpoint is byte-for-byte valid before and
after. -->

**BREAKING** for any caller that reads a declared endpoint's flow result out of
the response body instead of the HTTP status.

`POST /api/v1/apps/<namespace>/<subpath>` with `type: 'flow'` used to answer
`200` for every outcome, with the raw engine result in `data` — so a flow that
was disabled, had no start node, could not be found, or ran and was rejected all
reached the caller as `{"success":true,"data":{"success":false,…}}`. That is the
double envelope #3962 removed from `POST /api/v1/actions/:object/:action`, and
it was still standing on the surface an app publishes as its own public API: a
client branching on the HTTP status read every one of those failures as a
success.

It now answers the same four rows the other two flow doors answer, read from the
one shared definition in `packages/runtime/src/flow-dispatch-status.ts` rather
than from a third private copy of the rule:

| engine exit | reality | the endpoint answers |
|:---|:---|:---|
| flow not found | never dispatched | `404` |
| flow disabled | never dispatched | `409` `FLOW_DISABLED` |
| flow has no start node | never dispatched | `422` `FLOW_NO_START_NODE` |
| ran and was rejected | ran, rejected | `400` `FLOW_FAILED` |

What a caller sees differently:

- **A failed or refused flow is now a 4xx.** The body is the platform's declared
  error envelope, `{"success":false,"error":{"code","message","httpStatus"}}`;
  there is no inner `data.success` left to read. A caller that already branched
  on the status now sees the failure it was previously told was a success; a
  caller that branched on `data.success` gets the same fact from `error.code`.
- **A `400` carries the run's own artefacts** in `error.details`
  (`errorMessage`, `summary`), exactly as `POST /api/v1/automation/:name/trigger`
  carries them. The three never-dispatched rows carry neither, because no run
  happened to describe.
- **A successful run is unchanged** — still `200` with the result in `data`.
- **An `outputMapping` declaration is no longer applied to a failure.** The
  projection was already restricted to answers with a status below 400, so the
  refusal rows fall outside it by the rule that was already written. This closes
  a real hole: an `outputMapping` used to be applied to the `200`-wrapped failure
  body and could present a refused dispatch as data.
- Both policy behaviours keyed on the same test move with it: `cacheTtl`'s
  `Cache-Control` no longer rides a flow failure, and the `rateLimit` /
  `authRequired` chain is untouched — it runs before execution either way.

This is the third and last door of the #9446 ruling (maintainer, 2026-08-18,
verbatim 「同意」: the status table is a property of the flow-dispatch CONTRACT,
not of the trigger route). All three doors now read one definition, and the
suite asserts that by driving the same engine result through all three and
comparing.
