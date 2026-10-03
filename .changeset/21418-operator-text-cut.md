---
'@objectstack/types': patch
---

fix(types): `operatorFacingErrorText` answers through the driver-fault redaction, so an operator-facing record carries no statement and no bound value

Clause-②: no

- **What changed.** `operatorFacingErrorText` passes every text it returns through `redactStatementFromMessage`, the one driver-fault redaction in this package. Text it reads off a raw-statement fault's `cause` is cut with `{ statementSent: true }`, which is the cut `@objectstack/driver-sql` applies to its own log line for the same fault. Every other text asks the shared leak predicate, as the engine's own log line does.
- **What an operator reads now.** The records this helper fills, in `os db clean` and in the metadata migrations and probes, keep the dialect's own diagnostic: the missing column, the failed constraint or the locked database. The value slots the redaction's dialect templates own are cut from it, and the redaction's marker stands where the statement was removed. The records no longer carry the statement or the values bound into it.
- **What does not change.** Text that is not a driver dump comes back exactly as before, empty text included. The thrown error is not touched: its `code`, `status`, class and `cause` reach every other reader as the driver composed them. The function's signature and the package's exports are unchanged.
