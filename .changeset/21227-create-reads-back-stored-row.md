---
'@objectstack/driver-sql': patch
---

On MySQL, `SqlDriver.create` and `SqlDriver.bulkCreate` now answer the rows they stored (#21227).

Clause-②: no

MySQL has no `INSERT … RETURNING`. knex drops the clause on the MySQL family and answers the insert id instead, so `create` answered `0` and `bulkCreate` answered a one-element array whatever the row count, although every row was stored. Callers that use the answer failed one layer up: on a MySQL datasource, sign-up answered `400 FAILED_TO_CREATE_USER` with the user stored and no account, the dev admin seed failed, and a multi-row `bulkCreate` through the engine was refused after its rows had landed.

On the MySQL family both doors now read the rows back by the ids they wrote, under the tenant the rows were written with, inside the caller's transaction when there is one: one extra `SELECT` per `create` and per `bulkCreate` batch. SQLite and PostgreSQL still answer from `RETURNING`, with no extra statement and no change in what they answer. If a written row is gone before it can be read back (deleted in between by another statement or a trigger), the call throws `DATABASE_ERROR` (500) and does not retry the insert.

Nothing to change in a project. Code that read the record from the result now gets it on MySQL as on the other dialects.
