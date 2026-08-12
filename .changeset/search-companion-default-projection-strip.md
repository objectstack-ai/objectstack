---
"@objectstack/objectql": patch
---

fix(objectql): strip the hidden `__search` companion column from every record body (#7642)

The `__search` search-normalization companion (#2486) is declared invisible to
clients — `hidden` + `readonly` + `system` + `searchable: false` — and every one
of those flags does something real: the column stays out of auto-views, out of
the `$search` auto-default, and a `$searchFields` override naming it is refused
with a 400 ("is hidden"). None of them is a **projection** rule. A query that
names no `fields` reaches the driver with `ast.fields` undefined, drivers answer
that with `SELECT *`, and the column rode back in the four record bodies a QA
run measured (#7629): list/query results, `GET /data/:object/:id`,
`GET /api/v1/search` hits, and the 201 create body.

The strip now runs at the engine, which is the producer all four surfaces share
(`/search` hits are `engine.find` rows verbatim; the create body is
`engine.insert`'s return verbatim). Fixing them one consumer at a time is how
three of the four would have stayed broken. `find`, `findOne`, the nested
records `expand` produces, the create response and the **update** response are
all covered; the update response is not one of the four reported surfaces but is
the same column in the same response shape, and leaving it out would have made
POST and PATCH on one object disagree about whether a client-invisible column is
visible. A predicate update resolves to an affected-row count and is unaffected.

Two details the fix is shaped around, both from the report:

- **It is not gated on the schema declaring the column.** The symptom survived a
  restart with `OS_SEARCH_PINYIN_ENABLED=false`, and that is not a stale process:
  with the switch off the registry stops declaring the field, but the physical
  column and its values remain (ADR-0045 migrations are additive) and `SELECT *`
  keeps returning them. A strip that asked `schema.fields.__search` first would
  be silent in exactly the deployment that reported the bug, so the key on the
  row is the signal.
- **One caller keeps its read.** `plugin-pinyin-search`'s backfill/reconcile walk
  projects `['id', …sources, '__search']` under a system context and compares the
  stored blob against a recomputed one; stripping that unconditionally would make
  it rewrite every row of every object on every pass. A **system** caller that
  names the column in `fields` still gets it. A non-system caller does not, even
  by name — `select` only gates on whether a field is *known*, so `?select=__search`
  would otherwise be a documented way straight through the strip.

Scope is this one column. Hidden system columns do come back generally
(`organization_id` and its siblings), but they are load-bearing in client
payloads today; removing them is a contract decision, not a defect fix.

New exports from `@objectstack/objectql`: `stripSearchCompanion` and
`isSearchCompanionRequested`.
