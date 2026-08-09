---
"@objectstack/spec": major
---

refactor(spec)!: remove `manifest.loading` — a whole plugin loading block nothing read, including a sandbox that isolated nothing (#4914)

<!-- adr-0087: registered plugin-manifest-loading-retired -->

`manifest.loading` and the entire `PluginLoadingConfig` block behind it are
removed under ADR-0049 enforce-or-remove (maintainer ruling 2026-08-04). The
block declared a complete plugin loading policy — `strategy`, `preload`,
`codeSplitting`, `dynamicImport`, `initialization`, `dependencyResolution`,
`hotReload`, `caching`, `sandboxing`, `monitoring` — and **nothing read any of
it**. A bare-name scan of all three repos (objectstack, cloud, objectui, each
with a control probe proving the scan saw the tree) put every reference inside
`packages/spec` itself: the declaration, its own unit tests, the
`Manifest.loading` embed and the generated artifacts. Authoring it parsed
cleanly, entered the manifest, and configured nothing.

**FROM → TO:** delete the `loading` key from `objectstack.plugin.json`. There is
nothing to re-declare. Plugins are composed at boot — `defineStack` registers
them and the kernel runs `init` then `start` in an order topologically resolved
from each composed plugin's own `dependencies` / `optionalDependencies`
(`resolvePluginOrder`); the set is fixed until the process restarts.

**⚠️ `loading.sandboxing` is the reason this is a major rather than tidying.** It
declared `isolationLevel: 'process' | 'vm' | 'iframe' | 'web-worker'`, IPC
transports and an `allowedServices` ACL — and applied **none** of it. If you
authored it believing plugins were isolated, they were not, and they never were:
no process/vm/iframe/worker boundary was ever created and `allowedServices`
gated no call. An inert security control is worse than an absent one because it
is believed — the ADR-0033 hazard, since an AI author reads a published
vocabulary as proof of the capability. The enforced surfaces are the plugin
trust tier (`manifest.runtime`, ADR-0025 §3.6) and the manifest permission
declarations.

**Hot reload converges on one vocabulary.** `PluginHotReloadSchema` was the dead
one of two: `HotReloadManager` (`packages/core/src/hot-reload.ts`) reads
`HotReloadConfigSchema` in `plugin-lifecycle-advanced.zod.ts`, which is **kept**.
`PLUGIN_STANDARDS.md` §5.1 now points at that surviving side and states its real
status — it has an implementation body but no runtime composes one, so it is a
foundation, not a shipped capability. Enforcing it is a separate future decision
and deliberately not part of this change.

The retirement kit:

- **`retiredKey()` tombstone** on `Manifest.loading`, not a plain deletion:
  `ManifestSchema` is not `.strict()`, so deleting the key would let zod strip it
  in silence — trading an inert declaration for an invisible one (the #3726 /
  #3733 shape, ADR-0104). The tombstone is audible through `tsc` (input type
  `never`) and through the parse, which raises the prescription itself.
- **Eleven whole defs unpublished** with the carrier key, registered in
  `RETIRED_DEFS_BY_MAJOR[17]`: `PluginLoadingConfig`, `PluginLoadingStrategy`,
  `PluginPreloadConfig`, `PluginCodeSplitting`, `PluginDynamicImport`,
  `PluginInitialization`, `PluginDependencyResolution`, `PluginHotReload`,
  `PluginCaching`, `PluginSandboxing`, `PluginPerformanceMonitoring`, plus every
  type alias. `PluginLoadingEvent` / `PluginLoadingState` survive — the module's
  observational half, never embedded in the config block.
- **ADR-0087 D3 `SemanticMigration`** (`plugin-manifest-loading-retired`) and the
  `kernel/Manifest:loading` entry in `RETIRED_KEYS_BY_MAJOR[17]`. Deliberately
  **no D2 conversion**: the chain walks a normalized stack and
  `applyConversionsToStoredItem` maps a metadata type onto one of its
  collections, but `PLURAL_TO_SINGULAR` has no `packages` / `plugins` entry — a
  manifest is not a stack collection member, and a stored manifest row passes
  that seam through unchanged. A conversion would be a transform with no seam
  that ever runs.
- **No liveness-ledger change**: the ledger walks `BUILTIN_METADATA_TYPE_SCHEMAS`
  (authorable metadata types), and the kernel manifest is not one, so
  `manifest.loading` never had a row to keep or orphan.
- Docs rewritten (`PLUGIN_STANDARDS.md` §5.1/§5.2/§5.4, `PROTOCOL_MAP.md`);
  generated baselines and reference pages regenerated.

**Already-installed packages keep working.** Nothing ever read the block, so
removing it removes no behaviour. A stored manifest that still carries `loading`
degrades to a single `[metadata_spec_invalid]` diagnostic at registration —
`Registry.validate()` is deliberately a diagnostic and not a gate, so bad
metadata is never a data outage — and clears when you delete the key from the
source manifest and reinstall. The enforced channel is `os plugin build`, which
runs `ManifestSchema.safeParse` with the author present and exits non-zero
carrying the prescription.
