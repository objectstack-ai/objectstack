---
'@objectstack/formula': minor
---

feat(formula): a mail template hole may name the `option` formatter, `{{ stage | option:opportunity.stage }}`, which prints a select value as its option's label from the table the mail renderer hands in

Clause-②: yes (widening)
Metadata-protocol: added
Skills-docs: follow-up owed — `skills/objectstack-automation/SKILL.md` (the `notify` section) gains one line: an option label in a notice is written with the mail formatter `{{ stage | option:opportunity.stage }}`, not with `label()` in `templateData`. The skills lane owns that file.

- **`option` is a mail template's formatter.** `judgeHoleFormatter(…, 'mail')`, `parseMailHole` and `judgeMailHoleGrammar` accept `option:object.field`, and `parseMailHole` returns the reference as `optionField: { object, field }`. `MAIL_TEMPLATE_FORMATTERS` (new) is the mail list, `TEMPLATE_FORMATTERS` then `option`, and the mail refusals list it as the known formatters. `OPTION_ARGUMENT_RULE` (new) is the one sentence the spec, the renderer and the authoring rule quote; `optionFieldReference` (new) parses the argument.
- **The argument is a bare `object.field`.** No argument, an empty one, a field with no object (`option:stage`), a quoted reference (`option:'opportunity.stage'`), a marked path (`option:@stage_ref`) and a second dot are refused (`option-field-shape`), naming the hole, the argument and the rule.
- **The object and field are judged when the caller hands in the app's objects.** `judgeMailHoleGrammar(face, { objects })` takes each object's name to its fields, each `true` when the field declares options, and refuses an object it does not name (`option-object-unknown`), a field that object does not have (`option-field-unknown`) and a field with no options (`option-field-no-options`).
- **The formatter prints from the table it is handed.** `formatValue('option', value, 'opportunity.stage', { optionLabels })` takes `optionLabels` (`OptionLabelTable`, new): for each `object.field`, each option's label keyed by its stored value, in the locale the face renders in. A value the table does not hold prints as stored, a multi-select value labels each element joined with `, `, and with no table for that `object.field` the value prints as stored. This package reads no metadata and no translations: the mail renderer builds the table per recipient.
- **In-app template text refuses it.** `TEMPLATE_FORMATTERS` is unchanged, and the in-app dialect (flow notice `title` / `message`, action and bulk-action copy) refuses `option` as a formatter it does not know (`known-formatter`), saying it formats only in a mail template.
