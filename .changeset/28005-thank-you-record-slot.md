---
'@objectstack/spec': minor
'@objectstack/lint': minor
---

feat(spec): a form's thank-you panel can name the record's engine-generated fields, and the public submit answer has a declared shape

Clause-②: yes (widening)
Metadata-protocol: added

A public form's confirmation panel could not tell a web-to-case visitor their case number: `title` and `message` were plain text, and `POST /api/v1/forms/SLUG/submit` answers `{ id }` only.

- **The slot.** A form's `submitBehavior: { kind: 'thank-you', title, message }` may name a field of the record just submitted as `{{record.field_name}}`, the same token the `redirect` behavior's `url` takes. Any other brace is refused at parse, naming the offending text: `{record.x}`, `{{ record.x }}` and `{{case_number}}` are not the token.
- **Only engine-generated fields.** A named field must be one whose value the engine generates on insert: its type is in `RUNTIME_OWNED_FIELD_TYPES` (today `autonumber`). Any other stored value may have been set by a `beforeInsert` / `afterInsert` hook from records an anonymous visitor cannot read. `os validate`, `os build`, `os lint` and the publish gate on a `view` or `page` write refuse any other name (rule `thank-you-record-field`), naming the field and its type. This covers every form view shape and a page `object-form` component.
- **The answer shape.** `PublicFormSubmitResponseSchema` (`@objectstack/spec/api`) declares the submit answer as `id` plus an optional `fields` map holding exactly the named fields, and nothing else. `thankYouRecordFieldNames` (`@objectstack/spec/ui`) reads which fields a panel names.

The server fills `fields` and the console fills the tokens in follow-up releases. Until then, a panel that names a field shows the token text as written.
