---
'@objectstack/spec': patch
---

fix(spec): an array in an analytics filter slot is refused once, and the refusal shows the object form

Clause-②: no
Metadata-protocol: none

A dashboard widget `filter`, a dataset or measure `filter`, or a report's `runtimeFilter` written as a list view's rule array (`[{ field: 'status', operator: 'in', value: ['new', 'in_progress'] }]`) used to fail `os validate` with two lines that contradicted each other and named no fix: `Expected record but received object.` and `Expected object but received object.`. It now fails with one `invalid_type` issue at the same path, saying that these slots take the condition object a query's `where` takes and showing it: `{ status: { $in: ['new', 'in_progress'] } }`.

Only the text changes, and the duplicate line goes. Every filter accepted before is accepted, every filter refused before is refused, and the published JSON Schema is unchanged.
