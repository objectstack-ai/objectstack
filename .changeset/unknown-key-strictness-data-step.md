---
"@objectstack/spec": minor
---

Hooks and datasources reject unknown keys (#4001 data step).

Closes the last two entries in the strictness ledger that still carried a
provisional classification. Both were confirmed authorable the same way: they sit
in `BUILTIN_METADATA_TYPE_SCHEMAS`, so one shape backs `defineStack()` parsing,
`/api/v1/meta/types/:type`, and the Studio form.

Now strict:

- `HookSchema` + its `retryPolicy`, and both hook-body branches
  (`ExpressionBodySchema`, `ScriptBodySchema`). A misspelt `capabilities`
  stripped to the empty default and the sandbox threw at invocation time instead
  of at parse; a misspelt `timeoutMs`/`memoryMb` silently downgraded the body to
  the enclosing hook's limits.
- `DatasourceSchema` + `pool` / `healthCheck` / `ssl` / `retryPolicy`,
  `ExternalDatasourceSettingsSchema` + its `validation` block,
  `DatasourceCapabilities`, and `DriverDefinitionSchema`.

Deliberately still tolerant:

- `HookContextSchema` and its `session` / `provenance` / `user` blocks — the
  runtime shape the engine hands a handler. Strictness there would turn an
  engine-internal enrichment (as `provenance` was in #3712) into a breaking
  change for anyone parsing a context they were given.
- `datasource.config` and `readReplicas` — per-driver by construction; the
  driver's own `configSchema` validates them.

Errors are self-fixing: connection keys written one level too high (`host`,
`port`, `filename`, `url`, …) are prescribed into `config`; a top-level
`password` is pointed at `external.credentialsRef` rather than merely relocated;
and the two near-miss spellings that cross between shapes carry aliases
(hook-level `timeout` vs body-level `timeoutMs`; hook `retryPolicy.backoffMs` vs
datasource `retryPolicy.baseDelayMs`).

Note for anyone reading the earlier steps: strictness does not change the
published JSON Schema. `build-schemas.ts` converts with `io: 'output'`, where zod
emits `additionalProperties: false` for `.strip()` objects too — verified by
regenerating both ways (`Datasource.json` is byte-identical). The JSON Schema was
already advertising `additionalProperties: false` while the parse silently
dropped keys; this aligns the parse with the published contract.
