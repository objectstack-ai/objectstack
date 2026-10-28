---
'@objectstack/formula': minor
---

feat(formula)!: the mail hole grammar refuses a hole whose formatter the whitelist does not name, by name, listing the known formatters

Clause-②: no (narrowing) — `judgeHoleFormatter` gains a third rule, `known-formatter`: a hole that names a formatter `TEMPLATE_FORMATTERS` does not hold (`{{ amount | curency:EUR }}`, `{{ due | dat:long }}`) is refused, so `parseMailHole` carries the refusal and `judgeMailHoleGrammar` reports the hole, where both accepted it before. The in-app dialect, which already refused an unknown formatter in its own parse, now also refuses an inherited object key it used to call as a formatter (`{{ x | toString }}`, which printed `[object Object]`). No accept set is widened and no export is added or removed; `TemplateHoleGrammarRule` gains the member `'known-formatter'`.
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped and no export is removed: a hole whose formatter never formatted anything is now refused where the template is judged. A conversion cannot know which formatter the author meant, and the refusal names the hole and lists the known formatters, so there is nothing for a migration to rewrite. -->

**BREAKING** accept-set narrowing in the shared hole grammar.

- **Before.** `parseMailHole(' amount | curency:EUR ')` answered a hole with no refusal, and the mail renderer printed the raw value for it (`1234.5`, an ISO timestamp), because `formatValue` knows no such formatter.
- **Now.** The hole carries a `known-formatter` refusal whose sentence names the hole and lists `TEMPLATE_FORMATTERS`. Text after the `|` that is not a single word (`{{ x | two words }}`) still names no formatter and is left as written. A chained hole is still refused by the one-formatter rule first.
- **In-app.** `templateEngine.compile` keeps its own sentence for an unknown formatter. It now also refuses `toString`, `constructor` and the other inherited object keys, which it used to accept and run as formatters.
- **Who sees it.** A template whose hole misspells a formatter or names one that does not exist. No template shipped in this repository does.

**The remedy.** Correct the formatter's name to one the refusal lists, or format the value in the caller that supplies the data and pass the finished text as its own variable.
