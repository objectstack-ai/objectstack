---
'@objectstack/runtime': patch
'@objectstack/cli': patch
---

fix(cli): `os plugin publish` decodes the artifact's compiled manifest once, through `readCompiledPluginManifest` (#27914)

Clause-②: yes (widening: the `ok` arm of `@objectstack/runtime`'s exported `CompiledPluginManifestRead` gains `document`, the manifest entry as decoded before the `ManifestSchema` parse; every existing key keeps its value)
Metadata-protocol: none

- **Before.** `os plugin publish` validated the compiled manifest through `readCompiledPluginManifest`, then decoded the same archive entry a second time to build the verbatim `plugin_manifest` upload, finding it by the CLI's own spelling of the filename. That lookup held only while the CLI's `MANIFEST_FILENAME` and the runtime's `COMPILED_PLUGIN_MANIFEST_FILE` spelled the same string.
- **Now.** `readCompiledPluginManifest` answers the decoded `document` beside the parsed `manifest`, and publish uploads that document. The upload is unchanged: the artifact's own manifest, key for key, without the defaults the parse stamps (`scope`, `defaultDatasource`).
