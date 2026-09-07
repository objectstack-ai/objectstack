---
"@objectstack/objectql": minor
---

Three more engine refusals publish their error `code` as an importable constant.

Each of these classes already tells the reader, in its own docblock, that it is *"Identified by `code` rather than `instanceof` so it survives crossing package boundaries"* — and none of them offered anything to import. The only way to FOLLOW that published instruction was to re-spell the wire string in your own package, which acquires a `check:error-code-provenance` stamp site there and can then drift from what the engine throws with no compile error to say so.

Three new exports from `@objectstack/objectql`, each graded on its own:

- `DRIVER_CONNECT_CODE` — `DriverConnectError`'s ADR-0112 `code`. Thrown by `ObjectQL.init()` when boot-registered drivers fail to connect, which aborts kernel bootstrap. **Additive widening, `minor`.**
- `DATASOURCE_UNAVAILABLE_CODE` — `DatasourceUnavailableError`'s ADR-0112 `code`. Thrown by `getDriver()` when an object's datasource was declared but has no live driver. **Additive widening, `minor`.**
- `SUMMARY_RECOMPUTE_CODE` — `SummaryRecomputeError`'s ADR-0112 `code`. Thrown by `insert`/`update`/`delete` when parent roll-up summaries fail to recompute *after the triggering records were written*. **Additive widening, `minor`.**

**The cost these close is already shipped, not hypothetical.** Three first-party packages in this repo match these refusals by `code` today and therefore carry a second spelling of the string: `packages/rest/src/error-response.ts` (datasource-unavailable), `packages/rest/src/import-runner.ts` and `packages/metadata-protocol/src/seed-loader.ts` (summary-recompute — both to implement the documented "the records WERE written, treat it as a warning" recovery). They keep working unchanged; they can now import the constant instead of authoring the string.

**Why `code` and not `instanceof`.** This package declares both realms in its own `exports` (`import` reaches `dist/index.mjs`, `require` reaches `dist/index.js`), so a consumer holding the other realm's copy of a class gets `instanceof` === false — measured, and silent. A `code` compare is the check that survives that boundary, which is what these docblocks have been telling readers to do.

**Nothing about the wire changed.** Each constant holds text byte-identical to the literal it replaces; every refusal throws the same `code` and the same message as before. Consumers that spell the strings themselves keep working unchanged — this adds affordances, it removes nothing.

**All three classes were already exported and stay exported.** The constants join them on the batteries barrel; like every other `*_CODE` in this package they are deliberately not added to the lean `core.ts` entry, even though `DriverConnectError` and `DatasourceUnavailableError` themselves are published there. That asymmetry is #16260's subject for the whole family and is not decided here.
