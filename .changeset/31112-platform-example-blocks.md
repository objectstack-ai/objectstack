---
'@objectstack/skills': patch
---

docs(skills): objectstack-platform's manifest example is type-checked, and the plugin-development examples compile against the kernel's Plugin contract

Clause-②: no
Metadata-protocol: none

`skills/objectstack-platform/SKILL.md` § Manifest Reference showed a bare `manifest: { … }` fragment. It is now a `defineStack({ manifest: { … } })` call under the opt-in check marker, so `check:skill-examples` compiles it against `@objectstack/spec`. The comment on `engines` that restated the paragraph below it is gone, and `description` is still marked optional. In `references/plugin-development.md`, the complete audit-plugin example set `type: 'plugin'` on a kernel plugin object. That value is outside the closed `PluginType` set (`'standard'` plus the core plugin types), so it does not compile, and `kernel.use()` refuses it at boot with `PLUGIN_CONTRACT_VIOLATION`. The example now sets `type: 'standard'`. The Plugin Interface overview imported the `Plugin` it then declares, and used `PluginType` without importing it. It now imports `PluginContext` and `PluginType`. No other rule changes. The other platform blocks in these four files stay unmarked. Each one needs `@objectstack/core`, a runtime package or a project-local module, or it is a fragment, and the checker resolves `@objectstack/spec` only.
