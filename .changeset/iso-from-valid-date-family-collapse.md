---
"@objectstack/metadata": patch
"@objectstack/metadata-protocol": patch
---

fix(metadata): four `isoFromValidDate` call sites collapse onto the shared canonical-ISO spelling; `MetadataHistoryRecord.recordedAt` gets the terminal value it never had (#16422)

## What was wrong

`#14037`/`#14038` landed a narrow per-site helper, `isoFromValidDate`, beside
the shared `canonicalIsoInstant` spelling. It rewrote exactly one shape — a
valid JS `Date` becomes ISO text — and handed **every other input back
untouched**. Four adapter boundaries used it, and each fed a field declared
`z.string()` or `z.string().datetime()`:

| site | declared as |
|:--|:--|
| `SysMetadataRepository.rowToEvent` → `MetadataEvent.ts` | `z.string()` |
| `DatabaseLoader.rowToRecord` → `MetadataRecord.createdAt` / `.updatedAt` | `z.string().datetime().optional()` |
| `DatabaseLoader.getHistoryRecord` → `MetadataHistoryRecord.recordedAt` | `z.string().datetime()` — **required** |
| `DatabaseLoader.queryHistory` → the same field, the other door | `z.string().datetime()` — **required** |

So a `null`, a `number`, an opaque column and an Invalid `Date` all arrived at a
field declared `string`, each wearing an `as string` / `as string | undefined`
cast that asserted the opposite. Measured over the seven inputs that
distinguish the two helpers, the declared schemas refused **21 of 35** produced
values.

`recordedAt` was the sharp end: a REQUIRED `z.string().datetime()` for which
none of the three available answers was legal — the visible text
`"Invalid Date"` fails the refinement, `undefined` fails the required field, and
the pass-through fed it the `Date` object, which fails both.

## What it does now

Those four sites read `canonicalIsoInstant`, whose return type **is**
`string | undefined`, so all four casts are deleted rather than restated. Both
sibling definitions of `isoFromValidDate` are gone. The terminal value is chosen
per site, from the site's own declared schema:

- `MetadataRecord.createdAt` / `.updatedAt` are `.optional()` → `undefined`, the
  branch an absent column already took. ⛔ No default is invented for a field the
  schema lets be absent.
- `MetadataHistoryRecord.recordedAt` is required → the **epoch**, via a named
  `recordedAtFallback()` shared by both history doors. ⛔ Not `new Date()`: a
  `now` stamp is a plausible-looking recording instant nobody measured, and it
  sorts a version recorded years ago to the top of a newest-first timeline. The
  epoch invents no fact and sorts to the oldest end. It is also the answer the
  sibling reader of this same `sys_metadata_history.recorded_at` column already
  gives (`rowToEvent` and `history()`, both `?? new Date(0).toISOString()`).

Schema refusals over the same seven inputs: **21 → 8**. The eight that remain
are a `number` and an opaque object at four sites — shapes no driver is measured
to materialise for these columns. They now arrive as the declared *type* (a
string) that simply is not a valid datetime, so the producer's bug stays visible
instead of being papered over.

## One behaviour change worth reading twice

`DatabaseLoader.stat()` computes `record.updatedAt ?? record.createdAt`. An
Invalid `updated_at` used to WIN that `??` — a `Date` is truthy and not nullish —
so a row with an unreadable `updated_at` and a good `created_at` published
`new Date()` as its `mtime`. It now folds to `undefined` one step earlier and
loses the `??`, so the row publishes its `created_at`: a stored instant in place
of a fabricated one, and exactly the "same `?? <default>` chain an absent column
takes" that `#14078`'s own ruling text prescribes for the shape.

## What deliberately did NOT collapse

`listCommits` in `@objectstack/metadata-protocol` keeps its copy. Its docblock
promises callers the RAW value back for a non-`Date`, and the shared spelling
rewrites the whole domain: swapping it in would ERASE an Invalid `Date` from the
response (`undefined` — the one answer ADR-0053 D-F3 refuses, because it silently
drops a value that is on disk) and hand a `number` or an opaque object to the
commit-timeline sort as `String(value)` rather than verbatim. Measured, that site
is byte-identical on all seven inputs before and after this change.

`SqlDriver`'s same-named helper is not part of this family at all: it takes
`Date` (not `unknown`), both its call sites narrow with `instanceof Date` first,
and it is the PRODUCER-side fold ADR-0053 D-F3 governs. It is untouched.
