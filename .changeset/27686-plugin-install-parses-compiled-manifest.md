---
'@objectstack/cli': minor
'@objectstack/runtime': minor
---

fix(cli)!: `os plugin install` and the boot-time loader parse an artifact's compiled manifest through `ManifestSchema`, so a stale `.osplugin` (e.g. `packaging: 'manifest-deps'`) is refused with the schema's prescription instead of failing at boot as `import_failed`

Clause-②: no (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped: `ManifestSchema` is consumed as it stands, and what changes is that two more doors hold the compiled manifest inside an artifact to it, as `os plugin build` already holds the source manifest. The refusal is the schema's own message (for `manifest-deps`, the retirement prescription), and the fix is to the source manifest and a rebuild, so there is nothing new for a metadata migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at `os plugin install` (`@objectstack/cli`) and at the boot-time loader for installed plugins (`@objectstack/runtime`'s `loadInstalledPlugins` / `verifyInstalledPlugins`, run by `os serve`, `os dev` and `os start`).

- **Before.** Both doors `JSON.parse`d the artifact's `objectstack.plugin.json` and read only `id` and `version` (and `runtime`, `main`, `integrity`, `permissions` by hand). An artifact built before a schema change installed: one carrying the retired `packaging: 'manifest-deps'` installed, and at boot its externalized imports failed and it was refused as `import_failed`, without the retirement prescription. Any other compiled-manifest drift (a missing `name` or `type`, an unknown key) installed the same way.
- **Now.** One helper, `readCompiledPluginManifest` (exported by `@objectstack/runtime`), parses the compiled manifest through `ManifestSchema` for both doors.
  - `os plugin install` refuses an invalid one before anything is unpacked, as `manifest_invalid`, listing the schema's issues (`--json`: `details`). For `manifest-deps` that is the retirement prescription. Nothing is written under the plugin home and no installation is recorded.
  - The boot loader refuses the plugin by name as `manifest_invalid` (a new `InstalledPluginRefusalCode`), with the schema's message, before anything of it is imported. It stays non-fatal: the boot goes on and every other installed plugin loads.
  - `os plugin install`'s `manifest_incomplete` and `integrity_malformed` refusals are gone: a missing `id` / `version` and a malformed `integrity` map are schema issues, refused as `manifest_invalid`.
- **Also.** `os plugin build`'s native-addon refusal names, for a bundled package that builds or ships a native addon, the files that import it and the chain that reaches it from the plugin's own source (`src/index.ts → ws → bufferutil`), the way the `.node`-module line already names its importers. A transitive hit now traces to the direct dependency.
- **Who sees it.** Anyone installing, or booting with, an `.osplugin` whose compiled manifest `ManifestSchema` refuses: one built by an `os plugin build` from before a schema change, or one assembled by hand.

**The remedy.** Fix the plugin's source `objectstack.plugin.json` as the refusal says (for `manifest-deps`: delete the `packaging` key; `bundled` is the default and the only strategy) and rebuild the artifact with `os plugin build`, then sign and install it again. An artifact `os plugin build` produced from a valid manifest installs and boots unchanged.
