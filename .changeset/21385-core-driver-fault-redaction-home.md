---
'@objectstack/core': minor
---

feat(core): the driver-fault redaction is exported from core, so a driver's own log lines take the same cut the engine applies

Clause-②: no

- **New exports.** `redactBoundStatement`, `redactStatementFromMessage`, `redactPropagatedDriverFault` and the `DriverFaultOrigin` type are exported from `@objectstack/core`. They moved here from `@objectstack/objectql`, which never exported them from its entries. The cut is unchanged by the move: the same split, the same structural cut at the separator, the same value templates and the same property rules.
- **One widening, on the log face.** `redactStatementFromMessage` takes an optional second argument, `{ statementSent: true }`. With it the cut runs without asking the shared leak predicate, as `redactPropagatedDriverFault` already did with the same flag. Without it the function answers exactly as before.
- **Why minor.** The package gains four exported names, and `redactStatementFromMessage` gains the optional parameter above. No existing export of `@objectstack/core` changes.
