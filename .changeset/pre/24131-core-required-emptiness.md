---
"@objectstack/core": minor
---

feat(core): export the emptiness rule a `required` declaration is judged by — `isEmptyForRequired(def, value)` and `isMissing(value)`

Clause-②: yes (widening)

- **New exports from `@objectstack/core`'s `.` entry.** `isMissing(value)` is `true` for `undefined`, `null`, and a string that is empty or only whitespace. `isEmptyForRequired(def, value)` is `isMissing`, plus an empty list `[]` on a field whose DECLARED value is a set (`@objectstack/spec/data`'s `isMultiValueField`: `tags`, `multiselect`, `checkboxes`, or a `select` / `radio` / `lookup` / `user` / `file` / `image` field flagged `multiple: true`). `def` is a `ValueShapeFieldDef` (`{ type, multiple? }`). A structured-JSON field's `[]` is a document, not an empty value.
- **Why it moved.** It was private to `@objectstack/objectql`'s record validator, where the object-level `required` check runs. `@objectstack/rest`'s anonymous public-form submit route now judges a FORM's `required` with it, and rest does not depend on the engine at runtime. So the one rule lives in the package both depend on, and the two doors call the same field missing.
- **Unchanged:** the rule itself, byte for byte — the engine's object-level `required` refusal answers exactly what it did.
