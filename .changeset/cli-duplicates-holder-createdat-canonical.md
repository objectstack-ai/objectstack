---
"@objectstack/cli": patch
---

fix(cli): `os migrate duplicates` reports every holder's `createdAt` as canonical ISO-8601 UTC on every dialect (#13999)

`DuplicateHolder.createdAt` is declared `string | null`, and the holder mapper
built it with `String(row.created_at)`. `created_at` is a **builtin audit
column** — not in `datetimeFields`, and `SqlDriver#formatOutput` repairs it only
inside its `if (this.isSqlite)` arm — and the holder probe reads through the
raw-SQL seam, so no presentation runs on this path at all. The dialect therefore
decided what the operator saw.

On **Postgres and MySQL**, `created_at` materialises as a JS `Date`, so
`String()` ran `Date.prototype.toString`:

```
Sun Aug 30 2026 18:19:25 GMT+0800 (China Standard Time)
```

where the same command against **SQLite** printed `2026-08-30T10:19:25.947Z`.
One instant, two spellings, chosen by the dialect: the operator's local zone
baked in, whole seconds instead of milliseconds, no `Z`, and not
`Date.parse`-safe for anything consuming this command's JSON.

## What changes for a consumer

`duplicates[].holders[].createdAt` in the `os migrate duplicates` JSON now
carries canonical ISO-8601 UTC (`…Z`, milliseconds) on **every** dialect. On
SQLite the value is byte-identical to what it was — that side was already
canonical, which is why every existing pin on this command was green through the
defect. On Postgres and MySQL the value changes from the `Date.toString()`
rendering to the ISO spelling the field has always declared; a consumer that was
parsing the old rendering was parsing a zone-dependent, millisecond-lossy string.

Unchanged on purpose: a holder whose object carries no `created_at` column still
reports `createdAt: null` (the probe's `withCreatedAt: false` retry), and a
`Date` carrying no time value keeps its verbatim rendering rather than throwing
`RangeError` out of a read-only report.

## Where the repair lands, and where it deliberately does not

At the **mapper**. The CLI is a leaf consumer with a declared `string | null`, so
it is the side that owes the canonical spelling; the form follows the
`occurredAt` mapper already in `packages/metadata-protocol/src/protocol.ts`.

Not on the producer side: giving the driver one presented shape per dialect at
the read door would repair this site for free, but it reverses a deliberate
driver decision (`SqlDriver.withPostgresCalendarDayAsText`) and is a maintainer
call on the #13973 census as a whole. Zero driver files are touched here. And not
a `??` fallback — per #13973's standing prohibition the question is which side
owes the canonical spelling, and a tolerant fallback answers it by hiding it.
