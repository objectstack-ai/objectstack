---
'@objectstack/spec': minor
---

docs(spec): the `email_template` faces state the mail hole grammar, including `currency:@path`, which reads the ISO 4217 code from the send's data

Clause-②: yes
Metadata-protocol: added

`EmailTemplateDefinitionSchema`'s `subject`, `bodyHtml` and `bodyText` descriptions now state the hole grammar a mail template is rendered and judged with: holes are `{{ path }}` or `{{ path | formatter[:arg] }}` over the send's `data`, with one formatter per hole, and a `currency` argument is either a literal ISO 4217 code in three capital letters (`currency:EUR`) or, in a mail template only, `@` followed by a path into the send's data whose value is such a code (`currency:@currency_code`). The `variables[].name` description adds that, when a template declares any variable, the path of a `currency:@path` argument must be one of them or lie under one.

Only descriptions change; no key, type or default does. The form itself is judged by `@objectstack/formula`, refused or accepted at authoring by `@objectstack/lint` and rendered by `@objectstack/plugin-email`.
