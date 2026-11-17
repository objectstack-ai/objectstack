---
'@object-ui/plugin-form': patch
'@objectstack/spec': patch
---

feat(plugin-form): a `file` / `image` field whose object field declares `multiple: true` takes the whole row in the form auto-layout

Clause-②: no
Metadata-protocol: none

The form auto-layout now widens a multi-file field the way the detail view already does. A `file` or `image` field whose object field declares `multiple: true` takes the whole row by default, in every host that lays out a form: the form dialog (flat, sectioned, and the object's field groups), the full-page `ObjectForm` (flat and sectioned), `TabbedForm` and `WizardForm`. In a three- or four-column dialog its file names are no longer cut short, and its thumbnails no longer wrap inside one cell.

- **Single files stay one cell.** A `file` or `image` field without `multiple: true` keeps one cell, as before. A single file is one short name or one thumbnail.
- **The author's width wins.** An authored `span: 'full'` or `colSpan` is drawn as written. A multi-image field the author gives `colSpan: 1` stays in one cell.
- **Only the object field is read.** The rule reads `multiple` from the object field's own declaration, the same reading the detail view uses. `multiple` on any other type (a multi-value select, a multi lookup) changes nothing.

**The spec text says the same.** The `FormField.span` description in `@objectstack/spec` now names a `file` / `image` field whose object field declares `multiple: true` among the types `'auto'` sizes to the full column count, and says an authored `colSpan` still wins over that default (`colSpan: 1` keeps such a field in one cell). Description text only: the key, its values and its default are unchanged.

No metadata key is added and no export changes. `isWideFieldType` still answers on the type alone.
