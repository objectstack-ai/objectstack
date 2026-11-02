---
'@object-ui/plugin-designer': patch
---

refactor(plugin-designer)!: retire `useConfirmDialog` and `VersionHistory` from the entry, and delete the designers' dead collaboration code

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @object-ui/plugin-designer#useConfirmDialog, @object-ui/plugin-designer#VersionHistory) the retired operands are a React hook and a React component in a published ui package's entry that nothing in the workspace or in hotcrm imported; no packages/spec schema, registered node type, ADR-0087 conversion surface or stored shape names them, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** for a host that imports `useConfirmDialog` or `VersionHistory` from `@object-ui/plugin-designer`. Neither had an importer anywhere in the workspace or in hotcrm, so the Console and every `@object-ui/*` package are unaffected.

- The `VersionHistory` timeline module is deleted: nothing in the package rendered it. The `designer.versionHistory` translation key stays in the locale packs for now, with no reader.
- `useConfirmDialog` stays inside the package, because the designers use it for their delete prompts. Only the entry stops publishing it.
- The collaboration code that became unreachable once the previous release stopped exporting `CollaborationProvider` is deleted. That covers the provider module, the always-null `useCollaboration()` branches in the page, data model, process and report designers, and their "N users" / "Connected" toolbar chips. Nothing outside the package could mount the provider, so no designer behaves differently.

What leaves, and what to write instead (neither has a replacement export):

- FROM `useConfirmDialog` TO no replacement: render your own confirm prompt with `ConfirmDialog` (still exported) and local `useState`.
- FROM `VersionHistory` TO no replacement: render the version list in your own component. The designers never showed one.
