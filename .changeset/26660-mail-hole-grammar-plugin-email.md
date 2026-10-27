---
'@objectstack/plugin-email': minor
---

feat(plugin-email)!: a mail template hole that chains a second formatter, or whose `currency` argument is not a literal ISO 4217 code, fails the render with `TEMPLATE_INVALID` instead of printing formatter syntax or US dollars

Clause-②: no (narrowing) — `sendTemplate` and `renderTemplate` refuse a stored template whose `subject`, `body_text` or `body_html` writes a hole with a second formatter, or `{{ x | currency:ARG }}` with an `ARG` that is not three capital letters, both of which rendered before. Nothing is widened.
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped and no export changes: the renderer refuses a hole the authoring rule refuses, for a template that reached it without being judged. There is nothing for a migration to rewrite. -->

**BREAKING** a render that printed a wrong currency now fails.

- **Before, a chained hole.** `{{ actual_amount | default:0 | number:2 }}` rendered `0 | number:2` for an empty value and `71100` otherwise, in every face.
- **Before, a currency path.** `{{ planned_amount | currency:currency_code }}` with `currency_code = 'eur'` rendered `US$1,234.50` (zh-CN), `$1,234.50` (en-US) and `1 234,50 $US` (fr-FR), in every face.
- **Now.** The render throws `TEMPLATE_INVALID: email template NAME (locale=LOCALE): …`, naming the hole and the rule it breaks (one formatter per hole, or the literal-only currency code); `sendTemplate` sends nothing. The authoring doors refuse the same hole first (`email-template-hole-grammar`), so this is reached only by a template stored before that rule, until its next publish.
- **The grammar.** The renderer parses holes with `@objectstack/formula`'s `parseMailHole`, the grammar the authoring rule and the placement judge read; it keeps no copy of its own.

**The remedy.** Republish the template with one formatter per hole and a literal currency code (`currency:EUR`), or format the amount in the caller and pass the formatted text as its own variable.
