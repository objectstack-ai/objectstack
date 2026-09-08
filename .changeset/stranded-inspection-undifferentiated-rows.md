---
"@objectstack/plugin-approvals": patch
---

`inspectStrandedRequests` no longer drops a row it could not differentiate, and no longer lets one misbehaving host abort the whole scan (#16709, items 2 and 3).

Both are the same mistake at two altitudes: the method exists to **enumerate** the terminal approval requests whose flow run cannot advance, so a failure to read the #15358 third oracle must never remove a row from the answer — and never remove the *other* rows either.

- **A thrown third read now leaves its row in `stranded`, as `'failed'`.** It used to be counted `undetermined` and skipped, exactly as a thrown `hasSuspendedRun` or `getRun` is. Those two are not the same question: a throw from either leaves it unknown *whether* the row is stranded at all, and a storage outage must not be published as a lost run. By the time the third oracle is asked, both have answered — no live pause, terminal `failed` — and it is asked only *which* of the three shapes the row is. A read that could not be made is therefore the textbook "could not differentiate", which is what `'failed'` already means (`StrandedRunState`, #15358 ruling item 1). Dropping the row let `stranded: []` read as "nothing stranded" while a row was in fact stuck, with a log line as its only trace; for a report, fail-closed means showing the row.
- **A host that violates `ApprovalResumeSurface` no longer aborts the scan.** `refineFailedRunState(verdict)` ran outside the `try` that wrapped the read, so an implementation resolving `undefined` where a verdict is declared threw a `TypeError` out of `inspectStrandedRequests` itself and the scan enumerated **nothing**. The refinement now runs inside that `try`; a malformed verdict costs its own row the differentiation, is counted `undetermined`, and costs every other row nothing.

⛔ No new `StrandedRunState` member and no widened export: both cases map onto the existing undifferentiated `'failed'`. The `undetermined` counter is kept as telemetry and now **overlaps** `stranded` by design — a row can be both reported and counted — so neither number alone sizes the scan's blind spot.
