---
'@objectstack/spec': minor
'@objectstack/service-automation': minor
---

fix(spec)!: `QuerySchema.fields` (and so every nested `expand` entry) and the flow `get_record` node's `fields` refuse an empty projection, as every other published projection declaration and the in-process engine do (#27166)

Clause-②: no (narrowing) — two published declarations of a read's projection, `QuerySchema.fields` (the QueryAST, which is also the value type of every `expand` entry, `EngineQueryOptionsSchema.expand` included, and the canonical `fields` of the transport-aware query slot) and `GetRecordConfigSchema.fields` (the flow `get_record` node), refuse a list naming no field, which they admitted before. Nothing is widened and no key is added, removed or renamed.
Metadata-protocol: narrowed
Skills-docs: none — `skills/**` teaches `fields` and nested `expand` `fields` only as non-empty lists (`skills/objectstack-query/SKILL.md`, the `expand` value row and the nested-expand example), and teaches the `get_record` node without `fields` (`skills/objectstack-automation/SKILL.md`); no file teaches an empty projection, and every taught use stays true.

<!-- adr-0087: registered query-and-get-record-empty-projection-refused -->

**BREAKING** for a flow `get_record` node, or a query you build, that carries an empty projection. In this same release the in-process engine starts refusing `fields: []` at its `find` / `findOne` entry, top level and at any `expand` depth; without this change the two declarations below would still admit it, so such a `get_record` node would save clean and fail at its first run.

- **Before (`@objectstack/spec@18.2.0`, the last release).** `QuerySchema.fields` and `GetRecordConfigSchema.fields` admitted any list of strings: `[]`, and a list with a blank or whitespace-only name. A `get_record` node with `fields: []` passed `os validate`, `defineStack` and `registerFlow`, and its run read every column of the row. A `POST /data/:object/query` body with `fields: []`, top level or on an `expand` entry, answered `200` with every column.
- **Now.** A list must hold at least one name, and no name may be blank (JSON Schema `minItems: 1`, and a non-blank pattern on each name). Both read the rule from the declaration `EngineQueryOptionsSchema.fields` and `QueryTransportParamsSchema.$select` read, so the refusal says the same thing: "Name at least one field", or "A field name cannot be blank" for a blank member. A `get_record` node with `fields: []` is refused where a flow is saved or registered, at `flows.N.nodes.M.config.fields` (`STACK_SCHEMA_INVALID` from `defineStack`), and its executor refuses the config before any read. An `expand` entry with `fields: []` is refused at `expand.<field>.fields`. A `POST /data/:object/query` body with `fields: []` is refused by the body schema, `400 VALIDATION_FAILED` at `query.fields`, which is the answer its `$select: []` spelling gets; an `expand` entry's `fields: []` in that body is refused the same way, at `query.expand.<field>.fields`.
- **`@objectstack/service-automation`.** The `get_record` node's designer form (`configSchema`) declares `fields` with `minItems: 1`, as its `limit` already mirrors the contract's floor, so the form no longer offers an empty list the save refuses.
- **Stored flows.** They are not rewritten, and there is no conversion for `os migrate meta --stored` to apply. A stored flow whose `get_record` node carries `fields: []` is refused by `registerFlow` on every pull of the stored definitions, so it stays unregistered, and its triggers unbound, until the row is edited: name the fields, or remove the key.
- **Unchanged.** The inferred types (`string[]`), a named projection, and leaving `fields` out to read every column.

**Supersedes, in the same release:** `26954-engine-projection-empty.md` says, under **Unchanged**, that the in-process ObjectQL engine does not parse its options with that schema and that `engine.find(object, { fields: [] })` still reads every column, as before. The engine change in this release (`27008-engine-empty-projection-refused.md`) refuses that call at its `find` / `findOne` entry, so that sentence no longer holds: an empty projection is refused by the declarations and by the engine alike, and leaving `fields` out is the one way to read every column.

**The remedy.** Name the fields to read, or remove `fields` to read every field; on an `expand` entry, the same for the related record. There is no mechanical rewrite: dropping the key reads every column, which is the widening the rule refuses, so the choice is the author's.
