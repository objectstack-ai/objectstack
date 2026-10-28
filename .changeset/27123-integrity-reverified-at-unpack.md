---
'@objectstack/spec': patch
'@objectstack/core': patch
---

docs(spec, core): the plugin manifest's `integrity` map is described as re-verified at unpack by `os plugin install` (#27123)

Clause-②: no — prose only: the TSDoc of `PluginIntegritySchema` and the manifest's `integrity` field, and comments in `@objectstack/core`'s security module; no `.describe()` text, key, accepted value or export changes
Metadata-protocol: none

The TSDoc said nothing in the repo re-verified the map after publish and that there was no `os plugin install`. `os plugin install` now re-hashes the unpacked files against the map before it installs anything, and refuses the install on a mismatch, so the text says that. An absent map is still a permissive pass.
