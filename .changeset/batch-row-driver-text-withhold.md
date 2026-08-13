---
"@objectstack/metadata-protocol": patch
---

Withhold undeclared driver text from a bulk write's per-row `errors[].message` (#8502)

`toRowApiError` interpolated whatever it caught into a batch row's message, so a
driver fault under `deleteManyData` answered
`{ code: "INTERNAL_ERROR", message: "SQLITE_ERROR: no such table: leave_request" }`
on response DATA riding a 200 — where no HTTP boundary's 5xx withhold can reach
it. Driven against a real driver the leaked text is worse than the tidy example:
a delete's raw message carries the failing statement's `WHERE` clause and its
bound record id, and a create's carries the whole `INSERT` with its values. The
causal row's message is also copied onto every `NOT_ATTEMPTED` / `ROLLED_BACK`
sibling, so one leaked sentence was repeated across the batch.

A caught sentence now reaches a caller only when its producer declared a
client-facing refusal, asked through `resolveThrownHttpError` — the same
resolver the HTTP doors answer with — so all three declarations this sink
actually receives are honoured: a 4xx `status`, a 4xx `statusCode`, and the
`VALIDATION_FAILED` shape that carries neither. Per-field authoring feedback
from the engine's validator, `RECORD_NOT_FOUND`, `VALIDATION_FAILED` and
`plugin-approvals`' `RECORD_LOCKED` are unchanged, byte for byte. Anything
undeclared — a driver fault, or a hook that throws a bare `Error` — gets a
stable sentence naming the operation, and the original goes to the server log.

The `code` limb is untouched (#8441 already gates it on catalog membership), and
no `httpStatus` is minted where the wire did not carry one.

**Behaviour change for hook authors**: a hook that refuses by throwing an
undeclared `Error` no longer has its sentence echoed on the row. Declare the
refusal — a 4xx `status` or `statusCode`, or `validationFailure(message, fields)`
from `@objectstack/types` — and the message is served verbatim, as it now is on
the single-record path.
