---
'@objectstack/cli': patch
'@objectstack/runtime': patch
---

fix(cli): `os serve` refuses to boot when an installed plugin that may provide the crypto provider is refused at boot

Clause-②: no
Metadata-protocol: none

A plugin `os plugin install` installed is verified again at every boot. When it is refused there and nothing rules out that it provides the crypto provider (`crypto-provider`), `os serve` now refuses to boot. The refusal names each such plugin with its refusal code and gives `os plugin disable <id>` as the way to boot without it. This is the rule a stack's `plugins` entry that does not load already follows.

- A refusal is ruled out when the plugin's verified artifact declares a tier this host does not run in process (`runtime_undeclared`, `runtime_not_dispatched`).
- A refusal is also ruled out when the plugin was imported and its `providesServices` (ADR-0116) could be read and does not name `crypto-provider`.
- Every other refusal is refused, including a loader that fails outright.
- A disabled plugin is not a refusal.

`@objectstack/runtime`: `InstalledPluginRefusal` and `LoadedInstalledPlugin` gain an optional `declaredServices`. It holds what an imported plugin declares in `providesServices`, and is absent when the plugin was not imported or the declaration could not be read.
