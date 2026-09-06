---
'@objectstack/cli': minor
---

feat(cli): point `@objectstack/cli/console` at a public barrel with a name-and-shape pin

**BREAKING**: `@objectstack/cli/console` publishes three names instead of thirteen. Ten names it used to resolve no longer resolve through that subpath.

The subpath pointed straight at `dist/utils/console.js` — an internal module — and carried no surface pin of any kind, neither names nor shapes. The only assertion anywhere in the tree was that `./console` *is a declared subpath*. So all thirteen of that module's top-level exports were public API, and every export it gained afterwards became a permanent public contract the moment it landed, silently.

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

<!-- adr-0087: not-required (no-migration-prescription) The ADR-0087 ledger serves metadata upgraders: its entries are the data source for `objectstack migrate meta`, `spec-changes.json` and the generated upgrade guide. All ten names are ordinary TypeScript values and types on a published subpath with no metadata surface whatsoever — no Zod schema, no `packages/spec` declaration, no stored representation — so `objectstack migrate meta` has nothing to reach and no ledger entry could carry anything. There is also nothing to prescribe: the re-derived consumer reading found no importer of any of the ten, in this repo or in the one sibling checkout reachable, and the channel that would reach one is the compiler (TS2305 on the retired name), which is more precise than a ledger line. -->
