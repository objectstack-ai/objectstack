---
'@objectstack/driver-turso': minor
'@objectstack/cli': minor
---

fix(driver-turso): a REMOTE `TursoDriver` refuses to plan the ADR-0104 media column move instead of answering that there is nothing to move, and `os migrate files-to-references` reports that refusal as a column step it could not judge (#19894)

Clause-②: yes (narrowing)

**BREAKING for callers that plan the media column move on a remote Turso datasource** — `TursoDriver.planMediaColumnMove()` in `remote` transport mode (for example a `libsql://` URL) now throws a `NOT_IMPLEMENTED` / `501` error, where it used to answer `{ plans: [], refusals: [] }`. The `local` (`:memory:` and `file:`) and `replica` modes plan exactly as before, and the local modes plan exactly what `SqlDriver` plans for the same declaration.

What the refusal replaces, measured on the transport's SQLite-backed test double: a table with a `file` and an `image` field, synced through each of the three remote schema doors (`syncSchemasBatch`, `syncSchema`, `initObjects`), held its two TEXT media columns on the remote database, and the remote face answered an empty scan on every door. The inherited planner walks the objects `SqlDriver`'s own schema sync registers, which no remote schema door reaches, and probes each table through the placeholder in-memory Knex connection a remote driver is built with. The local and embedded-replica faces planned two `unquote` moves for the same declaration. `os migrate files-to-references` printed that empty scan as "Column step: nothing to move — this datastore declares no single-value media column".

- **The command reports the refusal instead of failing on it.** `os migrate files-to-references` calls the planner only after the backfill and its self-check have passed, and an `--apply` run has recorded the deployment flag by then. Measured on the command's own test doubles before this change, a planner that throws ended the run with the error alone (`--json`: `{"error": …, "code": "NOT_IMPLEMENTED"}`) and exit 1, with no backfill report, no verify report and no word about the flag it had recorded. The column step now catches a `NOT_IMPLEMENTED` refusal by its code and reports it as a skip: the text face prints `Column step: NOT JUDGED` with the driver's message, and `--json` gains `columnMoveRefused` — `{ error, code }` when the driver refused, `null` otherwise — beside `columnMove: null` and `columnsMovedAt: null`. The backfill, verify and flag reports are emitted as on any other run, nothing is stamped, and the exit code is the self-check's, as it already was for the command's other column-step skips.
- **Any other throw from the planner still fails the command**, through the same error report and exit 1 as before.
- **A genuinely empty scan still reads "nothing to move".**
- **No new error code.** `NOT_IMPLEMENTED` / `501` is a standard code, the envelope this transport already uses for its remote transaction, auto-number, deferred-DDL and drift-detection refusals.

**If you are refused:** the backfill, its self-check and, on `--apply`, the deployment flag are unaffected. A remote Turso datasource keeps its single-value media columns on the JSON encoding: measured on the same double, the remote face writes a file id as a JSON string and reads it back as the id, and it does not read the record of a completed column move.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is removed, renamed or reshaped: no spec key, no export, no stored row and no config key — `planMediaColumnMove` keeps its name and its signature, and the command's `--json` document only gains a key. There is no old spelling that maps to a new one: the refused call asked the remote transport for a capability it never delivered, and the refusal itself says what the datasource keeps. -->
