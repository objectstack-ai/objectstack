---
'@objectstack/lint': patch
'@objectstack/metadata-protocol': patch
---

Clause-②: no
Metadata-protocol: none

A form view whose section names a field its object does not have, or a field group the object does not declare, now hears about it when it is saved and published, not only on a later read.

- `validateFormLayout` runs at the runtime publish gate for `view` writes (`runtimeTypes: ['view']`). An active save and a publish of such a view answer `form-field-unknown` / `form-section-group-unknown` in the response's `advisories`, with the lint's own message and hint. They are warnings: the write lands, nothing is refused. A draft save still runs no authoring rule; its read carries the warnings.
- The rule now also reads a stored form item's `config` (`{ name, object, viewKind: 'form', config }`, the shape Studio saves), so a Studio-authored form is judged on save, on publish and by `os validate` / `os build` / `os lint` alike, at `config.sections…` paths. A list item's `config` is not walked.
- The `/meta` view read now carries `form-section-group-unknown` in `_diagnostics.warnings` beside `form-field-unknown`, with the same message the lint prints. `valid` stays the schema's answer.
