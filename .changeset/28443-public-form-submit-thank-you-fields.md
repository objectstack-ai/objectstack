---
'@objectstack/rest': patch
---

feat(rest): the public form submit answer carries the engine-generated fields its thank-you panel names

Clause-②: yes (widening)
Metadata-protocol: none

`POST /api/v1/forms/:slug/submit` answers `PublicFormSubmitResponseSchema` (`@objectstack/spec/api`): the created record's `id`, as before, plus `fields` when the form's `thank-you` panel names fields of the record as `{{record.field_name}}`. `fields` holds the stored values of exactly the names `thankYouRecordFieldNames(form.submitBehavior)` returns, so a web-to-case visitor can be shown the case number the engine just generated. A form whose panel names no field still answers `{ id }` alone.

Nothing else the insert stored is answered: a `beforeInsert` / `afterInsert` hook, an elevated one included, may have derived a stored value from records the anonymous form grant cannot read. So the route re-checks every named field when it answers, and drops a name unless the object declares it with a type in `RUNTIME_OWNED_FIELD_TYPES` (today `autonumber`) and the row the insert answered carries it as a string or a number. That covers an object retyped after the form was published, which the `thank-you-record-field` authoring rule cannot see. `fields` is left out when no name survives.

The route ledger now names `PublicFormSubmitResponseSchema` as this route's `responseSchema`.
