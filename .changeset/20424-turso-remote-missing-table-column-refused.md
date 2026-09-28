---
"@objectstack/driver-turso": minor
---

`TursoDriver` in **remote** mode refuses a read over a missing table or a missing column with the same code the local mode answers, instead of answering "no rows" (#20424).

Clause-②: no (narrowing)

<!-- adr-0087: not-required (already-registered driver-sql-unresolvable-where-column-refused) That registered entry names `TursoDriver` among the `SqlDriver` subclasses whose reads now refuse an unresolvable column, and prescribes this change's remedy: name a column the table has, or run schema sync so a declared field exists as a column. The `aggregate` legs (a table that is really absent, a `groupBy` or aggregation column that is absent) are the same drifted-schema family with the same remedy, so no new migration entry is owed. -->

**BREAKING** — an accept-set narrowing on the remote face of `TursoDriver`'s read doors, shipped as `minor` under the launch-window convention (`check-changeset-no-major` refuses `major` until GA; breaking-ness is carried by this banner and the ADR-0087 disposition above, not by the level). Remote-face users meet this refusal for the first time here.

**FROM → TO.** A remote-face read (`aggregate`, `find`, `findOne`, `count`) that answered `[]` / `null` for a missing table or a missing column now refuses, as the local face does: `DATABASE_ERROR` / 500 for a table that is absent, `INVALID_FIELD` / 400 for a `groupBy` or aggregation column that is absent, `INVALID_FILTER` / 400 for a `where` column that is absent. **The fix:** run schema sync so the declared field has its column (or the object its table), or name a column the table has. `RemoteTransport.find` and `RemoteTransport.aggregate`, exported from the package root, now raise the backend's error where they answered `[]`.

**What was wrong.** Two catches in `RemoteTransport` read a backend "no such table" or "no such column" as an empty result. `aggregate` answered `[]` for both. `find` (and `findOne` through it) answered `[]` (`null`) for a missing column once its projection retry was spent, or when there was no projection to drop. So on a remote Turso database a schema drift or a missing table read as "there is no data", while the local mode of the same driver, over the same file, refused it. Measured with a local driver over the same libSQL file as the control, for a federated and for a managed object alike:

| read | local | remote before |
|:--|:--|:--|
| `aggregate` on a table that is really absent | `DATABASE_ERROR` / 500 | `[]` |
| `aggregate` grouped by, or aggregating, a declared field whose column is absent | `INVALID_FIELD` / 400 | `[]` |
| `aggregate` whose `where` names that field | `INVALID_FILTER` / 400 | `[]` |
| `find` / `findOne` whose `where` names that field | `INVALID_FILTER` / 400 | `[]` / `null` |
| `count` whose `where` names that field | `INVALID_FILTER` / 400 | `DATABASE_ERROR` / 500 |
| `find` ordered by that field | the rows, unordered | `[]` |

**What changes, on the remote face only:**

- `aggregate`, `find`, `findOne` and `count` answer each row above the way the local face does. The backend's error is classified by the local face's own inherited seam, `SqlDriver.aggregateBackendFault`, and not by a second copy: an unresolvable column named by a `groupBy` or an aggregation is `INVALID_FIELD` / 400, one named by the `where` is `INVALID_FILTER` / 400, and anything else is `DATABASE_ERROR` / 500. The dialect text goes to the server log, never to the caller.
- `find` keeps the local face's recovery ladder: a projection naming a column the table lacks is dropped first, then an ORDER BY on one, and the rows answer. A `where` is never dropped. Before, the ORDER BY rung was missing and the sort answered `[]`.
- A refusal the transport raises while it compiles the statement (a filter or aggregate-vocabulary refusal, the timeout envelope) keeps its own code and status.
- `RemoteTransport.find` and `RemoteTransport.aggregate`, used on their own, now raise the backend's error where they answered `[]`.

This is the refusal the registered migration entry `driver-sql-unresolvable-where-column-refused` already names for `driver-sql` "and its `TursoDriver` / `SqliteWasmDriver` subclasses": the remote face of `TursoDriver` now delivers it. **If a read now refuses for you:** the table or column it names is missing from the remote database. Run schema sync so the declared field has its column (or the object its table), or correct the name the query uses.
