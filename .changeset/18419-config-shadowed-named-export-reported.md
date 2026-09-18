---
"@objectstack/cli": minor
---

fix(cli)!: a named export the config's default export already declares is reported instead of silently dropped (#18419)

<!-- adr-0087: not-required (no-migration-prescription) no metadata key is retired, renamed or given a new meaning here, no stored `sys_metadata` document changes, and the only authored construct whose treatment moves is a NAMED EXPORT of `objectstack.config.ts` that was already inert — it was skipped by the merge and reached no artifact. `os migrate meta` has nothing it could rewrite, so there is no ledger entry for this to be missing. -->

`objectstack.config.ts` is loaded as a module: `loadConfig()` takes the default export as the base and merges every named export onto it as a top-level stack key. A named export whose name the default export **already carries** loses — the default's value wins — and until now it lost in complete silence. `os build` exited 0, the artifact carried the default's value, and nothing was written at any level:

```ts
export default defineStack({ manifest, objects: [Task] });
export const objects = [Task, Invoice];   // Invoice never reached the artifact
```

The loader now says so on stderr, names every shadowed key, and states the rule and the remedy. It is an **advisory, not a refusal** — the stack that comes out is valid, it is merely missing what the shadowed export carried — which is the disposition this package already gives the same failure class (`#3786`'s undeclared authoring keys are "advisory, never fatal"; `#4095`'s orphaned runtime members are "reported rather than dropped"). It goes to stderr rather than stdout because `loadConfig()` is handed no `--json` flag and twelve commands call it, so a `--json` run's stdout stays a single parseable document. `LoadedConfig.shadowedNamedExports` carries the same names structurally.

**BREAKING** in the accept-set sense, landing in the launch window as `minor` (the lockstep convention: `major` is refused by `check-changeset-no-major`, and breaking-ness is carried by this banner plus the ADR-0087 disposition above): the collision test now reads **own keys only**. `key in merged` walked the prototype chain, so every `Object.prototype` member — `toString`, `valueOf`, `constructor`, `hasOwnProperty`, `propertyIsEnumerable`, `toLocaleString`, `isPrototypeOf` — was treated as a key the default export "already carries" when the default carries no such key at all. Such an export was skipped by the merge and therefore never reached the strict parse that refuses an undeclared stack key by name, so `export const toString = …` beside a valid stack built green while `export const collectPackageDirs = …` was refused. That hole is closed: those names now merge like any other and are refused by name, the same sentence every other undeclared helper export has always got.

Nobody's metadata or stored data changes. A config affected by the narrowing was already shipping that export's value nowhere; what changes is that the build now says so instead of exiting 0. Move the helper into a sibling module and import it, which is what the config-authoring docs have always prescribed for a helper exported beside the stack.
