---
'@object-ui/plugin-designer': patch
---

refactor(plugin-designer)!: retire six zero-consumer exports (the collaboration provider and its status indicator, three canvas hooks and the property editor)

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @object-ui/plugin-designer#CollaborationProvider, @object-ui/plugin-designer#ConnectionStatusIndicator, @object-ui/plugin-designer#useClipboard, @object-ui/plugin-designer#useMultiSelect, @object-ui/plugin-designer#useCanvasPanZoom, @object-ui/plugin-designer#PropertyEditor) the retired operands are React components and hooks in a published ui package's entry that nothing in the workspace or in hotcrm imported; no packages/spec schema, registered node type, ADR-0087 conversion surface or stored shape names them, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** for a host that imports any of these six names from `@object-ui/plugin-designer`. None had an importer anywhere in the workspace or in hotcrm, so the Console and every `@object-ui/*` package are unaffected. Every module stays in the package (the four designers keep using the hooks and the property panel internally); only the entry stops publishing them. The designers, their `…Props` types, `useUndoRedo`, `useDesignerHistory`, `useConfirmDialog`, `ConfirmDialog`, `Minimap`, `VersionHistory`, the app pages and the metadata pages stay exported unchanged.

What leaves, and what to write instead (none has a replacement export):

- FROM `CollaborationProvider`, `ConnectionStatusIndicator` TO no replacement: render the designers without the wrapper; real-time co-editing is no longer offered from outside the package.
- FROM `useClipboard`, `useMultiSelect`, `useCanvasPanZoom` TO no replacement: the designer canvases already copy/paste, multi-select and pan/zoom on their own; keep a local copy of the hook if you used it in your own canvas.
- FROM `PropertyEditor` TO no replacement: the designers render their own property panel; for a form of your own, use `SchemaRenderer` with a form schema.
