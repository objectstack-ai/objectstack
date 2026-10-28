---
'@objectstack/spec': patch
---

docs(spec): the `email_template` face descriptions and the `IEmailService` `TEMPLATE_INVALID` TSDoc state the formatter shape a mail hole is held to

Clause-②: no
Metadata-protocol: none

- **The face descriptions.** `subject`, `bodyHtml` and `bodyText` now say that a formatter is one word, optionally followed by `:` and its argument, and that text which is not (such as `date-long`) is refused. The refusal itself ships in `@objectstack/formula`, `@objectstack/lint` and `@objectstack/plugin-email`; the spec only states the grammar, so no accept set of any schema moves.
- **The TSDoc.** The `TEMPLATE_INVALID` error of `sendTemplate` and `renderTemplate` now names text after the `|` that is not a formatter name among the holes `email-template-hole-grammar` refuses.

No type, schema shape or export changes.
