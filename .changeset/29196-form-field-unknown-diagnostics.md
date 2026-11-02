---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a form view naming a field its object lacks reads with the lint's `form-field-unknown` warning in `_diagnostics`

Clause-②: no
Metadata-protocol: none

A form section that names a field the bound object does not have (a typo, or a field deleted later) is valid against the view schema, so the `/meta` door saved it, published it and served it with `_diagnostics: { valid: true }`, while the record form skips the field. The `validateFormLayout` lint rule that reports it ran only in the CLI (`os validate`, `os build`, `os lint`).

The served view read (`GET /api/v1/meta/view/NAME`, the strict draft read and the draft preview) now runs that rule on the body it serves and adds each `form-field-unknown` finding to `_diagnostics.warnings`, located at the field reference (for a stored form view item, `config.sections.N.fields.M`) and worded exactly as the rule words it:

- **A warning, not a refusal.** `valid` stays the schema's answer. A draft still saves and a publish is not refused by it.
- **The object the door serves.** Field names are judged against the object the registry serves for each object name the view spells, extensions included. A view whose object does not resolve is not judged, so it gets no warning.
- **Single-item reads only.** The list read (`GET /api/v1/meta/view`) is unchanged and pays no object lookup.
