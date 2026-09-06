---
"@objectstack/core": minor
---

`kernel.use()` now enforces the declared plugin contract. A plugin object that `PluginSchema` (`@objectstack/spec`, `kernel/plugin.zod.ts`) refuses is refused at load instead of being stored and mounted.

**BREAKING** accept-set narrowing on a published runtime entry point, shipped as `minor` under the repo's launch-window convention for breaking changes (`scripts/check-changeset-no-major.mjs`). **This refuses input the runtime accepted before**, which is also why it is not a `patch`: `PluginSchema` had zero runtime callers, so every constraint it declared beyond `name`, `init` and semver was a declaration with nothing behind it. The sharpest reading of that gap, one input and two answers: `defineStack` accepted `type: 'ui-plugin'` while `PluginSchema.safeParse` refused it — and only one of those answers was on the path a real plugin takes. Maintainer ruling of 2026-09-06 (ADR-0049 enforce-or-remove): the protocol is the baseline, the runtime aligns to it.

**Exactly what is newly refused: all EIGHT declared keys, not three.** The schema declares nine optional keys; the loader excludes `version` (below), so enforcement reaches these eight, each refused with the offending key named in the message:

- **`id`** — a non-string, or the empty string (`z.string().min(1)`).
- **`type`** — any value outside the closed set `standard`, `ui`, `driver`, `server`, `app`, `theme`, `agent`, `objectql`.
- **`staticPath`** — a non-string.
- **`slug`** — a non-string, or a string that does not match `/^[a-z0-9-_]+$/`.
- **`default`** — a non-boolean.
- **`description`** — a non-string.
- **`author`** — a non-string. An object such as `{ name: 'x' }` is refused; the declared type is a plain string.
- **`homepage`** — a non-string, or a string that is not a URL.

**`null` is refused on every one of the eight.** These keys are `.optional()`, which admits absence and `undefined` — never an explicit `null`. A plugin object that spells "no value" as `null` on any of the eight loaded before and is refused now.

**What a refusal looks like.** It travels the loader's existing plugin-load error path — no new error channel — carrying the stable code `PLUGIN_CONTRACT_VIOLATION` at the head of the message and on the error's `code` property, and naming the plugin plus the first violated key:

```
PLUGIN_CONTRACT_VIOLATION: plugin '@acme/console' is refused by the declared
plugin contract at 'type': Invalid option: expected one of "standard"|"ui"|…
```

A wrong `type` is therefore diagnosable at boot rather than at route mount. The code is a **boot refusal**, not wire vocabulary: it is raised before any HTTP boundary exists, and no door answers with it.

**What is STILL ACCEPTED — the door is not narrowed past those eight keys.** Measured on this tree, not assumed:

- **Unknown keys still pass.** `PluginSchema` is a plain `z.object` with **no `.strict()`** — the strip posture — and the parse output is discarded, so a valid plugin carrying four keys the schema never declares loads, and is stored as the very object that was passed in with all of its keys intact. A plugin is refused for what it says about a **declared** key, never for saying something extra.
- **A version-less plugin still loads**, exactly as before.
- **A plugin declaring no `type` still loads and still stores no `type`**: `PluginSchema`'s `.default('standard')` is **not** written back.
- **A class-based plugin keeps its identity, its prototype and its prototype methods.** The plugin object is validated, never replaced: `safeParse` is read for `success` and its output discarded, because a copy destroys the prototype chain of class-based plugins — the reason `PluginLoader.toPluginMetadata` is a cast. That survival is pinned by test, not asserted in prose.
- **`version` is excluded from this enforcement entirely**, so `1.0.0-alpha.1` and `1.0.0+20230101` still load. The schema spells `version` as `/^\d+\.\d+\.\d+$/`, which refuses the prerelease and build-metadata forms SemVer 2.0.0 defines, while the loader's own `isValidSemanticVersion` implements the full grammar and accepts them — deliberately, pinned by `plugin-loader.test.ts`. Enforcing the narrower spelling would retire that capability silently, so the loader's check remains authoritative for `version`. Reconciling the two spellings is spec work, tracked separately.

**Blast radius, measured rather than assumed.** Every in-repo plugin object declares a `type` inside the closed set (`standard` ×62, `server` ×2, `driver` ×2, `objectql`, `app`), and the repo contains no producer of `slug` or `homepage` on a plugin object at all — so no in-repo plugin changes behaviour. Externally authored plugins are the population this reaches, and they are exactly the population that never met the compile-time `Plugin.type` union either.

<!-- adr-0087: not-required (no-migration-prescription) An accept-set narrowing performed entirely at the runtime boot path: `PluginSchema` is READ by `kernel.use()`, not changed. No metadata key, spec symbol, Zod schema, object definition or stored representation is added, removed or given a different name, so `objectstack migrate meta` has nothing to visit and there is no tombstone to mint. Stored metadata is untouched; what moves is which plugin OBJECTS a boot accepts. The channel that reaches an affected plugin author is the refusal itself, which names the offending key at `kernel.use()` and is more precise than a ledger line — and which value a formerly-refused key should carry is authoring intent no ledger entry can decide. -->
