---
'@objectstack/spec': patch
---

docs(spec): `IEmailService.sendTemplate` and `renderTemplate` list a formatter the whitelist does not name among the holes `TEMPLATE_INVALID` refuses

Clause-②: no
Metadata-protocol: none

The TSDoc on the `TEMPLATE_INVALID` error of both methods now names all three holes the `email-template-hole-grammar` rule refuses: a second formatter, a formatter the whitelist does not name, and a `currency` argument that is not a literal ISO 4217 code. No type, schema or export changes.
