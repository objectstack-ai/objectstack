---
"@objectstack/objectql": patch
---

`ObjectQLPluginOptions.skipSchemaSync`'s TSDoc no longer presents `apps/cloud/scripts/migrate.ts` as a path in this repository.

The option's docblock names a concrete script as the out-of-band DDL example:

```ts
   * assume DDL is managed out-of-band (e.g. an `apps/cloud/scripts/migrate.ts`
   * run before deploy that connects directly to the database and creates
   * all `sys_*` + custom tables once).
```

`apps/cloud` was deleted from this repository — the reference cloud host now lives in `objectstack-ai/cloud` — so an unmarked present-tense mention sends a reader looking for a script that is not in the tree they cloned. The referent is genuine, so the sentence is marked rather than re-pointed or deleted.

This ships to consumers: the docblock is emitted into `dist/index.d.ts` and `dist/index.d.mts`, both of which are in the published tarball (`files: ["dist", "README.md", "CHANGELOG.md"]`), so it is the text an IDE shows on `skipSchemaSync`.

The wording is copied from `packages/cli/src/commands/serve.ts`'s migrate-and-exit note, which names the same script and was already marked — the two sentences were written as a pair and only one of them had been swept.

No behaviour changes: the diff is comment text only. No exported symbol, signature, default or runtime path moves.
