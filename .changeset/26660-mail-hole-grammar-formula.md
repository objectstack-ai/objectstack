---
'@objectstack/formula': minor
---

feat(formula)!: a template hole takes one formatter, and the `currency` formatter's argument is a literal ISO 4217 code — both refused at compile, never rendered as formatter syntax or in US dollars

Clause-②: no (narrowing) — the in-app template dialect's compile (and so `os validate` and the publish gate for every template slot) refuses a hole with a second formatter (`{{ x | default:0 | number:2 }}`) and a `{{ x | currency:ARG }}` hole whose `ARG` is not three capital letters, both of which it accepted before; `formatValue('currency', value, ARG)` now throws a `RangeError` for such an `ARG`: a path or another argument `Intl` refuses, and an empty one, used to fall back to US dollars, and a lowercase code (`eur`), which `Intl` formatted in that currency, is now refused too. No accept set is widened; the additions are exports only: `judgeHoleFormatter`, `mailHolePattern`, `parseMailHole`, `judgeMailHoleGrammar`, and the types `TemplateHoleGrammarRefusal`, `TemplateHoleGrammarRule`, `ParsedMailHole` and `MailHoleGrammarFinding`.
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped and no export is removed: a chained formatter and a currency argument that never rendered as written are now refused where the template is compiled. The refusal names the hole and the rule it breaks, so there is nothing for a migration to rewrite. -->

**BREAKING** accept-set narrowing in the template dialect, and a new shared mail hole grammar.

- **Before, a chained hole.** `{{ record.n | default:0 | number:2 }}` compiled as `default` with the argument `0 | number:2`, and rendered that text.
- **Before, a currency path.** `{{ record.amount | currency:currency_code }}` compiled; `Intl` refused the argument and the formatter caught that and used US dollars, so the amount printed in a currency nobody wrote.
- **Now.** `templateEngine.compile` / `evaluate` answer a `parse` error naming the hole and the rule. `formatValue('currency', …)` throws a `RangeError` for an argument that is not a code, before it reads the value. A lowercase code (`currency:eur`), which formatted in euros before, is refused the same way. No argument still formats in US dollars.
- **Shared grammar.** `judgeHoleFormatter` is the judgement both template dialects use. The mail template grammar is exported once, `mailHolePattern`, `parseMailHole` and `judgeMailHoleGrammar`, and is what `@objectstack/plugin-email`'s renderer, `judgeMailHtmlHoles` and `@objectstack/lint` read; `judgeMailHtmlHoles` no longer keeps a copy of it.
- **Who sees it.** A template slot that chained formatters, or wrote a path or a lowercase code as the currency argument. No template shipped in this repository does.

**The remedy.** Keep one formatter per hole and decide anything more where the data is assembled. Write the currency code itself (`currency:EUR`), or format the amount where the data is assembled and pass the formatted text.
