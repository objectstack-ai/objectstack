---
'@objectstack/types': minor
---

feat(types): the driver-fault redaction is exported from types, so a driver's own log lines take the same cut the engine applies

Clause-②: no

- **New exports.** `redactBoundStatement`, `redactStatementFromMessage`, `redactPropagatedDriverFault` and the `DriverFaultOrigin` type are exported from `@objectstack/types`, by name. They moved here from `@objectstack/objectql`, which never exported them from its entries. The cut is unchanged by the move: the same split, the same structural cut at the separator, the same value templates and the same property rules.
- **Why here.** `@objectstack/driver-sql`, `@objectstack/objectql` and `@objectstack/core` all depend on this package, and `operatorFacingErrorText` lives in it, so this is the lowest package all of them can import the cut from. The module imports only this package's own leak predicate, which is unchanged.
- **One widening, on the log face.** `redactStatementFromMessage` takes an optional second argument, `{ statementSent: true }`. With it the cut runs without asking the shared leak predicate, as `redactPropagatedDriverFault` already did with the same flag. Without it the function answers exactly as before.
- **Why minor.** The package gains four exported names, and `redactStatementFromMessage` gains the optional parameter above. No existing export of `@objectstack/types` changes.
