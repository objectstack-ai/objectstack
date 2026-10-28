---
'@objectstack/spec': patch
---

docs(spec): the `email_template` face descriptions and the `IEmailService` `TEMPLATE_INVALID` TSDoc name a formatter the template engine does not know among the refused holes

Clause-②: no
Metadata-protocol: none

- **The face descriptions.** `subject`, `bodyHtml` and `bodyText` now say that a hole's formatter is one the template engine knows, and that an unknown name (a misspelled `curency`) is refused, naming the known formatters. The `currency` sentence is unchanged. The refusal itself ships in `@objectstack/formula`, `@objectstack/lint` and `@objectstack/plugin-email`; the spec only states the grammar, so no accept set of any schema moves.
- **The TSDoc.** The `TEMPLATE_INVALID` error of `sendTemplate` and `renderTemplate` now names all three holes `email-template-hole-grammar` refuses: a second formatter, a formatter the whitelist does not name, and a `currency` argument that is neither a literal ISO 4217 code nor a marked `@path`.

No type, schema shape or export changes.
