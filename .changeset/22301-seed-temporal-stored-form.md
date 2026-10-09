---
'@objectstack/metadata-protocol': patch
---

A cel-dated seed row reaches every hook in the stored form of its temporal field

Clause-②: no

`` cel`daysFromNow(n)` ``, `daysAgo(n)`, `today()` and `now()` in a seed record resolve to a JS `Date`. The seed loader handed that `Date` to the engine, so what a hook saw depended on how the hook ran:

- An in-process `handler` (a source config, which `@objectstack/verify`'s `bootStack` boots) saw the `Date` object.
- A sandboxed `body` (the compiled artifact `objectstack dev` boots) saw a full ISO instant, even on a `date` field.

A hook that reads a date field as a string therefore accepted the row under `objectstack dev` and refused it under `bootStack`, and the row was not stored.

The loader now puts each `Date` on a `date`, `datetime` or `time` field into the stored form the drivers write (`YYYY-MM-DD`, the UTC ISO instant, `HH:MM:SS`) before any hook runs, so every hook sees the value the column stores. A body hook on a `date` field now sees `2026-10-09` where it saw `2026-10-09T00:00:00.000Z`. Stored values do not change on any driver, because each driver already normalises a declared temporal field on write (`@objectstack/driver-memory` through the same `temporalStorageForm`). A `Date` on a field that is not temporal, or on a field the object does not declare, is handed over unchanged.
