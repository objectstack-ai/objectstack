---
'@objectstack/skills': patch
---

docs(skills): the Plugin Interface overview in objectstack-platform's plugin-lifecycle rule imports what it uses

Clause-②: no
Metadata-protocol: none

`skills/objectstack-platform/rules/plugin-lifecycle.md` § Plugin Interface imported the `Plugin` type it then declares, and used `PluginType` without importing it. It now imports `PluginContext` and `PluginType` from `@objectstack/core`, the same shape as the overview in `references/plugin-development.md`. No rule changes. The other blocks in the two platform rules files stay unmarked: each needs `@objectstack/core` or a project-local name, or is a fragment, and the example checker resolves `@objectstack/spec` only.
