---
'@objectstack/cli': minor
---

fix(cli)!: `os plugin publish` parses the artifact's compiled manifest through `ManifestSchema` before anything is uploaded, so a stale `.osplugin` (e.g. `packaging: 'manifest-deps'`) is refused at the publisher's terminal with the schema's prescription instead of failing later at its consumer's install

Clause-②: no (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped: `ManifestSchema` is consumed as it stands, and what changes is that a third door, `os plugin publish`, holds the compiled manifest inside an artifact to it, as `os plugin build` holds the source manifest and `os plugin install` and the boot-time loader hold the compiled one. The refusal is the schema's own message (for `manifest-deps`, the retirement prescription), and the fix is to the source manifest and a rebuild, so there is nothing new for a metadata migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at `os plugin publish` (`@objectstack/cli`).

- **Before.** `os plugin publish` `JSON.parse`d the artifact's `objectstack.plugin.json` and checked only that `id` and `version` were present and that `integrity` was an object. An artifact built before a schema change uploaded: one carrying the retired `packaging: 'manifest-deps'` reached the registry and was refused only at its consumer's `os plugin install`. Any other compiled-manifest drift (a missing `name` or `type`, an unknown key) uploaded the same way.
- **Now.** The publish parses the compiled manifest with `readCompiledPluginManifest` (`@objectstack/runtime`), the one helper `os plugin install` and the boot-time loader already use, before any request leaves the machine.
  - A manifest the schema refuses stops the publish with `The artifact's objectstack.plugin.json is not a valid plugin manifest, so nothing was published:` and one line per schema issue. For `manifest-deps` that line is the retirement prescription. Neither the package row nor the version is posted.
  - The hand-rolled malformed-`integrity` refusal is gone: a malformed map is a schema issue now. `Artifact manifest is missing id or version.` is now reached only by an empty `--manifest-id`.
  - A valid artifact publishes unchanged: the uploaded `plugin_manifest` is still the manifest the artifact carries, byte for byte, without the defaults the parse stamps (`scope`, `defaultDatasource`).
  - `readOspluginManifest` (internal to the CLI) parses through the same helper and is now async.
- **Who sees it.** Anyone publishing an `.osplugin` whose compiled manifest `ManifestSchema` refuses: one built by an `os plugin build` from before a schema change, or one assembled by hand.

**The remedy.** Fix the plugin's source `objectstack.plugin.json` as the refusal says (for `manifest-deps`: delete the `packaging` key; `bundled` is the default and the only strategy), rebuild the artifact with `os plugin build`, re-sign it with `os plugin sign`, and publish it again. An artifact `os plugin build` produced from a valid manifest publishes unchanged.
