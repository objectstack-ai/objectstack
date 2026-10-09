---
'@objectstack/core': minor
'@objectstack/verify': minor
'@objectstack/cli': patch
---

`bootStack` composes what `objectstack serve` composes from the same configuration: the providers the app's `requires` names, and the plugins in the app's own `plugins` array

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling or stored shape is removed, renamed or re-shaped, and no stored row is read, rewritten, converted or dropped, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is the in-process verification boot of @objectstack/verify: a second live boot of one configuration object is refused, and an entry of the app's own `plugins` array that cannot be loaded or registered fails the boot instead of being absent. The other categories are closed on facts: every bumped package publishes (not unpublished); no ADR-0087 id covers these paths and this diff adds none (not registered / already-registered); and the narrowed surface is a runtime boot function, not an interface or a type (not runtime-interface-only / type-surface-only). -->

**BREAKING** accept-set narrowing, shipped as `minor` under the repo's launch-window convention for breaking changes.

**`@objectstack/verify` — one composition rule.** For one configuration, `bootStack(config, opts)` now mounts what `objectstack serve` mounts from it, so an app's tests boot the composition its users get:

- **The providers the app's `requires` names**, by `serve`'s own reader and table (top-level `requires`, otherwise each package body's), plus the always-on providers a mounted plugin hard-depends on. An app no longer lists them in `extraPlugins` by hand.
- **The plugins in the app's own `plugins` array**, by `serve`'s rule for an entry: an instance is mounted as written, a plain bundle is wrapped into `AppPlugin`, a package name is loaded from the app's root (`hostRoot`).
- **The caller wins by identity.** An `extraPlugins` instance takes precedence over a `requires` provider it is (exact `name` or class name) and over an app plugin with the same `name`; that app plugin is not mounted. `security` and `analytics` instances take precedence over an app plugin of the same `name` the same way.
- **`hostRoot` is the app's root** in the two places `serve` uses the config's directory: the automation service's `packageRoot` (where a declarative connector's package-relative file ref is read) — now also when `automation: true` asks for the service — and the root a string `plugins` entry is resolved from. A suite that does not run from the app's directory passes it.
- **Offline CI.** An app whose `plugins` array wires the marketplace-facing `@objectstack/cloud-connection` plugins gets them mounted, pointed at `OS_CLOUD_URL` (by default the public catalog). Set `OS_CLOUD_URL=off` in the test environment, before the configuration module is imported, to keep the suite offline.

**What now fails that booted before (the narrowing).**

- **A second live boot of the same configuration object is refused** with `code: 'RESOURCE_CONFLICT'`, `status: 409`, and so is a copy (`{ ...config }`) that carries an app-plugin instance a live boot mounted: the instances in a `plugins` array are module-level, and two kernels must not share them. Live means until `stop()` resolves. Remedy: `stop()` the first stack before booting again; or share one boot with `bootStackOnce(config, opts)`; or, to keep two stacks of one app live at once, boot the second on a configuration built again (call its builder once more, or import a fresh module instance of it). A `{ ...config }` spread is not a configuration of its own: a live boot keeps references into the configuration's nested definitions.
- **An app `plugins` entry that cannot be loaded or registered fails the boot**, naming the entry (`plugins[i]`) and its remedy. `serve` logs such an entry and boots on; a test boot does not, so a plugin the app declares is never silently absent from its tests.
- **A provider or app plugin that refuses to start fails the boot** where the fixed plugin set never mounted it — for example a declarative connector whose package-relative file ref does not resolve from `hostRoot`.

**`@objectstack/core`** exports the pieces both boots read: `CAPABILITY_PROVIDERS`, `CapabilitySpec`, `CapabilityIdentities` and `providesCapability` (the `requires` token → provider table and its exact identity match); `stackDeclaredCapabilities`, `resolveStackCollection`, `declaredPackageEntries`, `stackPackageBodies` and `collectFromPackageBodies` (the package-owned collection reader); and `materializeStackPlugin` with `StackPluginLoaders` (what a `plugins` entry becomes).

**`@objectstack/cli`**: `os verify` boots the app anchored at the directory holding its config (`hostRoot`), as `serve` anchors it, so `os verify --app path/to/objectstack.config.ts` run from another directory reads the app's package-relative files (a declarative connector's spec, a string `plugins` entry) and resolves `--multi-tenant`'s organizations package from the app, not from the working directory. `serve` itself does not change: `Serve.CAPABILITY_PROVIDERS` and `Serve.providesCapability` are handles over the `@objectstack/core` declarations, the stack-collection readers are re-exported from there, and `serve`'s `plugins` loop reads the entry rule from there.
