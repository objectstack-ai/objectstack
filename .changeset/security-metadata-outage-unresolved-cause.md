---
"@objectstack/plugin-security": patch
---

Report a metadata-store OUTAGE as an outage, not as an absent declaration
(#10424). When an object's security posture cannot be resolved, the refusal
now consumes the `degraded` verdict `IMetadataService.getDiagnosed` was already
computing and discarding (#5840), so a store that could not answer no longer
wears the sentence written for an object that was never declared — "Check that
the object is declared and published on this runtime" sent operators to
re-check a healthy declaration in the middle of an incident. The refusal now
names the store, says the declaration may well be fine, and the operator log
line carries a grep-able `DEGRADED` / `metadata-store OUTAGE`.

Explanation and logging only. The deny is unchanged in every case — same
`PermissionDeniedError`, same `PERMISSION_DENIED`, same 403, still fail-closed
per #3545 — and the set of requests that are accepted or rejected does not
move: the resolving read is untouched and `getDiagnosed` is consulted as a
separate best-effort probe on the path that is already refusing. A metadata
service that does not implement the optional `getDiagnosed` reports `unknown`
and keeps the previous wording; it is never reported as an outage.
