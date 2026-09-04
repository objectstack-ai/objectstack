---
'@objectstack/metadata': patch
'@objectstack/metadata-protocol': patch
---

Five metadata adapter boundaries now emit the ISO-8601 string their declared type promises
when the driver hands them a JS `Date`, instead of asserting `as string` over it

`MetadataRecord.createdAt` / `.updatedAt` and `MetadataHistoryRecord.recordedAt` are
declared `z.string().datetime()`, and `MetadataEvent.ts` is declared `z.string()`. Four
producers in `DatabaseLoader` (`rowToRecord`, `getHistoryRecord`, `queryHistory`) and one
in `SysMetadataRepository` (`rowToEvent`) reached those fields through an unchecked
`row.<column> as string` cast, which is an assertion about a driver row rather than a
measurement of one — so nothing type-checked and nothing reported it.

On Postgres and MySQL the assertion is false for both column classes involved.
`SqlDriver#formatOutput` repairs the builtin audit columns and folds declared
`Field.datetime` columns only inside its `if (this.isSqlite)` arm, and
`withPostgresCalendarDayAsText` leaves `timestamptz` / `timestamp` deliberately untouched
because those are instants. A column being declared `Field.datetime` therefore does **not**
protect it: on the production default driver both classes come out of the record read door
as a `Date`, and `.datetime()` is a refinement a `Date` fails outright. Nothing has failed
yet only because no production path parses these values today.

The repair is producer-side, at the adapter boundary that asserts the declared type — not
a tolerant fallback in a consumer, and not a change at the driver's read door, which would
reverse a deliberate driver decision. Callers keep their existing behaviour for every other
shape: an already-canonical SQLite string passes through byte-identically, an absent column
still yields `undefined` so each caller's `?? <default>` chain means what it meant, and an
Invalid `Date` is handed through unchanged rather than converted, because what the shared
canonical-ISO spelling should do with that one input is still being decided.
