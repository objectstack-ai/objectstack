---
"@objectstack/cli": patch
---

`os generate migration` gives a table's own `id` column the shape the platform actually creates.

Both migration generators hardcoded the primary key as a UUID — `"id" UUID PRIMARY KEY DEFAULT gen_random_uuid()` in the SQL format, `table.uuid('id').primary().defaultTo(db.fn.uuid())` in the TypeScript one (the default format). The platform's SQL driver emits `table.string('id').primary()`, which is knex's `varchar(255)`. A platform id is a string, not a uuid, so on Postgres the generated table refused the platform's very first insert with `22P02 invalid input syntax for type uuid`.

The quieter half is the `DEFAULT`, and it is why this was worth correcting rather than working around. The driver emits no database-side default at all — its insert path always supplies the id itself — so `gen_random_uuid()` never fired for a platform write, only for an out-of-band one, handing that row a 36-character uuid this platform's id generator would never mint. One table would then hold two incompatible id shapes, with nothing said.

Both generators now emit the driver's own answer: `"id" VARCHAR(255) PRIMARY KEY` and `table.string('id').primary()`. The correction also closes a contradiction inside the generator file, whose prose already stated that a reference column takes the width of the target's `id` column *because* the driver emits `table.string('id').primary()` — a few hundred lines above the two lines that emitted `uuid`.

`generate-builtin-id-column.pin.test.ts` reads the width from the driver's own `DEFAULT_STRING_VARCHAR_CHARS` rather than transcribing `255`, so the generators cannot drift away from the driver again without a named failure.
