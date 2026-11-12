---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(studio): the field inspector offers the expression editor on stored field types, so a Studio author can follow the formula-aggregate remedy

Clause-②: yes (widening)
Metadata-protocol: none

A refused `sum` / `avg` over a `formula` tells the author to make the value a field of its return type carrying the same `expression`, which the engine computes and stores on every write. Studio's field inspector showed an expression editor only on a `formula` field, so a person could not do that without hand-editing metadata.

- **`@object-ui/app-shell`:** a "Computed value" section with a CEL editor (`record` scope, live lint, sibling field picker) now appears on every field type a client otherwise writes: every type outside the spec's `COMPUTED_VALUE_TYPES` (`formula`, `summary`, `autonumber`). A `summary` or `autonumber` that already carries an `expression` still shows it. Typing writes `expression` (an existing `{ dialect, source }` envelope keeps its other keys); emptying the editor removes the key. Once a field carries an expression, the inspector reads it as computed and read-only: the section says so, the Default value editor is not offered, and the Read-only box shows ticked and cannot be cleared, with nothing written for it. A lint error in the editor holds Save like the formula editor's does. A `formula` field keeps its own editor and now says under it that it stores no value, and that changing Type to its return type keeps the expression and stores the value. No metadata key or accepted value changes.
- **`@object-ui/i18n`:** five new keys in the published Studio namespace catalogue (`@object-ui/i18n/namespaces/studio`, `en` and `zh`), a widening: `designer.field.section.computed`, `designer.field.storedExpression`, `designer.field.storedExpression.hint`, `designer.field.storedExpression.computed` and `designer.field.formula.storedHint`. No key is removed or renamed, and the eager locale packs (`TranslationKeys`) are unchanged.
