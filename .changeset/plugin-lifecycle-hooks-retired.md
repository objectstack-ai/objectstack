---
"@objectstack/spec": major
---

refactor(spec)!: retire the plugin lifecycle-hook family the kernel never implemented (#4212)

`PluginLifecycleSchema` declared `onInstall` / `onEnable` / `onDisable` /
`onUninstall` / `onUpgrade`, each with confident TSDoc ("Called when plugin is
installed", …). **The kernel calls none of them, and never has.** Its plugin
contract is `init` / `start` / `destroy` (`packages/core/src/types.ts`):
`kernel.use()` validates and stores, `bootstrap()` runs `init` then `start`,
shutdown runs `destroy` in reverse order. There is no install phase and no
first-time-only path. Repo-wide, the schema's only importer was its own test —
and the docs built on it sent authors at a dead seam (`registerMetadataTypeSchema`
told plugins to register custom metadata types "from their `onInstall` hook";
a plugin that obeyed registered nothing, with no error saying so).

Removed, with zero consumers verified across `objectstack`, `objectui` and
`cloud`:

- `PluginLifecycleSchema` + `PluginLifecycleHooks`, and the five hook members
  on `PluginSchema` (now a plain descriptor object).
- `UpgradeContextSchema` + `UpgradeContext` — existed solely to serve
  `onUpgrade`.
- The `@objectstack/spec/system` `./types` module: the `ObjectStackPlugin`
  interface (the same three hooks as a TS contract, referenced by no file in
  any repo) and its companions `PluginContext` (interface duplicate),
  `PluginLogger`, `ObjectQLClient`, `IKernel`, `ObjectOSKernel` — seeded by
  the aspirational spec in issue #2 and never consumed since.

FROM → TO:

- `onInstall` → there is no install-time code hook; installation is a
  package-registry state transition (`registry.installPackage()` →
  `sys_packages`). Install-shaped setup (registering services, schemas,
  metadata types) belongs in the plugin's **`init(ctx)`**.
- `onEnable` (kernel plugin) → `init(ctx)` / `start(ctx)`. The *app-bundle*
  `onEnable` module export is a different, real contract and is unchanged —
  `AppPlugin` invokes it at boot (`STACK_RUNTIME_MEMBERS`).
- `onDisable` / `onUninstall` → `destroy()` for runtime teardown; package
  uninstall is a registry transition.
- `onUpgrade` / `UpgradeContext` → package upgrades apply metadata migrations
  (ADR-0087); no plugin code runs.

One-line fix: replace the hook object with a class implementing
`Plugin` — `name` + `async init(ctx)` (+ optional `start`/`destroy`).

Plain deletion rather than `retiredKey()` tombstones because nothing parses
plugin objects through these schemas (`stack.zod` carries `plugins` as
`z.array(z.unknown())`) — a prescription nobody can receive is noise (the
`plugin-runtime.zod.ts` precedent). Per that precedent, the key-vanish guard's
baseline entries (`kernel/UpgradeContext:*` in `authorable-surface.json`) are
dropped deliberately in this PR. A pleasant side effect: with the function
members gone, `PluginSchema` became JSON-representable and now publishes a
`kernel/Plugin` JSON schema for the first time. No ADR-0087 conversion: these are function
members on runtime objects, not authorable stack metadata; there is no source
file for `os migrate meta` to rewrite. The kernel docs
(`protocol/kernel/{index,lifecycle,plugin-spec}.mdx`) that documented the
fictional lifecycle — including a manifest `lifecycle:` file-map ManifestSchema
never declared — now document the real contract.
