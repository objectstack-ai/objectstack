---
'@objectstack/lint': minor
---

feat(lint): `email-template-hole-grammar` accepts `currency:@path` and refuses a marked path the template's declared variables do not declare

Clause-②: yes
Metadata-protocol: added

`os validate`, `os build`, `os lint` and the `email_template` publish door accept a mail template hole such as `{{ planned_amount | currency:@currency_code }}`, which reads the ISO 4217 code from the send's data, when its path is well-formed. When the template declares `variables`, a marked path that none of them declares, itself or as a root it lies under (`contract` declares `contract.currency_code`), is refused at `error` (a `422 INVALID_METADATA` at the publish door), naming the hole and the path. A template that declares no variables has the path judged at render.

Everything the rule refused before stays refused: a bare path (`currency:currency_code`), a lowercase or empty code, a quoted or empty marked path, and a second formatter. The finding's hint now quotes the argument rule, `CURRENCY_ARGUMENT_RULE` from `@objectstack/formula`.
