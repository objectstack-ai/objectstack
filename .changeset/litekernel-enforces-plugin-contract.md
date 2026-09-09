---
"@objectstack/core": minor
---

`LiteKernel.use()` now enforces the declared plugin contract — the same check, the same refusal, as `ObjectKernel.use()`. A plugin object that `PluginSchema` (`@objectstack/spec`, `kernel/plugin.zod.ts`) refuses is refused at registration on **both** published kernels instead of on one.

**BREAKING** accept-set narrowing on a published runtime entry point, shipped as `minor` under the repo's launch-window convention for breaking changes (`scripts/check-changeset-no-major.mjs`). **A plugin object `LiteKernel` accepted before can be refused now.** Until this release `LiteKernel.use()` wrote the object straight into its registry: `PluginSchema` was run by `PluginLoader.validatePluginContract` only, and `PluginLoader` is reached from `ObjectKernel.use()` alone. So the same plugin was accepted by one kernel and refused by the other — a `type: 'ui'` plugin with no `slug` was refused by `ObjectKernel` with `PLUGIN_CONTRACT_VIOLATION` and mounted a route on `LiteKernel`. `AGENTS.md` names `LiteKernel` for tests, serverless and edge, so the lenient kernel was the one authors develop against and the strict one was production: a plugin could be green in vitest and refused at boot. Maintainer ruling of 2026-09-08 (option A, under the precedent that the two kernels converge rather than diverge): `LiteKernel` validates too.

**Exactly what `LiteKernel.use()` newly refuses** is exactly what `ObjectKernel.use()` has refused since the `kernel.use()` enforcement release: all EIGHT declared keys, each refused with the offending key named in the message —

- **`id`** — a non-string, or the empty string.
- **`type`** — any value outside the closed set `standard`, `ui`, `driver`, `server`, `app`, `theme`, `agent`, `objectql`.
- **`staticPath`** — a non-string.
- **`slug`** — a non-string, or a string that does not match `/^[a-z0-9-_]+$/`.
- **`default`** — a non-boolean.
- **`description`** — a non-string.
- **`author`** — a non-string.
- **`homepage`** — a non-string, or a string that is not a URL.

**`null` is refused on every one of the eight**, and a `type: 'ui'` plugin missing `staticPath` or `slug` is refused with `PLUGIN_UI_REQUIRED_KEY_MISSING` inside the same envelope.

**What a refusal looks like — one refusal, from either kernel.** The check is now one function (`assertPluginContract`, package-internal) that both kernels call, so the code and the message are produced once:

```
PLUGIN_CONTRACT_VIOLATION: plugin '@acme/console' is refused by the declared
plugin contract at 'slug': PLUGIN_UI_REQUIRED_KEY_MISSING: a `type: 'ui'` plugin must declare `slug` — …
```

`LiteKernel.use()` is synchronous and throws that error as-is, so the stable code is on the error's `code` property as well as at the head of the message. `ObjectKernel.use()` is unchanged: it still re-wraps a failed load as `Failed to load plugin: <name> - <that message>`, its existing wrapper for every load failure. The text after that prefix is byte-for-byte the `LiteKernel` message for the same input, pinned by test.

**What is STILL ACCEPTED on `LiteKernel` — the narrowing stops where `ObjectKernel`'s does.** Unknown keys still pass (`PluginSchema` carries no `.strict()`, and the parse output is discarded, so the stored object is the very object passed in). A version-less plugin still loads, and so do `1.0.0-alpha.1` and `1.0.0+20230101`: `version` is excluded from the schema check on both kernels, and `LiteKernel` — which has never judged `version` — still does not. A plugin declaring no `type` still loads and still stores no `type`. A class-based plugin keeps its identity, its prototype and its prototype methods. And `PluginLoader`'s structural checks (`name`, `init`, semver) stay the loader's own: the convergence is on the schema, not on the loader.

**Ordering, stated because it is observable.** `LiteKernel.use()` checks its state first (a kernel past bootstrap still says `Cannot register plugins after bootstrap has started`, never `PLUGIN_CONTRACT_VIOLATION`), then the contract, then registers — so a refused plugin never reaches the registry and cannot supersede an earlier registration under its name.

**Blast radius, measured before landing rather than assumed.** Across this repository's suites, 813 `LiteKernel.use()` calls were reachable; 807 were accepted by the schema unchanged and the six refusals came from three test-local fixture objects in two files — zero product or library code. Externally authored plugins registered on `LiteKernel` are the population this reaches, and they are exactly the plugins that would already have been refused by `ObjectKernel` at production boot.

**Migration.** There is nothing to rename. A plugin refused on `LiteKernel` now was already refused on `ObjectKernel`; fix the named key: give `type` a value from the closed set (or drop it — an absent `type` reads as `standard`), declare `staticPath` and `slug` on a `type: 'ui'` plugin, spell `slug` in `[a-z0-9-_]`, make `homepage` a URL, and never `null` a declared key. The refusal names the plugin and the first violated key.

<!-- adr-0087: not-required (no-migration-prescription) An accept-set narrowing performed entirely at the runtime registration path: `PluginSchema` is READ by `LiteKernel.use()` now, exactly as `ObjectKernel.use()` has read it since the `kernel.use()` enforcement release — the schema itself is not changed. No metadata key, spec symbol, Zod schema, object definition or stored representation is added, removed or given a different name, so `objectstack migrate meta` has nothing to visit and there is no tombstone to mint. Stored metadata is untouched; what moves is which plugin OBJECTS the second kernel accepts, and every object it newly refuses was already refused by the first. The channel that reaches an affected plugin author is the refusal itself, which names the offending key at `use()` and is more precise than a ledger line — and which value a refused key should carry is authoring intent no ledger entry can decide. -->
