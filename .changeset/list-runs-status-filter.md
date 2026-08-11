---
"@objectstack/spec": minor
"@objectstack/client": minor
"@objectstack/runtime": patch
"@objectstack/service-automation": patch
---

fix(spec,runtime,service-automation): `GET /automation/:name/runs?status=` filters the runs instead of being dropped (#7359)

`ListRunsRequestSchema` has always declared a `status` filter on
`GET /api/automation/:name/runs` — `z.enum([...the eight ExecutionStatus
members]).optional()`, described as "Filter by execution status". Nothing read
it. It had no slot on `IAutomationService.listRuns`, whose options were
`{ limit?, cursor? }`, and the runtime handler never built it into the object it
forwarded, so the parameter was dropped at the HTTP boundary and the caller was
answered **200 with every run of the flow**, capped by `limit`.

That is worse than an error, because the answer looks like the one that was
asked for: a monitoring caller paging `?status=failed` reads the first 20 runs
of any status and concludes those are the failures. Exposure was raw HTTP,
generated clients, and anything authored against the OpenAPI surface — the typed
SDK could not send the parameter at all, which is why nothing had tripped over
it. #7300 fixed this route's two *coerced* parameters and deliberately preserved
the ignore-the-key behaviour rather than decide between honouring and retiring
the third; this change takes the enforce route (ADR-0049), so the declared
surface is now true.

**The filter is honoured across both stores.** `AutomationEngine.listRuns`
serves the Runs view by merging an in-memory ring buffer with the durable run
history it reads back from the store. The narrowing is applied to the merged
result, so both halves are covered: filtering only the buffer would answer "no
failures" for a flow whose failures are all in durable history — i.e. after any
restart, which is exactly when someone asks — and filtering only the durable
rows would hide the live ones. Applying it after the merge also means each run
is matched on its **resolved** status: the buffer holds more than one entry per
run id (a run that pauses appends `paused`, then its terminal entry), and
narrowing before the collapse would have let a stale `paused` entry outlive the
terminal one, so every approval/screen/wait run that had since completed would
report itself as still paused.

The durable arm's window is unchanged: `listHistory(flowName, limit)` has no
status slot, so the filter is applied to the rows that come back rather than
pushed down, and a status filter can therefore return fewer than `limit` matches
while older ones exist. That is this merge's pre-existing shape — durable rows
were already capped at `limit` before the sort-and-slice — and closing it is a
store-contract change. What it never does is return a run of another status.

**An undeclared status is now refused, not silently widened.** Once the filter
is honoured, a value outside the set has no safe reading: `?status=faild` cannot
mean "no filter", and serving the empty list is no better, because "no runs are
`faild`" and "no runs failed" read identically to a caller who cannot see their
own typo. The check goes through the shared `query-param` module this route
already consumes with `/notifications`, as a new `parseEnumParam` gate, and
refuses in the house shape — `400` `VALIDATION_FAILED` (ADR-0112) with a
`details.fields[]` entry carrying ADR-0114's existing `invalid_option`
("not a member of the field's declared options"); a value that was never a
single string at all — a repeated `?status=a&status=b`, a structured
`?status[$ne]=x` — gets `invalid_type`, the same mapping the module's string
gate already makes. No new error vocabulary. The accepted members are read from
the spec's own `ExecutionStatus` enum, the one `ListRunsRequestSchema` is built
from, so the wire's declared set and the boundary's accepted set cannot drift.

**The typed client can now send it.** `client.automation.listRuns(flow, {
status })` — both the `automation.listRuns` alias and `automation.runs.list` —
takes the filter as an optional `ExecutionStatus`, additively. It could not send
the parameter at all before, which is the reason nothing had tripped over the
server-side gap; leaving it out would have made the enforced filter reachable
only from raw HTTP, and the Runs view that wants it goes through this client.

**Nothing that had a defensible answer changes.** An absent `status` still
returns every run, exactly as before. So does the empty spelling `?status=` —
unlike `?read=` on the notifications inbox, which used to serve the wrong *half*
of the result, `?status=` already served precisely what "no filter" means, and
it is what an "All statuses" `<select>` submits. `limit` and `cursor` are
untouched, including out-of-range values, which remain the service's business.
