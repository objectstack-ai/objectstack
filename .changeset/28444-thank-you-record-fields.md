---
'@object-ui/console': minor
---

feat(console): a public form's thank-you panel shows the record field values its `{{record.field_name}}` tokens name

Clause-②: no
Metadata-protocol: semantic

A `thank-you` panel's `title` and `message` may name an engine-generated field of the record just submitted (an `autonumber` field, such as a case number) as `{{record.field_name}}`. On the public form route the Console now replaces each such token with the value the submit answer carries for it under `fields` (`PublicFormSubmitResponseSchema`, `@objectstack/spec/api`), so a web-to-case visitor sees their case number instead of the token's own text:

```ts
submitBehavior: { kind: 'thank-you', message: 'Your case number is {{record.case_number}}.' }
```

- Which tokens a text holds is read by the spec's `thankYouRecordFieldNames`; the Console has no token grammar of its own.
- A token the answer carries no value for shows as empty, never as the token's text.
- A value is drawn as plain text, never as markup, and a filled value is never read for tokens again.
