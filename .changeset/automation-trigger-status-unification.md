---
'@objectstack/service-automation': minor
'@objectstack/runtime': minor
'@objectstack/client': minor
---

**BREAKING** — both automation `trigger` routes answer real HTTP status codes for a flow
that ran and failed, instead of HTTP 200 wrapping an inner `{success: false}`.

This is the second and wider half of the migration the resume route shipped in the same
release (#8684, merged 2026-08-17): one SDK-visible behaviour change, one migration note.
The resume flip touched the screen-flow runner; this one touches the door every app
dispatches flows through.

Until now a flow driven to a node failure answered:

```
HTTP 200
{"success":true,"data":{"success":false,"error":"Node 'create_opportunity' failed: …"}}
```

The run genuinely failed; the transport reported success. A scripted or integration caller
that branches on the HTTP status alone read a failed run as a successful one. This applies
the `/actions` ruling (business failures must not ride HTTP 200 inside a double envelope)
to `POST /api/v1/automation/:name/trigger` and to the legacy
`POST /api/v1/automation/trigger/:name` — the shape `client.automation.trigger()` calls.
Both doors answer through one mapper, so they cannot drift.

What changes on the wire:

- **A flow that ran and then failed ⇒ `400` with `error.code: 'FLOW_FAILED'`.** The node
  failure stays the human-readable `error.message`. The flow author's own `errorMessage`
  travels in `error.details.errorMessage` — one documented location, the same one the
  console reads — and the run's per-node accounting in `error.details.summary`. A flow
  whose `errorHandling.strategy` is `retry` answers the same way once its attempts are
  exhausted. `durationMs` is no longer carried on this response.
- **A flow name the deployment does not hold ⇒ `404`,** answered before anything is
  dispatched, through the same registry probe `POST /:name/toggle` and `GET /:name` use.
- **Unchanged:** a successful run still answers 200 with its result, and a run that PAUSED
  at a `screen` node still answers 200 with the next screen — a pause is not a failure.
- **Also unchanged, pending a ruling:** a DISABLED flow and one with no start node still
  answer 200 with the inner failure. Both are exits that never dispatched anything, and
  telling them apart needs a producer-side classification the closed
  `AutomationResult.code` union cannot yet express. Tracked on #9378.

**`@objectstack/service-automation`:** `execute()` now stamps `status: 'failed'` on the
results of runs that dispatched and were rejected — the same lifecycle verdict it already
writes to the run log. Its never-dispatched exits carry no `status`, which is what lets a
transport answer the two classes differently without inspecting the result's internals.

**`@objectstack/client`:** `client.automation.trigger()`, `client.automation.execute()` and
`client.project(id).automation.execute()` now **reject** on a failed run instead of
resolving with `{ success: false, error }` — the SDK throws on every non-2xx before
unwrapping. Callers that inspected the resolved value must move to a `catch`:

```ts
try {
  await client.automation.execute(flow, { params });
} catch (err: any) {
  err.code;                   // 'FLOW_FAILED' (400) — the run ran and failed
  err.httpStatus;             // 400 | 404
  err.message;                // the node failure, verbatim
  err.details?.errorMessage;  // the flow author's own message, when the flow declares one
  err.details?.summary;       // which node failed
}
```

Raw-HTTP callers that treated `2xx` as success and never opened the inner envelope now see
the failure they were already being told about, one level up.

<!-- adr-0087: not-required (no-migration-prescription) retires no metadata surface: no Zod schema, no authorable key, no stored sys_metadata row changes shape, so `objectstack migrate meta` has nothing to rewrite and no ledger entry can be written for it. What changes is an HTTP status plus an SDK method's promise contract, and the only channel that reaches those consumers is this changeset itself. -->
