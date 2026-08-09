---
"@objectstack/driver-sql": patch
---

fix(driver-sql): a merge-path `upsert` no longer rewrites an existing row's autonumber (#7011)

Measured on a completely healthy counter, single row throughout:

```
create                      → CASE-00001    last_value 1
upsert same id (1st time)   → CASE-00002    last_value 2
upsert same id (2nd time)   → CASE-00003    last_value 3
```

`fillAutoNumberFields` reserves a number before the statement knows whether it
will insert or merge, and the autonumber column sat in `mergeColumns` — so
every `ON CONFLICT … DO UPDATE` wrote the freshly reserved number over the
row's existing one, silently replacing an externally visible business
identifier the caller never asked to change.

Per the triage ruling on the card: an autonumber is an **immutable business
identifier once assigned**. `auto_number` columns are now excluded from the
merge column list, exactly like `created_at` (both are insert-only facts about
the row's birth). After the fix the same sequence keeps `CASE-00001` through
both upserts. The exclusion is unconditional — an explicit autonumber value in
the upsert payload does not renumber an existing row on the merge branch
either; `update()` writes what it is given and remains the deliberate
renumbering path. Insert-path upserts still assign fresh numbers, and every
non-autonumber column (including `updated_at`) merges as before.

Deliberately out of scope (#6943's reseed family): the reservation itself still
happens before insert-vs-merge is known, so a merge-only upsert still consumes
one sequence value per call — now a permanent gap in the sequence rather than a
rewrite of the row (measured post-fix: row keeps `CASE-00001`, `last_value`
walks 1 → 2 → 3, the next inserted row gets `CASE-00004`).

Covered faces: `SqliteWasmDriver` inherits `upsert` unchanged; `TursoDriver`
local/replica routes its override to `super` — both pinned by their own tests.
Turso remote (`RemoteTransport.upsert`) never enters `fillAutoNumberFields` and
has neither the defect nor the fix. Rows already renumbered by past merges
cannot be restored from the driver side.
