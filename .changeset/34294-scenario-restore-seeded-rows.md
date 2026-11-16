---
'@objectstack/scenarios': patch
---

feat(scenarios): every operation starts from the seeded rows: the runner undoes an earlier turn's write before the next operation runs

Clause-②: yes (widening) — new exports `restoreObjects`, `seededRows`, `restoreSeededRows` and types `SeededRows` / `RowRestore` (`orchestrate.ts`); `derivedFields`, `rowDrift`, `driftText`, `RESTORE_UNCOMPARED`, `RESTORE_UNWRITTEN` and types `HeldRow` / `RowDrift` (`seed.ts`); new optional member `AppHarness.deleteRow` and method `HttpApp.deleteRow` (`app.ts`); new optional fields `OperationResult.restored` (`orchestrate.ts`) and `HalfScores.operations.restored` (`scorecard.ts`); all of these reached through `./runner`. Operation grades after an earlier turn's write move: an operation that used to read the rows the turn before it left now reads the seeded rows.
Metadata-protocol: none

Until now a Run half ran every operation in card order on one seeded app, so a turn that wrote the wrong row, deleted one, or a probe the app wrongly stored, left the next operation starting from rows the card never declared. One bad write could fail two or three operations, and the operations score measured the cascade as much as each turn.

Now the runner reads the rows of every seeded object, and of every object an operation writes or its outcome reads, right after the seed loads. Before each operation it reads them again, and when an earlier turn moved them it puts them back as the admin: a row a turn added is deleted, a seeded row a turn removed is inserted again with the body the seed sent, and a changed column is set back to the value the seed left, in up to three rounds so a cascade settles. The clock, the last writer and the fields the build computes (formula, summary, autonumber) are neither compared nor written. The operation's result carries `restored` (`deleted`, `reinserted`, `setBack`), and the `Run-operations` cell adds `N started from restored rows`. Rows that still differ after the rounds make the operation NOT MEASURED with the reason (`restore: …`), never a pass or a fail.

The restore runs before an operation's first turn, never between a `pending_confirmation` operation's ask and its confirmation. Questions are untouched: they all run before any operation, at every `--ask-repeats` ask. A run where no earlier turn moved a row writes nothing and records and scores exactly as before. A replayed recording re-sends each operation's writes against the restored rows; where a later operation leaned on an earlier one's write, it reads NOT MEASURED (the replay is not faithful), never a fail.
