---
"@objectstack/driver-sql": patch
---

`SqlDriver.distinct()` now answers **one unresolvable column the way the other three read doors do** — a `400` that names it — instead of a `DATABASE_ERROR` / `500` server fault.

The same condition (a column name the table does not have) asked at four doors used to get three answers and one server fault. Measured on `origin/main` at `dbea1756d9`, embedded SQLite, and identical on live PostgreSQL 16.13:

| door | before | after |
|:--|:--|:--|
| `count(t, { where: { nosuchcol: 1 } })` | `INVALID_FILTER` / 400 | unchanged |
| `find(t, { where: { nosuchcol: 1 } })` | `INVALID_FILTER` / 400 | unchanged |
| `aggregate(t, { groupBy: ['nosuchcol'] })` | `INVALID_FIELD` / 400 | unchanged |
| `distinct(t, 'title', { nosuchcol: 1 })` | **`DATABASE_ERROR` / 500** | **`INVALID_FILTER` / 400** |
| `distinct(t, 'nosuchcol')` | **`DATABASE_ERROR` / 500** | **`INVALID_FIELD` / 400** |

A caller's own mistake — a field name that does not exist — was served as a server fault naming nothing they could act on, one door away from a `400` that names the column. A picklist-populating `distinct()` sits beside the `find()` and `count()` of the same list view.

**Attribution comes from the caller's own request, never from the backend's prose.** The dialect names the column but not the clause, so the clause is read off the call this driver just compiled — the shape `aggregateBackendFault` established for `aggregate()`:

1. the name **equals the `field` argument** ⇒ `INVALID_FIELD` / 400 naming the listed column, with the `field` and `object` riders the ingress door's refusals carry;
2. it does not ⇒ the statement's only remaining column sources are the WHERE compiled from `filters` and the tenant-scope predicate, both filters, so the existing `INVALID_FILTER` refusal applies verbatim — the same sentence `find()` and `count()` give;
3. the dialect wording yields **no name** ⇒ no attribution is supportable and the terminal `DATABASE_ERROR` / 500 envelope stands unchanged.

Arm 2 is the **complement** of arm 1 rather than a search of the `filters` AST, which keeps a nested filter (`{ $or: [{ nosuchcol: 1 }] }`) on the same `400` as a flat one.

⛔ **No input that was refused before is accepted now, and no exported symbol moves.** The call fails either way; what changes is the refusal's code, status and words. No error code is minted — `INVALID_FIELD` is a standard-catalog member (ADR-0112) and already this repo's answer for a named column an object does not have. No new dialect recognizer is added: both predicates are the ones `find()`, `count()` and `aggregate()` already share.

A caller that branched on `DATABASE_ERROR` / `500` for a mistyped `distinct()` field or filter key now sees `INVALID_FIELD` / `INVALID_FILTER` `400`s instead; that is the point of the change, and it matches what the same mistake already returned from every other read door.
