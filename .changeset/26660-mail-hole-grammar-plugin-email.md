---
'@objectstack/plugin-email': minor
---

feat(plugin-email)!: a mail template hole whose `currency` argument is not a literal ISO 4217 code fails the render with `TEMPLATE_INVALID` instead of printing the amount in US dollars

Clause-②: no (narrowing) — `sendTemplate` and `renderTemplate` refuse a stored template whose `subject`, `body_text` or `body_html` writes `{{ x | currency:ARG }}` with an `ARG` that is not three capital letters, which rendered before. Nothing is widened.
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped and no export changes: the renderer refuses a hole the authoring rule refuses, for a template that reached it without being judged. There is nothing for a migration to rewrite. -->

**BREAKING** a render that printed a wrong currency now fails.

- **Before.** `{{ planned_amount | currency:currency_code }}` with `currency_code = 'eur'` rendered `US$1,234.50` (zh-CN), `$1,234.50` (en-US) and `1 234,50 $US` (fr-FR), in every face.
- **Now.** The render throws `TEMPLATE_INVALID: email template NAME (locale=LOCALE): …`, naming the hole and the literal-only rule; `sendTemplate` sends nothing. The authoring doors refuse the same hole first (`email-template-hole-grammar`), so this is reached only by a template stored before that rule, until its next publish.
- **The grammar.** The renderer parses holes with `@objectstack/formula`'s `parseMailHole`, the grammar the authoring rule and the placement judge read; it keeps no copy of its own.

**The remedy.** Republish the template with a literal code (`currency:EUR`), or format the amount in the caller and pass the formatted text as its own variable.
