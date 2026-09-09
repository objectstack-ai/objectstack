---
"@objectstack/spec": minor
"@objectstack/core": minor
---

`PluginSchema.version` now accepts the whole of the SemVer 2.0.0 grammar, and `version` becomes the ninth declared key `kernel.use()` enforces.

Two declarations in this repository disagreed about what a plugin `version` is, and the disagreement became load-bearing the moment the boot path started running the schema:

| Declaration | Grammar | Accepted `1.0.0-alpha.1` / `1.0.0+20230101` |
|---|---|---|
| `PluginSchema.version` (`@objectstack/spec`, `kernel/plugin.zod.ts`), described `"Semantic Version"` | `/^\d+\.\d+\.\d+$/` | **no** |
| `PluginLoader.isValidSemanticVersion` (`@objectstack/core`), the check the boot path has always run | `/^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$/` | **yes** |

SemVer 2.0.0 defines prerelease and build metadata as **parts of** a semantic version, so the key's own `describe()` — `"Semantic Version"`, no qualifier — claimed the wide grammar while its regex implemented a subset of it. The spec key was the one that was wrong, and it is the one that moved.

**The spec adopts the loader's grammar character for character**, deliberately, rather than a third spelling: that is the check the boot path has always run, so the two declarations now converge exactly and nothing that loaded before is refused now.

**`@objectstack/spec` — a WIDENING of a published contract.** `Plugin.json`'s `pattern` in the shipped `json-schema/` tree changes from `^\d+\.\d+\.\d+$` to `^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$`. This is a strict superset — same three-segment core, two **optional** suffix groups — so every string that validated before still validates. A tool that mirrors this schema to validate plugin manifests should widen with it; one that does not will merely keep refusing prerelease versions the platform accepts.

**`@objectstack/core` — `version` joins the enforced set, which NARROWS `LiteKernel`.** **BREAKING** accept-set narrowing on a published runtime entry point, shipped as `minor` under the repo's launch-window convention for breaking changes (`scripts/check-changeset-no-major.mjs`). **A plugin object `LiteKernel` accepted before can be refused now.** `assertPluginContract` filtered `version` issues out while the two spellings disagreed; that stopgap is gone. The full enforced set is now **NINE** keys, each refused with the offending key named in the message:

- **`id`** — a non-string, or the empty string.
- **`type`** — any value outside the closed set `standard`, `ui`, `driver`, `server`, `app`, `theme`, `agent`, `objectql`.
- **`staticPath`** — a non-string.
- **`slug`** — a non-string, or a string that does not match `/^[a-z0-9-_]+$/`.
- **`default`** — a non-boolean.
- **`version`** — a non-string, or a string outside the SemVer grammar above. **New in this release.**
- **`description`** — a non-string.
- **`author`** — a non-string.
- **`homepage`** — a non-string, or a string that is not a URL.

**`null` is refused on every one of the nine**, and a `type: 'ui'` plugin missing `staticPath` or `slug` is still refused with `PLUGIN_UI_REQUIRED_KEY_MISSING` inside the same envelope.

⚠️ **This supersedes the eight-key enumeration published in `@objectstack/core@17.4.0`.** Both of that release's entries — the `kernel.use()` and the `LiteKernel.use()` enforcement notes — say the enforced set is eight keys and that `version` is excluded, and both point at reconciling the two `version` spellings as separate spec work. This is that work. Those entries stay as written, because they describe what 17.4.0 did; **nine is the current set**, and `version` is no longer excluded from anything.

**What actually changes behaviour, stated narrowly.** On **`ObjectKernel`** nothing moves: `PluginLoader.validatePluginStructure` already judged `version` with this exact grammar and still runs first, so a malformed `version` is still refused as `Invalid semantic version`, never as `PLUGIN_CONTRACT_VIOLATION`. On **`LiteKernel`** a plugin object with a malformed `version` — `version: 'v1.0.0'`, say — was **registered** before and is **refused** now, with `PLUGIN_CONTRACT_VIOLATION` at `'version'`. `LiteKernel` has never run the loader's structural checks, so `version` was the one declared key it did not judge at all: such a plugin was green in vitest and refused by `ObjectKernel` at production boot. That is exactly the split the `LiteKernel` convergence closed for the other eight keys, closed now for the ninth.

**What is unchanged.** `1.0.0-alpha.1`, `1.0.0+20230101` and `0.0.0-fixture` load on **both** kernels, as they did before — measured, not assumed, and pinned per kernel. A version-less plugin still loads; `version` is `.optional()`. Unknown keys still pass (`PluginSchema` carries no `.strict()`, and the parse output is discarded, so the stored object is the object that was passed in). A class-based plugin keeps its identity, prototype and prototype methods.

⚠️ **The accepted grammar is wider than SemVer 2.0.0 itself**, and this release neither introduced nor widened that fringe: leading zeroes in the numeric core (`01.1.1`) were accepted by **both** spellings before this change and are accepted by both after it, and the loader's prerelease/build classes admit degenerate identifiers SemVer forbids (`1.0.0-alpha..1`, `1.0.0-0123`, `1.0.0+.`). Tightening to the official SemVer regex would have **narrowed** this key rather than widening it, so it is deliberately not done here.

**Migration.** Nothing to rename, and nothing to do if your plugin's `version` is a real semantic version. If you register plugins on `LiteKernel` with a `version` string that is not one — a leading `v`, a two-segment `1.0` — spell it `MAJOR.MINOR.PATCH` with optional `-prerelease` and `+build`, or drop the key. The refusal names the plugin and the key.

<!-- adr-0087: not-required (no-migration-prescription) A regex widening on one declared key of `PluginSchema`, plus the removal of a runtime filter that had excluded that key from an existing check. No metadata key, spec symbol, Zod schema, object definition or stored representation is added, removed or given a different name, so `objectstack migrate meta` has nothing to visit and there is no tombstone to mint. Stored metadata is untouched; what moves is which plugin OBJECTS a boot accepts — strictly more of them at the schema, and on `LiteKernel` the malformed-`version` objects `ObjectKernel` already refused. The channel that reaches an affected plugin author is the refusal itself, which names the plugin and the offending key at `use()`, and which value a malformed `version` should carry is authoring intent no ledger entry can decide. -->
