---
'@objectstack/objectql': patch
'@objectstack/cli': patch
---

fix(objectql,cli): `os migrate stored-expressions` fills a stored computed field on rows stored before it was declared, and the boot names the command when a sample of rows needs it

Clause-②: no
Metadata-protocol: none

A stored computed field (a non-`formula` field declaring `expression`) is computed by the engine on every insert and update and on nothing else, so declaring one on an object that already holds rows left the new column NULL on every existing row until each was next written; a filter, sort, roll-up or analytics anchor over it read NULL where the expression gives a value, with no error. A fresh database was right and an upgraded one was not.

- **`@objectstack/cli`: `os migrate stored-expressions [--object <o>]… [--field <f>] [--changed] [--apply] [--yes] [--json] [--force] [--max-records] [--database-url]`.** A dry run (the default) reports, per field, the rows holding a NULL the expression gives a value; `--apply` writes them. Each value is the write's own computation over the stored row (option labels, the one reference hop, the `can()` map), and the apply writes through `engine.update` with `updated_at` kept, so hooks, roll-ups over the column and audit capture see an ordinary write. A NULL the expression itself answers (an empty reference, a null input) is left alone. A value that differs from the expression — the expression changed after the row was written — is counted on every run and rewritten only with `--changed`; an expression reading the clock always differs there. A row on which an expression does not evaluate while it holds a value is listed and not written, because the write would store NULL over it. The command exits 1 while a row is skipped or could not be written, or when `--max-records` cut the walk short. Idempotent: a re-run finds nothing to fill.
- **Boot advisory.** At `kernel:bootstrapped` the engine plugin reads the first 100 rows of each object declaring a stored computed field (nothing for an object declaring none) and, when that sample holds such a NULL, warns once naming each `object.field` and `os migrate stored-expressions`. It writes nothing and never fails a boot.
- **`@objectstack/objectql`:** `backfillStoredExpressions`, `formatStoredExpressionBackfillReport`, `storedExpressionBackfillComplete`, `announceStoredExpressionHoles`, `sampleStoredExpressionHoles`, and `ObjectQL.computeStoredExpressionsOver(object, rows, context?, onFault?)` — a stored computed field's values over rows already stored, computed as a write computes them.
