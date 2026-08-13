---
"@objectstack/rest": patch
---

fix(rest): exported `datetime` cells render in the business timezone, not UTC (#8373)

`GET /api/v1/data/{object}/export` formatted every `datetime` column with
`getUTC*`, while the UI rendered the same field in the business timezone. The
whole file was therefore off by the tenant's offset, on **every** export format
— and the harm was not "a few hours out". A record the screen showed at
`2026/8/1 06:00` (+08) landed in the file as `2026-07-31 22:00:00`: the row left
August. A downstream deployment's monthly reconciliation stopped balancing on
exactly that, and because `getUTC*` ignores the process `TZ`, no deployment-side
setting could work around it.

The timezone was already resolved on this path and simply never threaded. The
export route opens with `resolveExecCtx`, whose `ExecutionContext` carries
`timezone` from the platform-default → global → tenant localization cascade; the
formatting layer just never asked for it. It now does, reading the calendar
components through `Intl.DateTimeFormat(…, { timeZone })` so DST comes from the
platform tz database rather than hand-rolled offset arithmetic. This brings the
export formatter into line with the ADR-0053 business-timezone semantics that
autonumber date tokens already follow.

Fixed on all three output formats — CSV, XLSX and JSON — which share one
formatter; the reported symptom reproduced on CSV and XLSX alike.

**Nothing changes without a resolved timezone.** No `timezone` on the context (or
one this platform does not recognise) keeps the previous UTC rendering, byte for
byte, so a deployment that never configured one sees the same files as before.

**`date` columns are deliberately untouched.** Under ADR-0053 a `date` is a
timezone-naive calendar day — `@objectstack/driver-sql`'s `toDateOnly` is the
source of truth and the filter, write and read paths all agree with it.
Projecting a date-only value through a zone would move `2026-08-01` to
`2026-07-31` for every deployment west of UTC, inventing the off-by-one-day
defect that ADR decision exists to remove. Only `datetime`, which ADR-0053
defines as an instant rendered in a reference timezone, follows the business
zone.
