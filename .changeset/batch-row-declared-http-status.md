---
"@objectstack/metadata-protocol": patch
"@objectstack/types": minor
---

A bulk write's per-row `errors[].httpStatus` carries the status its producer declared, in any spelling (#8570)

`toRowApiError` set the limb from `err.status` alone, so two well-defined client
refusals shipped a batch row with no status at all: objectql's `ValidationError`
(a 400 recognisable by shape, which deliberately declares no `status`) and
`plugin-approvals`' record lock (a 409 spelled `statusCode`). Sibling rows in the
same response did carry one — `rowRequiredIdError` → 400,
`recordNotFoundError` → 404 — so a caller branching on `httpStatus` to tell "fix
your input" from "the server broke" got an answer for some failure rows and
silence for others, with nothing saying which. Same single-spelling defect #7525
fixed at the HTTP door, one layer down.

The limb now asks `resolveThrownHttpError` — the resolver the HTTP doors and the
row's `message` limb already answer with — so a refusal declaring `.status`,
`.statusCode` or the `VALIDATION_FAILED` shape reaches the row as the status it
always meant. Rows whose throw declared nothing (a driver fault, a hook throwing
a bare `Error`) still carry no `httpStatus`: the resolver's 500 there is the
caller's fallback, not a producer's claim, and stamping it would add a field to
the wire for those populations rather than restore a declared one. `code` reads
the same resolution, so a row can no longer contradict itself.

`ThrownHttpError` gains `declaredStatus` — the resolved status minus the
fallback, absent when the throw declared none. `status` is unchanged, and every
boundary that answers with the status itself keeps reading it; the new field is
for sinks that mirror a status onto response DATA, where a fallback would be an
invention.
