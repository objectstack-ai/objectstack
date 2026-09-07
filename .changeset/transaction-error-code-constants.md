---
"@objectstack/objectql": minor
---

Both transaction-seam refusals publish their error `code` as an importable constant.

`packages/objectql/src/transaction-errors.ts` opens by telling the reader that the errors in it "identify themselves by a `code` field rather than by `instanceof`, for the reason `DriverConnectError` already records: the check has to survive crossing a package boundary, where two copies of this module can exist" — and neither of them offered anything to import. The only way to FOLLOW that published instruction was to re-spell the wire string in your own package, which acquires a `check:error-code-provenance` stamp site there and can then drift from what the engine throws with no compile error to say so.

Two new exports from `@objectstack/objectql`, each graded on its own:

- `TRANSACTION_UNSUPPORTED_CODE` — `TransactionUnsupportedError`'s ADR-0112 `code`. Thrown by `transaction(cb, base, { require: true })` when the datasource's driver has no `beginTransaction`, refused before the callback runs so nothing has been written. **Additive widening, `minor`.**
- `CROSS_DATASOURCE_TRANSACTION_WRITE_CODE` — `CrossDatasourceTransactionWriteError`'s ADR-0112 `code`. Thrown when a business write inside an open `transaction()` resolves to a driver that transaction does not cover. **Additive widening, `minor`.**

**The second one is a refusal callers are meant to recover from.** Its own message prescribes the remedy — split the work into per-datasource units and reconcile them explicitly — which is code a caller writes *around* this refusal, and therefore code that has to recognise it first. That recognition now has something to import.

**Why `code` and not `instanceof`.** This package declares both realms in its own `exports` (`import` reaches `dist/index.mjs`, `require` reaches `dist/index.js`), so a consumer holding the other realm's copy of a class gets `instanceof` === false — measured, and silent. A `code` compare is the check that survives that boundary, which is what this module's header has been telling readers to do.

**Nothing about the wire changed.** Each constant holds text byte-identical to the literal it replaces; every refusal throws the same `code` and the same message as before. Consumers that spell the strings themselves keep working unchanged — this adds affordances, it removes nothing.

**Both classes were already exported and stay exported**, and neither is published from the lean `./core` entry, so the constants join them on the one entry point that publishes them: class and constant are reachable from exactly the same place.
