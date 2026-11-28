---
'@objectstack/skills': patch
---

docs(skills): `objectstack-data` states the bounds of a hook transaction, and the measured MongoDB and PostgreSQL rule

Clause-②: no
Metadata-protocol: none

`skills/objectstack-data/references/data-hooks.md`, the `api.transaction` row: `ctx.api.transaction` goes one level per body (a nested call is refused, "nested ctx.api.transaction is not supported"); inside an open unit it joins it, including a unit an action body opened with its own `ctx.api.transaction`, and the hooks of a write made inside that unit run in it and join it too; a write to another datasource is refused except an append-only ledger (`lifecycle.class` `audit` / `telemetry` / `event`), written outside the unit; on PostgreSQL and a MongoDB replica set a failed statement aborts the whole unit even when caught; a driver with no transactions runs the callback with none and no warning.

The `before*` Transaction cell drops "MongoDB needs a replica set (read in code, not measured)" for the measured rule: a standalone MongoDB refuses every write of such a transaction (`501 NOT_IMPLEMENTED`) and a single-node replica set is enough; on PostgreSQL and a MongoDB replica set a failed `ctx.api` statement refuses the outer write even when caught, logged or retried (`25P02` / `251`), while SQLite lets it through. Two eval cases in `skills/objectstack-data/evals/hooks-security-seeds-datasources.json` expect the same.

Nothing an author can write changes. The page stays at its token ceiling (10120): the added sentences are paid by cutting restating code comments and labels in the same file.
