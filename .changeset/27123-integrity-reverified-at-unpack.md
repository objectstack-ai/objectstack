---
'@objectstack/spec': patch
'@objectstack/core': patch
---

docs(spec, core): the plugin manifest's `integrity` map is described as re-verified at unpack by `os plugin install`, and the platform-object registry lists `sys_trusted_key` (#27123)

Clause-②: no — no authorable key or accepted value changes. `PLATFORM_OBJECTS_BY_PACKAGE['platform-objects']` gains the `sys_trusted_key` row its maintenance contract requires for an object `@objectstack/platform-objects` now registers (a list of platform-object names, not an authorable surface); the rest is prose: the TSDoc of `PluginIntegritySchema` and the manifest's `integrity` field, and comments in `@objectstack/core`'s security module, with no `.describe()` text changed
Metadata-protocol: none

The TSDoc said nothing in the repo re-verified the map after publish and that there was no `os plugin install`. `os plugin install` now re-hashes the unpacked files against the map before it installs anything, and refuses the install on a mismatch, so the text says that. An absent map is still a permissive pass. The liveness ledger's `integrity` row moves from `dead` to `live` on that reader.

`sys_trusted_key` joins the `platform-objects` group of `PLATFORM_OBJECTS_BY_PACKAGE`, so `PLATFORM_PROVIDED_OBJECT_NAMES` counts it as platform-provided like its siblings.
