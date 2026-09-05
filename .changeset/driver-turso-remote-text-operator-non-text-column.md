---
"@objectstack/driver-turso": minor
---

The remote transport compiles a text operator over a declared numeric or boolean column to the contract's declared answer, in step with the local transport.

`RemoteTransport.buildWhereSQL` compiles filters independently of `SqlDriver` and keeps no schema, so a text operator over a `Field.number` used to compile `"col" GLOB ?` and coerce the REAL in the storage class's spelling (`5` as `'5.0'`). `TursoDriver` now hands the transport its declared-type rule (`setNonTextColumnResolver`, the same shape as the temporal `setFilterColumnSql` rule), answered from the registries `registerRemoteFieldMetadata` already fills at schema sync — so a positive text operator over such a column compiles to `1 = 0` and `$notContains` to `1 = 1` on BOTH transports (`FILTER_TEXT_CASES`' `score` rows, maintainer ruling 2026-09-05), instead of a dialect accident. A transport nobody handed the rule to compiles exactly as before, and every comparand refusal still runs ahead of the constant.
