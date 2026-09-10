---
"@objectstack/metadata-protocol": patch
"@objectstack/objectql": patch
"@objectstack/cli": patch
---

docs(metadata-protocol,objectql,cli): comments describing the standalone stamp now name `env_local`, the value the tree actually produces

The v5.0 `project` to `environment` rename reached the two remaining stamps in `@objectstack/runtime` and `@objectstack/metadata` in a previous release: `createStandaloneStack` and `MetadataPlugin` both stamp **`env_local`**. Six comments in three other packages still described that stamp as `'proj_local'`, so they named a value nothing in the tree produces any more.

No behaviour changes. The reason this is a `patch` rather than a no-publish diff is measured, not assumed: two of the six sites are TSDoc on **exported** interface members (`AssembleMetadataProtocolOptions.runPlatformMigrations`, `ObjectQLPluginOptions.runPlatformMigrations`) and land in the shipped `dist/*.d.ts`, and the `@objectstack/cli` site lands in the shipped `dist/utils/schema-migrate.js` because that package builds with `removeComments` unset. All three packages ship `dist` in `files[]`, so the corrected text is what an author reads on hover after upgrading.

The sites were judged individually rather than search-and-replaced, because they are not all the same edit:

- Five sites whose verb describing the stamp is present indicative describe today's tree — two of them point the reader at `runtime/src/standalone-stack.ts` to go and look — and take the current spelling.
- `packages/cli/src/utils/schema-migrate.ts` names `'proj_local'` as the value the historical arming deduction consumed. There the literal is preserved as history and its present-tense relative clause moves into the past, with today's spelling named beside it; rewriting it to `env_local` would have falsified the record in the other direction.

The causal claim at every site is about **presence**, not spelling: the retired gate read `environmentId === undefined`, so it would have misfired identically under either literal. That reading is preserved at all six.
