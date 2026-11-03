---
'@objectstack/cli': patch
'@objectstack/runtime': patch
---

fix(cli): the compiled plugin manifest's filename has one spelling, the runtime's

Clause-②: yes (widening)
Metadata-protocol: none

`os plugin build` writes the compiled manifest under the CLI's `MANIFEST_FILENAME`, and `os plugin publish` / `install` exempt that entry from the integrity map by it, while the runtime's reader finds the entry by `COMPILED_PLUGIN_MANIFEST_FILE`. The two were the same string kept by hand. `MANIFEST_FILENAME` is now the runtime's constant itself, so they cannot drift. The filename is unchanged (`objectstack.plugin.json`), so every artifact built before reads the same.

**Public surface (additive):** `@objectstack/runtime` publishes a new subpath, `@objectstack/runtime/compiled-plugin-manifest-file`, exporting `COMPILED_PLUGIN_MANIFEST_FILE`. It is an import-free module, so the CLI reads the constant without loading the runtime's root entry, which every `os plugin` command would otherwise pay for (about a second).
