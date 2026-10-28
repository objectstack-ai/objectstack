---
'@objectstack/spec': minor
'@objectstack/service-automation': minor
---

fix(spec)!: `QuerySchema.fields` (and so every nested `expand` entry) and the flow `get_record` node's `fields` refuse an empty projection, as every other published projection declaration and the in-process engine do (#27166)

Clause-②: no (narrowing) — two published declarations of a read's projection, `QuerySchema.fields` (the QueryAST, which is also the value type of every `expand` entry, `EngineQueryOptionsSchema.expand` included, and the canonical `fields` of the transport-aware query slot) and `GetRecordConfigSchema.fields` (the flow `get_record` node), refuse a list naming no field, which they admitted before. Nothing is widened and no key is added, removed or renamed.
Metadata-protocol: narrowed
Skills-docs: none — `skills/**` teaches `fields` and nested `expand` `fields` only as non-empty lists (`skills/objectstack-query/SKILL.md`, the `expand` value row and the nested-expand example), and teaches the `get_record` node without `fields` (`skills/objectstack-automation/SKILL.md`); no file teaches an empty projection, and every taught use stays true.

<!-- adr-0087: registered query-and-get-record-empty-projection-refused -->

**BREAKING** for a flow `get_record` node, or a query you build, that carries an empty projection. The in-process engine already refuses `fields: []` at its `find` / `findOne` entry, top level and at any `expand` depth; these two declarations still admitted it, so such a `get_record` node saved clean and failed at its first run.

- **Before.** `QuerySchema.fields` and `GetRecordConfigSchema.fields` admitted any list of strings: `[]`, and a list with a blank or whitespace-only name. A `get_record` node with `fields: []` passed `os validate`, `defineStack` and `registerFlow`, and its run failed with the engine's refusal. A `POST /data/:object/query` body with `fields: []` was refused by the Data API's normalizer (`400 VALIDATION_ERROR`).
- **Now.** A list must hold at least one name, and no name may be blank (JSON Schema `minItems: 1`, and a non-blank pattern on each name). Both read the rule from the declaration `EngineQueryOptionsSchema.fields` and `QueryTransportParamsSchema.$select` read, so the refusal says the same thing: "Name at least one field", or "A field name cannot be blank" for a blank member. A `get_record` node with `fields: []` is refused where a flow is saved or registered, at `flows.N.nodes.M.config.fields` (`STACK_SCHEMA_INVALID` from `defineStack`), and its executor refuses the config before any read. An `expand` entry with `fields: []` is refused at `expand.<field>.fields`. A `POST /data/:object/query` body with `fields: []` is now refused by the body schema, `400 VALIDATION_FAILED` at `query.fields`, which is the answer its `$select: []` spelling already got.
- **`@objectstack/service-automation`.** The `get_record` node's designer form (`configSchema`) declares `fields` with `minItems: 1`, as its `limit` already mirrors the contract's floor, so the form no longer offers an empty list the save refuses.
- **Unchanged.** The inferred types (`string[]`), a named projection, and leaving `fields` out to read every column. Stored flows are not rewritten.

**The remedy.** Name the fields to read, or remove `fields` to read every field; on an `expand` entry, the same for the related record. There is no mechanical rewrite: dropping the key reads every column, which is the widening the rule refuses, so the choice is the author's.
