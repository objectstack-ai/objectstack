---
'@objectstack/cli': patch
'@objectstack/runtime': patch
---

fix(cli)!: the one-shot secret commands choose the crypto provider from the installed plugins too, by `os serve`'s rule

Clause-②: yes (narrowing) — `os secret rewrap`, `os secret orphans` and the data migrations' settings arm refuse to run when a plugin `os plugin install` installed is refused and nothing rules out that it provides the crypto provider (`crypto-provider`), and when a config plugin and an installed plugin both declare it, where they ran without reading the installed plugins; widened beside it: the optional `leaveUninstallsPending` on `LoadInstalledPluginsInput` (`@objectstack/runtime`).
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no key of any schema is added, removed or re-shaped and no stored row is converted: a one-shot run whose installed plugins hold a refusal that may be the crypto provider stops until the operator fixes that plugin or disables it, which is a choice about one installed plugin made by hand, not a mechanical conversion -->

**BREAKING** for a deployment that runs `os secret rewrap`, `os secret orphans` or a data migration with an installed plugin (`os plugin install`) that `os serve` would refuse to boot with, or with a crypto provider declared both in the host config's `plugins` and by an installed plugin.

- **Before.** A one-shot run chose the crypto provider from the host config's `plugins` only. The installed plugins of the project were not read.
- **Now.** The installed plugins are read beside the config's `plugins`, through the loader `os serve`'s boot reads them with, and judged by the same rule:
  - an installed plugin that loads and declares `crypto-provider` is the plugin the run seals and opens with;
  - a refused installed plugin that may provide it refuses the run, naming the plugin, its refusal code and the step `os serve`'s refusal names;
  - two declaring plugins, config or installed, are refused, both named;
  - an installed plugin whose name a config plugin takes is refused as `plugin_name_taken`, as `os serve` refuses it.
  The run registers and removes none of the installed plugins: a pending uninstall is left for the next boot.
- **`@objectstack/runtime`.** `loadInstalledPlugins` takes an optional `leaveUninstallsPending`. When it is set, a pending uninstall is neither finished nor loaded.
- **Who moves, and the fix.** A deployment whose one-shot run now stops runs the step the refusal names (fix the installed plugin, or `os plugin disable <id>`), or keeps one declaration of the crypto provider, then runs it again.
