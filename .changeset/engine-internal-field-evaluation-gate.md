---
'@objectstack/spec': patch
'@objectstack/objectql': patch
'@objectstack/metadata-protocol': patch
'@objectstack/runtime': patch
'@objectstack/mcp': patch
---

fix(objectql)!: the engine refuses filtering, sorting, grouping and aggregating on an `internal: true` field for every caller but a system context

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and nothing an author writes is refused: the `internal: true` flag is read as before. The narrowing is a runtime one, on reads made as a user: a query that evaluates a flagged field answers 400 INVALID_FIELD from the engine itself, with the data door's sentence. The published type change adds a member to the `objectql` slot contract and is satisfied by the one implementer, ObjectQL. There is nothing for `objectstack migrate meta` to rewrite and no tombstone; the remedy is the refusal's own sentence (use another field), or running the server's own read as a system context. -->
Skills-docs: updated here — `content/docs/permissions/system-context.mdx` (row 18e: the engine's read path) and `content/docs/api/error-catalog.mdx` (`INVALID_FIELD`) state who is refused and who is served; no file under `skills/**` teaches filtering on an `internal: true` field, so no skill line changes.

**BREAKING** for one shape only: server code that reads the engine as a user (not as a system context) and filters, sorts, groups or aggregates on a field declared `internal: true`.

- FROM: the engine ran such a read.
- TO: the engine refuses it with the data door's `400 INVALID_FIELD`, naming the object, the field and the position, before anything is read. A read made as a system context (`isSystem: true`) is served as before, and the flagged column is still never returned on a row.

What to do: run a server-side lookup that matches on a flagged field as a system context, or match on another field.

- **`@objectstack/objectql`**: the `internal: true` evaluate refusal is defined once, in the engine. `find`, `findOne`, `count` and `aggregate` apply it to every caller but a system context, in every position the data door judges: a filter (including a relation hop and a `$field` comparand), a sort, a group key, an aggregation operand and an aggregation's own filter, and the same positions inside `expand`. `ObjectQL#assertNoInternalFieldEvaluated` answers the same question for any caller, for a door that judges before it reads.
- **`@objectstack/spec`**: new types on the `objectql` slot contract: `QueryEvaluationGate`, `InternalFieldEvaluationQuery` and `InternalFieldEvaluationOptions`. `IObjectQLEngine` extends `QueryEvaluationGate`.
- **`@objectstack/metadata-protocol`**: the data door asks the engine's refusal instead of keeping its own copy. Its answers are unchanged.
- **`@objectstack/runtime`**: the HTTP MCP data bridge asks the engine's refusal directly. Its answers are the data door's.
- **`@objectstack/mcp`**: the stdio data bridge's own copy of the refusal is retired in favour of the engine's. Its answers are the data door's.

The level is patch rather than the minor a new spec type would take: the changeset gate refuses `minor` beside `Metadata-protocol: none`, and nothing an author writes is refused.
