---
'@objectstack/cli': minor
---

feat(cli): point `@objectstack/cli/console` at a public barrel with a name-and-shape pin

**BREAKING**: `@objectstack/cli/console` publishes three names instead of thirteen. Ten names it used to resolve no longer resolve through that subpath.

The subpath pointed straight at `dist/utils/console.js` — an internal module — and carried no surface pin of any kind, neither names nor shapes. Two assertions did exist and neither is one: `./console` was held among the declared `exports` keys, and the specifier was held to resolving from the packed tarball. Both answer *is the door open*; neither can answer *what is behind it*. So all thirteen of that module's top-level exports were public API, and every export it gained afterwards became a permanent public contract the moment it landed, silently.

The subpath stays open and now points at a dedicated barrel, `dist/console.js`, which re-exports by name (no star) exactly the three helpers the one ledgered out-of-repo consumer uses to mount the Console SPA:

- `resolveConsolePath`
- `hasConsoleDist`
- `createConsoleStaticPlugin`

Those three keep their existing shapes exactly, so a consumer importing only them compiles unchanged.

These ten are no longer reachable through `@objectstack/cli/console`:

- `CONSOLE_PATH`
- `ConsoleShaDrift`
- `DRIFT_OVERRIDE_ENV`
- `ResolveConsoleOptions`
- `createRuntimeAssetsPlugin`
- `decideConsoleMount`
- `detectConsoleShaDrift`
- `formatConsoleShaDriftRefusal`
- `formatConsoleShaDriftWarning`
- `isConsoleVersionCompatible`

Nothing was deleted. `utils/console.ts` still exports all thirteen and every in-package caller still imports it directly; what these ten lost is only the ability to be named through a published specifier. `ResolveConsoleOptions` in particular is still `resolveConsolePath`'s parameter type, so the options object a caller passes keeps working structurally — only the type's name is no longer importable from this subpath.

`decideConsoleMount` and `createRuntimeAssetsPlugin` were retired on a measurement rather than by default: every reference to either name in this repo is inside `packages/cli`, the consumer-specifier ledger names neither, and `decideConsoleMount`'s own docblock scopes it to `isDev` and states that no published install can reach the refusal it exists to produce.

`packages/cli/test/published-subpath-console.pin.test.ts` now holds the packed `.d.ts` to exactly the three names and their shapes, compiled by a real consumer outside the workspace, with a control per retired name. Re-admitting any of the ten is a deliberate, reviewed, `minor`-bumped edit to that barrel and that pin.

<!-- adr-0087: not-required (no-migration-prescription) The ADR-0087 ledger serves metadata upgraders: its entries are the data source for `objectstack migrate meta`, `spec-changes.json` and the generated upgrade guide. All ten names are ordinary TypeScript values and types on a published subpath with no metadata surface whatsoever — no Zod schema, no `packages/spec` declaration, no stored representation — so `objectstack migrate meta` has nothing to reach and no ledger entry could carry anything. There is also nothing to prescribe, and the consumer reading behind that is stated here at exactly the strength it was measured. In this repo: no importer of any of the ten outside `packages/cli` itself. In `objectui`: a real zero, re-derived at the pinned `.objectui-sha` — the specifier `cli/console` does not occur, and none of the ten occurs as an identifier except `CONSOLE_PATH`, twice, both inside comment prose and neither an import — against a positive control of 545 lines that do import from the `@objectstack/` scope, so the corpus is live and the zero is a reading rather than a silence. In `cloud`: NOT MEASURED, which is not the same thing as zero — the code-search index does not cover that repository from this seat, answering 0 hits with `incomplete_results: true`, and no checkout of it is reachable either. Every channel tried refused, and an unreachable repository never reads as "no consumers"; a refusal is not an absence. So for `cloud` the evidence stays second-hand by construction: the consumer-specifier ledger, which names exactly the three kept helpers, and the ruling behind this card, which reads it the same way. The channel that would actually reach a surprised consumer is the compiler (TS2305 naming the retired symbol at the import site), which is more precise than a ledger line. -->
