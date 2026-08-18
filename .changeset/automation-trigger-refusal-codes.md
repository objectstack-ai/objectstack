---
'@objectstack/spec': minor
'@objectstack/service-automation': minor
'@objectstack/runtime': minor
'@objectstack/client': minor
---

**BREAKING** — the automation `trigger` routes now answer **409** for a disabled
flow and **422** for a flow whose definition has no start node, instead of HTTP
200 wrapping an inner `{success: false}`.

This finishes the migration the previous release started. That changeset flipped
two of the four outcomes and said of the other two:

> **Also unchanged, pending a ruling:** a DISABLED flow and one with no start
> node still answer 200 with the inner failure. Both are exits that never
> dispatched anything, and telling them apart needs a producer-side
> classification the closed `AutomationResult.code` union cannot yet express.

That is the paragraph this change resolves. The union was widened deliberately —
two new members, with measured need — rather than the transport guessing from
message text or re-implementing the engine's enable-state policy.

`POST /api/v1/automation/:name/trigger` and the legacy
`POST /api/v1/automation/trigger/:name` now answer, in full:

| Status | `error.code` | The run |
|:---|:---|:---|
| `404` | — | never dispatched: no such flow |
| `409` | `FLOW_DISABLED` | never dispatched: the flow is switched off |
| `422` | `FLOW_NO_START_NODE` | never dispatched: the definition has no `start` node |
| `400` | `FLOW_FAILED` | RAN, and was rejected |
| `200` | — | succeeded, or PAUSED at a screen node — a pause is not a failure |

The three refusals report no run because none exists: no node executed and
nothing was written. Only `400` describes a run, and only it carries
`error.details.summary` / `error.details.errorMessage`.

Why two statuses and not one: a disabled flow is reversible operational state —
enable it and the identical request succeeds, which is what `409` means. A flow
with no start node cannot be executed as stored, and no retry helps, which is
what `422` means. Collapsing them would tell an operator to flip a switch that
will not help.

**`@objectstack/spec`:** `AutomationResult.code` gains `'FLOW_DISABLED'` and
`'FLOW_NO_START_NODE'`. The union stays closed; these are trigger-time refusals
classified *before* dispatch, documented as a group distinct from the existing
resume-refusal members. Both are registered in the ADR-0112 error-code ledger.

**`@objectstack/service-automation`:** `execute()` stamps the matching `code` on
its disabled-flow and no-start-node exits. They continue to carry **no**
`status` — that absence is what lets a transport tell a never-dispatched exit
from a run that dispatched and failed (`status: 'failed'`) without inspecting
`summary`, `durationMs` or the message.

**`@objectstack/client`:** `client.automation.trigger()`, `.execute()` and
`client.project(id).automation.execute()` already rejected on a failed run;
they now reject with these two additional classifications, so a caller can tell
"enable the flow and retry" from "the flow definition is broken":

```ts
try {
  await client.automation.execute(flow, { params });
} catch (err: any) {
  err.httpStatus;   // 409 | 422 | 400 | 404
  err.code;         // 'FLOW_DISABLED' | 'FLOW_NO_START_NODE' | 'FLOW_FAILED'
}
```

Callers that branch only on `FLOW_FAILED` keep working for the case they
handle, but will no longer see these two refusals under it — they arrive with
their own codes, which is the point.

Not affected, and deliberately so: `POST /api/v1/actions/...` with a
`type: 'flow'` action, and metadata-declared `type: 'flow'` endpoints. Both
dispatch the same flow through a different door with its own response
conventions, and whether they should inherit this table is tracked separately.

<!-- adr-0087: not-required (no-migration-prescription) retires no metadata surface: no Zod schema, no authorable key, and no stored sys_metadata row changes shape, so `objectstack migrate meta` has nothing to rewrite and no ledger entry could be written for it. What changes is an HTTP status plus two new members of a runtime result type, and the channel that reaches those consumers is this changeset plus the compiler. -->
