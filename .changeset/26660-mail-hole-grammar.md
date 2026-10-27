---
'@objectstack/lint': minor
---

feat(lint)!: a new gating authoring rule, `email-template-hole-grammar`, refuses an email template hole that chains a second formatter or whose `currency` argument is not a literal ISO 4217 code

Clause-②: no (narrowing) — `os validate`, `os build`, `os lint` and the metadata publish door (`422 INVALID_METADATA`) refuse an `email_template` whose `subject`, `bodyText` or `bodyHtml` writes a hole with a second formatter (`{{ x | default:0 | number:2 }}`) or `{{ x | currency:ARG }}` with an `ARG` that is not three capital letters, both of which they accepted before. No accept set is widened; the additions are exports only: `validateEmailTemplateHoleGrammar`, `EMAIL_TEMPLATE_HOLE_GRAMMAR`, the type `EmailTemplateHoleGrammarFinding`, and the rule id `email-template-hole-grammar`.
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped: a hole that never rendered as written (the renderer printed formatter syntax, or the amount in US dollars) is now refused where it is authored. The refusal names the hole and the rule it breaks, so there is no key for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at every authoring door for `email_template`.

- **Before, a chained hole.** `{{ actual_amount | default:0 | number:2 }}` passed every gate. The second `|` was read as part of `default`'s argument, so the hole printed the text `0 | number:2` for an empty value and the bare `71100` otherwise; `{{ x | upper | lower }}` stayed on the page as written.
- **Before, a currency path.** `{{ planned_amount | currency:currency_code }}` passed every gate. The argument is not read as a path, so the amount rendered in US dollars whatever the record's currency (`$1,234.50` for a record in euros).
- **Now.** The rule refuses both at `error`, naming the hole, the face and the template. A hole takes one formatter; anything more is decided in the caller that supplies the data. The currency argument is a literal code in three capital letters (`currency:EUR`), never a path. A lowercase or empty argument is refused the same way. `currency` with no argument is unchanged (US dollars).
- **Which holes.** The grammar is `@objectstack/formula`'s `judgeMailHoleGrammar`, the one the mail renderer parses with; all three faces are judged.
- **Who sees it.** A template that chained formatters, or wrote a path or a lowercase code as the currency argument. No template shipped in this repository does.

**The remedy.** Keep one formatter per hole and pass any further decided value (a default, a second format) as its own variable. Write the currency code itself (`currency:EUR`). To show each record's own currency, format the amount in the caller that supplies the data and pass the formatted text as its own variable.
