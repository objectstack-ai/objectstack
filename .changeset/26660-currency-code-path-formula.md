---
'@objectstack/formula': minor
---

feat(formula): the mail hole grammar admits `currency:@path`, which reads the ISO 4217 code from the send's data; the in-app template dialect refuses that form by name

Clause-②: yes
Metadata-protocol: added

A mail template can now format each record's amount in that record's own currency: `{{ planned_amount | currency:@currency_code }}`. The rule, exported as `CURRENCY_ARGUMENT_RULE`: a `currency` argument is either a literal ISO 4217 code in three capital letters (`currency:EUR`) or, in a mail template only, `@` followed by a path into the send's data whose value is such a code (`currency:@currency_code`).

- **Widened:** `parseMailHole` and `judgeMailHoleGrammar` admit `currency:@path` when the path is a dotted path of word characters with no empty segment, written right after the `@` and not in quotes. The parsed hole carries the path as `codePath`.
- **Unchanged refusals:** a bare argument is still never read as a path, so `currency:currency_code`, `currency:record.currency_code`, a lowercase or empty code and a double-quoted code stay refused (`currency-code-literal`); so do `currency:@`, `currency:@ x`, `currency:'@x'` and `currency:@a..b`. In the mail dialect that refusal now names the marked form as the way to read a code from the data.
- **Declared variables:** `judgeMailHoleGrammar(face, { variables })` refuses a marked path that none of the template's declared variables names, itself or as a root it lies under (`currency-code-path-undeclared`), when the template declares any.
- **In-app dialect:** `templateEngine` (flow text slots, action and bulk-action copy, `titleFormat`, `promptTemplate`) refuses `currency:@path` at compile and evaluate with its own rule, `currency-code-path-mail-only`: the doors that judge that text check a hole's path against the roots a slot binds and never read an argument. It was refused there before too, as `currency-code-literal`.
- **The value:** `currencyCodeValueRefusal(hole, path, value)` names a resolved value that is not an ISO 4217 code in three capital letters exactly as stored (missing, `null`, `eur`, `' EUR'`, a number). `formatValue('currency', …)` still never reads a path and still throws for a non-code argument; no argument still formats in US dollars.

New exports: `CURRENCY_ARGUMENT_RULE`, `currencyCodePath`, `currencyCodeValueRefusal`, and the types `TemplateHoleDialect` and `MailHoleGrammarOptions`. `judgeHoleFormatter` takes an optional fifth argument, the dialect (`'in-app'` by default, `'mail'`), and `TemplateHoleGrammarRule` gains `currency-code-path-mail-only` and `currency-code-path-undeclared`.
