---
'@objectstack/service-automation': minor
'@objectstack/runtime': minor
'@objectstack/client': minor
---

**BREAKING** — `POST /api/v1/automation/:name/runs/:runId/resume` answers real HTTP
status codes for a failed run instead of HTTP 200 wrapping an inner `{success: false}`.

Until now a screen flow driven to a server-side node failure answered:

```
HTTP 200
{"success":true,"data":{"success":false,"error":"Node 'create_opportunity' failed: …"}}
```

The run genuinely failed; the transport reported success. A scripted or integration
caller that branches on the HTTP status alone read a failed run as a successful one.
This applies to the resume route the ruling for `/actions` (business failures must not
ride HTTP 200 inside a double envelope), which every other automation refusal on this
route already followed.

What changes on the wire:

- **A run that resumed and then failed ⇒ `400` with `error.code: 'FLOW_FAILED'`.** The
  node failure stays the human-readable `error.message`. The flow author's own
  `errorMessage` travels in `error.details.errorMessage` — one documented location, the
  same one the console reads — and the run's per-node `summary` in
  `error.details.summary`. `durationMs` is no longer carried on this response.
- **A stale suspension ⇒ `404`.** The flow the run belongs to was deregistered, or the
  node it was parked on was edited away under a live pause. Nothing ran and the pause can
  never continue, so this is reported as terminal rather than as a business rejection.
  The engine now classifies both cases as `RUN_NOT_FOUND`; the message names which one.
- **Unchanged:** every refusal that leaves the suspension intact keeps its own code and
  stays retryable — `PERMISSION_DENIED` (403), `INVALID_SIGNAL` /
  `INVALID_SCREEN_INPUT` (400), `RESUME_IN_PROGRESS` (409), `STORE_UNAVAILABLE` (503) —
  and a resume that pauses again still answers 200 with the next screen.

**`@objectstack/client`:** `client.automation.resume()` and
`client.project(id).automation.resume()` now **reject** on a failed run instead of
resolving with `{success: false, error, summary}` — the SDK throws on every non-2xx
before unwrapping. Callers that inspected the resolved value must move to a `catch`:

```ts
try {
  await client.automation.resume(flow, runId, { inputs });
} catch (err: any) {
  err.code;                   // 'FLOW_FAILED' (400) — the run ran and failed
  err.httpStatus;             // 400 | 404 | 403 | 409 | 503
  err.message;                // the node failure, verbatim
  err.details?.errorMessage;  // the flow author's own message, when the flow declares one
}
```

Raw-HTTP callers that treated `2xx` as success and never opened the inner envelope now
see the failure they were already being told about, one level up.

<!-- adr-0087: not-required (no-migration-prescription) retires no metadata surface: no Zod schema, no authorable key, no stored sys_metadata row changes shape, so `objectstack migrate meta` has nothing to rewrite and no ledger entry can be written for it. What changes is an HTTP status plus an SDK method's promise contract, and the only channel that reaches those consumers is this changeset itself. -->
