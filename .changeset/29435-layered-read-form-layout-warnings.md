---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): the layered read of a form view naming a field its object lacks now carries the form-field-unknown warning

Clause-②: no
Metadata-protocol: none

`GET /api/v1/meta/view/NAME?layers=true` judged its `_diagnostics` with the schema alone, so a published form view whose section names a missing field (or an undeclared field group) read `{ valid: true }` there, while `GET /api/v1/meta/view/NAME` of the same view carried the lint's warning. Studio's item editor reads the layered answer when no draft is pending, so the author of a published form view saw no warning.

The layered read now runs the same form-layout pass on its `effective` body that the single-item read runs, against the object the registry serves for each name the view spells. The warnings land at the same paths, and `valid` stays the schema's answer. A form naming only real fields still reads `{ valid: true }`.
