---
'@object-ui/console': patch
---

fix(console): the public form prints a form entry's own label as served, not the app bundle's object-field translation

Clause-②: no
Metadata-protocol: none

A form entry that declares its own `label` is the form's visitor-facing copy, and the form endpoint already serves it localized (from `_sections.SECTION.fields.FIELD.label` in the app's translations). The public form page then looked the field up in the app bundle as `fields.OBJECT.FIELD` first and printed that whenever the browser held the bundle, which translates the object field's label, the one agents see. So a visitor who was signed in to the same console, or any visit with the bundle loaded, read the agent-side label (for example "Submitter name" where the form says "Your name"), while a cold anonymous visit read the form's own label.

Each row now records where its label came from. A row whose entry declared a `label` prints it as served; only a row whose label came from the object field takes the bundle translation, as before. The required-field and `visibleWhen` refusal messages name each field by the same rule, so they use the label the visitor sees.
