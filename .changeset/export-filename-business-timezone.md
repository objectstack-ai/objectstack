---
"@objectstack/rest": patch
---

fix(rest): stamp the export download's filename in the business timezone (#8484)

`exportContentDisposition` built the `-YYYYMMDD-HHMMSS` half of the suggested
filename from process-local getters (`now.getFullYear()` / `getHours()` / …),
which read the deployment host's `TZ` — a hosting fact, not the caller's
business timezone. The route had already resolved that timezone one frame up
(`ExecutionContext.timezone`, the platform-default → global → tenant cascade)
and simply never passed it here.

After #8373 moved the export's **contents** onto the business timezone, the
filename was the last export surface still on the host clock, so the two
disagreed exactly when `TZ` was not the business zone: a container at `TZ=UTC`
serving an Asia/Shanghai tenant downloaded `orders-20260731-220000.csv` whose
first row read `2026-08-01 06:00:00` — off by a day, and at a month boundary by
a month. The name and the rows inside it now read one clock.

**The no-timezone fallback stays PROCESS-LOCAL, deliberately not UTC.** This is
the opposite of the cell path's UTC fallback, and the asymmetry is the point:
each fallback preserves the historical output of the surface it serves. The
cells were hardcoded to UTC before #8373; this filename has always used the
process clock. Defaulting it to UTC would look safer while silently re-timing
the filename of every deployment that sets a host `TZ` but resolves no business
timezone — a user-visible rename for zero correctness gain. An explicitly
resolved `'UTC'` is a *resolved* zone, not a missing one, and does produce a UTC
stamp regardless of the host.

The shared clock helper is split rather than parameterised with a default:
`zonedWallClock` now returns `null` when no usable zone resolves, and each of
the two callers supplies its own fallback at the call site where it can be read
and pinned. Baking either fallback into the shared helper would silently
re-time the other surface.

Filename **naming** is untouched — label selection, sanitization and the RFC
5987/6266 `filename*` encoding all behave exactly as before, and the export's
contents are not touched at all.
