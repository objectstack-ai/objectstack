---
"@objectstack/core": patch
"@objectstack/rest": patch
---

fix(rest): read an offset-free import cell in the business timezone, not the host `TZ` (#8485)

`parseDateCell` ended in `new Date(s)`. A spreadsheet cell like
`2026-08-01 06:00:00` carries no offset, so ECMAScript resolves it against the
**process** timezone, and the instant bulk import stored became a property of
the deployment host:

```
TZ=Asia/Shanghai → 2026-07-31T22:00:00.000Z
TZ=UTC           → 2026-08-01T06:00:00.000Z
```

Same file, same tenant, same cell — eight hours apart, decided by a setting
nobody authoring the spreadsheet can see, and never consulting the business
timezone the route had already resolved one frame up
(`ExecutionContext.timezone`, the platform-default → global → tenant cascade).

Since the export renders `datetime` cells in that business timezone (#8373), the
advertised export → edit in a spreadsheet → re-import round trip was lossless
only where the host `TZ` happened to equal the business zone. `import-coerce.ts`
opens by calling itself "the inverse of `export-format.ts`"; it now is one, and
the regression proof asserts inverse-ness on the **pair** — every fixture under
a host `TZ` deliberately different from the business timezone, because a test
that runs only under a matching `TZ` cannot fail.

**An offset-free datetime cell is now read in the caller's business timezone**,
through `@objectstack/core`'s new `zonedWallClockToUtcMs` — the DST-safe wall
clock → instant primitive that `zonedDateStartToUtcMs` (the date-bucket drill
path) is now the midnight special case of. One implementation of zone
arithmetic, `Intl` offsets from the platform tz database, never hand-rolled;
generalising the existing one rather than hand-rolling a second in `rest` is
what keeps the export and import halves of this seam from drifting apart again.
Two wall clocks are not a bijection with instants, and both degenerate DST
readings resolve to the earlier candidate instant — a gap reading lands just
before the gap, an ambiguous reading on its first occurrence (pinned, measured).

Three things deliberately do **not** move:

- **A cell that carries an explicit offset** (`…Z`, `…+08:00`) already names one
  instant and is honoured exactly as written. This change affects naive cells
  only.
- **The date-only fast path stays UTC.** `YYYY-MM-DD` is UTC per ECMAScript and
  a `date` is a timezone-naive calendar day (ADR-0053); sweeping it into the
  zoned handling to make the code look uniform would silently re-time every
  date-only import to fix nothing.
- **No timezone resolved ⇒ UTC**, never the process clock. That is the fallback
  the export's cell path takes in the same case, so the round trip stays exact
  for deployments that configure no zone — and a process-`TZ` fallback would
  preserve the defect for exactly the deployments that cannot see it. This is
  the one **behaviour change for existing deployments**: a host with a non-UTC
  `TZ` and no resolved business timezone previously read naive cells in the host
  clock and now reads them as UTC. An explicitly resolved `'UTC'` is a resolved
  zone, not a missing one.

Two adjacent legs of the same defect, both on the naive-cell path:

- **A naive cell landing in a `date` or `time` field** now takes the typed
  components verbatim (`2026-08-01 06:00:00` → `2026-08-01` / `06:00:00`).
  Those branches also read the process clock, so a host east of the cell stored
  the *previous calendar day* for a `date` column.
- **An xlsx date cell.** An Excel serial date carries no timezone; ExcelJS
  materialises it as a `Date` whose UTC components are the sheet's wall clock,
  and `import-prepare.ts` rendered it with `toISOString()` — stamping a `Z` the
  file never had. That fabricated offset then outranked the business timezone by
  the very carve-out above, so every real date cell in a user-authored workbook
  imported as UTC whatever the tenant's zone. It now flattens to the same
  offset-free `YYYY-MM-DD HH:mm:ss` a CSV export writes, which is what that
  function's contract already claimed to produce.
