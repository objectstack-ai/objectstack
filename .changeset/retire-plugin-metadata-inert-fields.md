---
"@objectstack/core": minor
---

feat(core): retire the inert `PluginMetadata` surfaces — `configSchema` with `PluginConfigValidator`, and `hotReloadable` (#11982, #12587, ADR-0049)

<!-- adr-0087: not-required (runtime-interface-only packages/core/src/plugin-loader.ts#PluginMetadata) PluginMetadata is a runtime TS interface in packages/core with no Zod schema, no spec declaration and no stored representation; no metadata surface references it (the PluginMetadata in packages/spec/src/kernel/plugin-validator.zod.ts is an unrelated locally-declared homonym). The deleted PluginConfigValidator / createPluginConfigValidator were runtime classes in the same non-metadata module family, so `objectstack migrate meta` has nothing to rewrite; the compiler is the notification channel — TS2353 on the removed fields, TS2305 on the removed exports. -->

**BREAKING**: removes a published-but-inert capability from the `.` entry of
`@objectstack/core`. Shipped as `minor` under the lockstep launch-window
convention (a `major` bump is refused repo-wide by `check:changeset-no-major`).

Removed, each measured at zero live consumers with positive controls (the
sibling `startupTimeout` is read live by the kernel's startup timeout guard);
maintainer ruled retire under ADR-0049 enforce-or-remove, 2026-08-27,
decision-inbox batch 5; recorded in ADR-0025 §3.7:

- `PluginMetadata.configSchema` — declared "Configuration schema for
  validation", but the mechanism could never run: the loader's only call
  passed no config, and no caller could — plugin factories close over their
  config, so the kernel never receives it. Every one of ~40 production
  `kernel.use()` compositions already passes config as constructor arguments
  and works.
- `PluginConfigValidator` / `createPluginConfigValidator` — the validator
  behind that field: real code with zero reachable invocations, deleted along
  with its unit test and its export from the security barrel.
- `PluginMetadata.hotReloadable` — declared "Whether plugin supports hot
  reload" with zero reads and zero declarations: `HotReloadManager.reloadPlugin`
  gates only on its own registered reload configs, so `hotReloadable: false`
  was hot-reloaded identically to `true`.
- The `packages/core/ADVANCED_FEATURES.md` example whose inline comment
  promised "Config is validated before init is called" — false on the
  retired ref, and the retired surface's only in-repo declaration site.

One-line fixes, per symbol. If you declared `configSchema` on a plugin:
delete the field and parse your config at the plugin's own seam —
`MyConfigSchema.parse(options)` in the plugin factory or constructor, the
pattern `packages/rest` uses. If you imported `PluginConfigValidator` or
`createPluginConfigValidator`: delete the import and hold your own
`schema.parse` call; the compiler (TS2305) locates every such site. If you
declared `hotReloadable`: delete the field — it never gated anything, and
hot-reload participation remains governed solely by
`HotReloadManager.registerReloadConfig`.

Re-declaring a kernel-owned config-validation surface is a fresh decision for
the day ADR-0025's plugin distribution layer lands, with #11982's zero-caller
measurement as its starting evidence.
