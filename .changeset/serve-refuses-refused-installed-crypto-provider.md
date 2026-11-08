---
'@objectstack/cli': patch
'@objectstack/runtime': patch
---

fix(cli)!: `os serve` refuses to boot when an installed plugin that may provide the crypto provider is refused at boot

Clause-②: yes (narrowing) — `os serve` (and the `serve` child of `os start` and `os dev`) refuses to boot when a plugin `os plugin install` installed is refused at boot and nothing rules out that it provides the crypto provider (`crypto-provider`), where every such refusal was non-fatal and the boot went on; widened beside it: the optional `declaredServices` on `InstalledPluginRefusal` and `LoadedInstalledPlugin` (`@objectstack/runtime`).
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no key of any schema is added, removed or re-shaped and no stored row is converted: a boot whose installed plugins hold a refusal that may be the crypto provider stops until the operator fixes that plugin or disables it, which is a choice about one installed plugin made by hand, not a mechanical conversion -->

**BREAKING** for a deployment that boots `os serve`, `os start` or `os dev` with an installed plugin (`os plugin install`) that is refused at boot.

- **Before.** A refused installed plugin was printed (`✗ Refused installed plugin id@version (code)`), and the boot went on without it, whatever the refusal.
- **Now.** The boot stops, before any plugin starts, when a refused installed plugin may provide the crypto provider. That provider seals every secret field, datasource credential and encrypted setting, so the boot does not choose another one. This is the rule a stack `plugins` entry that does not load already follows. A refusal is ruled out, and the boot goes on as before, when:
  - the plugin's verified artifact declares a tier this host does not run in process (`runtime_undeclared`, `runtime_not_dispatched`);
  - or the plugin was imported, is an object, and its `providesServices` (ADR-0116) could be read and does not name `crypto-provider`.
  Every other refusal stops the boot, a loader that fails outright included. A disabled plugin is not a refusal.
- **What it says.** The refusal names each plugin as `id@version` with its refusal code, and the step that lets the next boot go on. For most codes that is `os plugin disable <id>`.
  - A record whose directory is not its install directory (`install_dir_unexpected`) is installed again.
  - An uninstall the boot could not finish (`uninstall_failed`, `record_changed`) is finished by a later boot.
  - An unreadable disable-state file or installations file is repaired.
- **`@objectstack/runtime`.** `InstalledPluginRefusal` and `LoadedInstalledPlugin` gain an optional `declaredServices`: what an imported plugin declares in `providesServices`, absent when it was not imported, is not an object, or its declaration could not be read.
- **Who moves, and the fix.** A deployment whose boot now stops fixes the named plugin (installs it again, trusts its key, or whatever its refusal code names), or runs the step the refusal names, then boots again.
