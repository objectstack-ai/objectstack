---
'@objectstack/spec': patch
---

docs(spec): `IEmailService.sendTemplate` and `renderTemplate` list `TEMPLATE_INVALID` in their Errors

Clause-②: no
Metadata-protocol: none

`@objectstack/plugin-email` already refuses a stored template whose hole the authoring rules refuse (rule `email-template-hole-grammar`), throwing `TEMPLATE_INVALID: email template NAME (locale=LOCALE): HOLE_AND_RULE` from both methods. The contract's Errors lists now name that code beside `TEMPLATE_NOT_FOUND`, `TEMPLATE_INACTIVE` and `MISSING_VARIABLES`, so a channel or app author reading `IEmailService` knows the failure is permanent until the template is re-published. Documentation only: no type or schema changes.
