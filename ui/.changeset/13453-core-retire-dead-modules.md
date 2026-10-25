---
"@object-ui/core": minor
---

Clause-②: no
Metadata-protocol: none

**Breaking:** removed exports with no reader (objectui#13453). Declared `minor` per the version-alignment policy (a changeset never declares `major`).

- The fluent schema builders from `builder/schema-builder`: `form`, `button`, `input`, `card`, `grid`, `flex` and the `FormBuilder`, `ButtonBuilder`, `InputBuilder`, `CardBuilder`, `GridBuilder`, `FlexBuilder` classes. Write the schema object literally instead.
- The three protocol bridges, `DndProtocol`, `KeyboardProtocol` and `SharingProtocol`: `resolveDndConfig`, `createDragItemProps`, `createDropZoneProps`, `resolveDragConstraints`, `resolveKeyboardConfig`, `parseShortcutKey`, `matchesShortcut`, `createFocusTrapConfig`, `resolveSharingConfig`, `resolveEmbedConfig`, `generateEmbedCode`, `validateSharingConfig` and their types (`DndConfig`, `DragItem`, `DropZone`, `KeyboardShortcut`, `FocusTrapConfig`, `KeyboardNavigationConfig` and the rest). The spec vocabulary they bridged was already deleted upstream; no replacement.
- The test-only helpers `resetColumnIdentityWarnings`, `resetRetiredSortSpellingReports`, `resetDashboardFilterWarnings` and `resetReferenceKeyWarnings` are no longer on the package root. They reset module state for tests and had no other reader.
