---
'@objectstack/objectql': patch
---

fix(objectql): a driver error that leaves the engine no longer carries the failing statement or the caller's values

Clause-②: no

The engine has cut the bound statement out of its own log line for a failed driver call for a long time, but it rethrew the driver's raw error. Any in-process code that logged what it caught, such as an auth library's error logger, printed the statement and the row's values. The same cut now runs where the error leaves the engine, so no consumer needs a patch of its own.

- **Where.** Every engine operation that reaches a driver: `find`, `findOne`, `count`, `aggregate`, `insert` (batch included), `update` and `delete` (by id and by predicate), `execute`, `transaction`, `resolveSecretField` and `resolveInternalField`.
- **What is cut.** The statement and the caller's values, from the error's `message` and `stack`, from the properties drivers attach (mysql2's `sql` and `sqlMessage`; node-postgres' `detail`, `where` and `internalQuery`), and down the `cause` chain. A `DuplicateRecordError` keeps its own fields and carries a cut `cause`.
- **What stays.** The error's class (`instanceof` still holds), `name`, `code`, `errno`, `sqlState`, Postgres' identifier fields (`constraint`, `table`, `column`, …) and the database's own diagnostic. The message now reads as the statement's kind, a `[statement and bound values redacted]` marker and the diagnostic. A Postgres key-shaped `detail` keeps its column list. Every REST answer keeps its status, code and `field`.
- **What changes for a caller.** Code that read the statement or a value out of a driver error's message or properties now gets the marker instead. Branch on the class, `code` or `errno` instead. The driver error on a `DuplicateRecordError`'s `cause` is an equivalent copy, no longer the object the driver threw. An import's row report for a value-bearing database error no longer repeats the rejected value.
