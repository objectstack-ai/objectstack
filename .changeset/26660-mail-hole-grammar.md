---
'@objectstack/lint': minor
---

feat(lint)!: a new gating authoring rule, `email-template-hole-grammar`, refuses an email template hole whose `currency` argument is not a literal ISO 4217 code

Clause-②: no (narrowing) — `os validate`, `os build`, `os lint` and the metadata publish door (`422 INVALID_METADATA`) refuse an `email_template` whose `subject`, `bodyText` or `bodyHtml` writes `{{ x | currency:ARG }}` with an `ARG` that is not three capital letters, which they accepted before. Nothing is widened.
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped: a hole value that never rendered as written (the renderer printed the amount in US dollars) is now refused where it is authored. The refusal names the hole and the literal-only rule, so there is no key for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at every authoring door for `email_template`.

- **Before.** `{{ planned_amount | currency:currency_code }}` passed every gate. The argument is not read as a path, so the amount rendered in US dollars whatever the record's currency (`$1,234.50` for a record in euros).
- **Now.** The rule refuses that hole at `error`, naming it, the face and the template: the argument is a literal code in three capital letters (`currency:EUR`), never a path. A lowercase or empty argument is refused the same way. `currency` with no argument is unchanged (US dollars).
- **Which holes.** The grammar is `@objectstack/formula`'s `judgeMailHoleGrammar`, the one the mail renderer parses with; all three faces are judged.
- **Who sees it.** A template that wrote a path or a lowercase code as the currency argument. No template shipped in this repository does.

**The remedy.** Write the code itself (`currency:EUR`). To show each record's own currency, format the amount in the caller that supplies the data and pass the formatted text as its own variable.
