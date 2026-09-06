---
"@objectstack/core": minor
---

`kernel.use()` now enforces the declared plugin contract. A plugin object with an **unknown `type`**, an **invalid `slug`** or an **invalid `homepage`** is refused at load instead of being stored and mounted.

**This refuses input the runtime accepted before**, which is why it is not a `patch`: `PluginSchema` (`@objectstack/spec`, `kernel/plugin.zod.ts`) had zero runtime callers, so every constraint it declared beyond `name`, `init` and semver was a declaration with nothing behind it. The sharpest reading of that gap, one input and two answers: `defineStack` accepted `type: 'ui-plugin'` while `PluginSchema.safeParse` refused it — and only one of those answers was on the path a real plugin takes. Maintainer ruling of 2026-09-06 (ADR-0049 enforce-or-remove): the protocol is the baseline, the runtime aligns to it.

**What a refusal looks like.** It travels the loader's existing plugin-load error path — no new error channel — carrying the stable code `PLUGIN_CONTRACT_VIOLATION` at the head of the message and on the error's `code` property, and naming the plugin plus the first violated key:

```
PLUGIN_CONTRACT_VIOLATION: plugin '@acme/console' is refused by the declared
plugin contract at 'type': Invalid option: expected one of "standard"|"ui"|…
```

A wrong `type` is therefore diagnosable at boot rather than at route mount. The code is a **boot refusal**, not wire vocabulary: it is raised before any HTTP boundary exists, and no door answers with it.

**What does NOT change.**

- The plugin object is validated, never replaced. `safeParse` is read for `success` and its output discarded, because a copy destroys the prototype chain of class-based plugins — the reason `PluginLoader.toPluginMetadata` is a cast. A class-based plugin's identity, prototype and prototype methods surviving `use()` is pinned by test, not asserted in prose.
- `PluginSchema`'s `.default('standard')` is **not** written back: a plugin declaring no `type` still loads and still stores no `type`.
- **`version` is deliberately excluded from this enforcement.** The schema spells it `/^\d+\.\d+\.\d+$/`, which refuses the prerelease and build-metadata forms SemVer 2.0.0 defines, while the loader's own `isValidSemanticVersion` implements the full grammar and accepts them — and does so deliberately, pinned by `plugin-loader.test.ts`. Enforcing the narrower spelling would retire that capability silently, so the loader's check remains authoritative for `version` and `1.0.0-alpha.1` / `1.0.0+20230101` still load. Reconciling the two spellings is spec work, tracked separately.

**Blast radius, measured rather than assumed.** Every in-repo plugin object declares a `type` inside the closed set (`standard` ×62, `server` ×2, `driver` ×2, `objectql`, `app`), and the repo contains no producer of `slug` or `homepage` on a plugin object at all — so no in-repo plugin changes behaviour. Externally authored plugins are the population this reaches, and they are exactly the population that never met the compile-time `Plugin.type` union either.
