---
'@objectstack/spec': minor
---

fix(spec)!: an object's `external` binding on a managed datasource is refused at the parse and by `defineStack`, as ADR-0015 §4.2 declares

Clause-②: no (narrowing)

Metadata-protocol: narrowed

<!-- adr-0087: registered object-external-binding-managed-datasource-refused -->

**BREAKING** (what an author can declare narrows), shipped as `minor` under the launch-window convention for breaking changes.

ADR-0015 §4.2 allows `object.external` only on a datasource whose `schemaMode` is not `'managed'`, and declares the rule "enforced at metadata-load time". No load door enforced it: `defineStack`, `os validate` and the object save door (`PUT /api/v1/meta/object/NAME`) all accepted an `external` binding on a managed datasource, the primary `default` included. The runtime then disagreed with itself about such an object: its schema sync treated it as federated and never created its table, while the boot validation skipped it and the write gate exempted it because its datasource is managed.

- **FROM:** an object declaring `external` was accepted whatever its datasource: `datasource` omitted or `'default'`, or a datasource declared with `schemaMode: 'managed'` or with no `schemaMode`.
- **TO:** the rule is judged where each half is visible.
  - An `external` binding whose object `datasource` is `'default'` (also the value when none is written) is refused by `ObjectSchema`'s parse at `external`: `ObjectSchema.create` throws at module load, `defineStack` and `os validate` refuse with `STACK_SCHEMA_INVALID` (422), and the object save door answers `422 INVALID_METADATA` and stores nothing. The platform's primary datasource is managed by construction.
  - An `external` binding on a datasource the same stack declares with `schemaMode: 'managed'`, or with no `schemaMode`, is refused by `defineStack` (and so `os validate` and `os build`) with `STACK_CROSS_REFERENCE_INVALID` (422), one finding per object.
  - A package `defaultDatasource` or a `datasourceMapping` rule does not make an object federated: they route its queries, while the boot validation and the write gate read the object's own `datasource`.
- **Unchanged:** a binding on a datasource declared `schemaMode: 'external'` or `'validate-only'` is accepted. A binding on a datasource the stack does not declare (registered by the host or another package, or stored at runtime) gets no verdict at these doors, because they cannot see its `schemaMode`. `defineStack(config, { strict: false })` skips the stack-level judgement by contract. A stored object row in the refused shape still registers, under a `[metadata_spec_invalid]` diagnostic, and its next save is refused; `os migrate meta --stored` lists each such row under `object-external-binding-managed-datasource-refused`.
- **The fix for an author:** set the object's `datasource` to the datasource that holds the remote table and declare that datasource with `schemaMode: 'external'` (or `'validate-only'`) and its `external` settings, for example `datasource: 'warehouse'` beside `defineDatasource({ name: 'warehouse', schemaMode: 'external', external: { … } })`. An object whose rows ObjectStack should own drops `external` instead.
