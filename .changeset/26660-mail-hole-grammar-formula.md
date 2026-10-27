---
'@objectstack/formula': minor
---

feat(formula)!: the `currency` template formatter's argument is a literal ISO 4217 code — a path argument is refused at compile and never formats in US dollars

Clause-②: no (narrowing) — the in-app template dialect's compile (and so `os validate` and the publish gate for every template slot) refuses a `{{ x | currency:ARG }}` hole whose `ARG` is not three capital letters, which it accepted before; `formatValue('currency', value, ARG)` throws a `RangeError` for such an `ARG` instead of formatting in US dollars. Nothing is widened.
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped and no export is removed: a formatter argument that never rendered as written is now refused where the template is compiled. The refusal names the hole and the literal-only rule, so there is nothing for a migration to rewrite. -->

**BREAKING** accept-set narrowing in the template dialect, and a new shared mail hole grammar.

- **Before.** `{{ record.amount | currency:currency_code }}` compiled; `Intl` refused the argument and the formatter caught that and used US dollars, so the amount printed in a currency nobody wrote.
- **Now.** `templateEngine.compile` / `evaluate` answer a `parse` error naming the hole and the rule. `formatValue('currency', …)` throws a `RangeError` for an argument that is not a code, before it reads the value. No argument still formats in US dollars.
- **Shared grammar.** `judgeHoleFormatter` is the judgement both template dialects use. The mail template grammar is exported once, `mailHolePattern`, `parseMailHole` and `judgeMailHoleGrammar`, and is what `@objectstack/plugin-email`'s renderer, `judgeMailHtmlHoles` and `@objectstack/lint` read; `judgeMailHtmlHoles` no longer keeps a copy of it.
- **Who sees it.** A template slot that wrote a path or a lowercase code as the currency argument. No template shipped in this repository does.

**The remedy.** Write the code itself (`currency:EUR`), or format the amount where the data is assembled and pass the formatted text.
