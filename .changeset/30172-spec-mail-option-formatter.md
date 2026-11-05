---
'@objectstack/spec': minor
---

feat(spec): the email template hole grammar names the `option` formatter, which prints a select value as its option's label in the recipient's language

Clause-②: yes (widening)
Metadata-protocol: added
Skills-docs: follow-up owed — `skills/objectstack-automation/SKILL.md` (the `notify` section) gains one line: an option label in a notice is written with the mail formatter `{{ stage | option:opportunity.stage }}`, not with `label()` in `templateData`. The skills lane owns that file.

The `subject`, `bodyHtml` and `bodyText` descriptions of `email_template` state the hole grammar. They now carry one more sentence, `OPTION_ARGUMENT_RULE` from `@objectstack/formula` word for word: an `option` hole, in a mail template only, prints the label of the select option whose value it holds, in the recipient's language. Its argument is the object and field the value belongs to, written bare as `object.field` (`{{ stage | option:opportunity.stage }}`); the object is one the app has, the field one of its fields that declares options; a multi-select value prints the label of each of its values, joined with `, `, and a value outside the field's options prints as stored.

A flow notice is filled once per run and sent to each recipient in their own locale, so a select field's value reached the template as stored (`needs_analysis`), and a template could not print its label: `{{ stage | label }}` was refused as an unknown formatter, and CEL `label()` in `templateData` has no option labels to read. Additive only: every template that was accepted before is accepted unchanged.
