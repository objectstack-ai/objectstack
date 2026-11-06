---
'@objectstack/plugin-email': patch
---

fix(plugin-email): a mail template's `{{ stage | option:opportunity.stage }}` hole prints the option's label in each recipient's language, and a hole the deployment cannot label refuses the send `TEMPLATE_INVALID`

Clause-②: no
Metadata-protocol: none

- **What was wrong.** A template using the `option` formatter passed every authoring door, and then every send of it failed: the email service handed the formatter no label table, so `sendTemplate` and `renderTemplate` threw a bare `RangeError` outside the `TEMPLATE_INVALID` vocabulary, and nothing was sent.
- **What changes.** Before rendering, the email service builds a label table for each `object.field` the template's `option` holes name, once per send, from the deployment's served object (`IDataEngine.getObject`) with the `i18n` service's bundle laid over it by `translateObject` — the path `GET /meta/object/:name` serves the object with and a formula's `label()` reads. The locale is the send's own `locale`, the recipient's, never an execution context's: a scheduled flow that runs as the system still mails each recipient in their language. A send that names no locale reads the declared labels. A value outside the field's options prints as stored; a multi-select value prints each label, joined with `, `.
- **What is refused.** An object the deployment does not serve, a field the object does not have, a field that declares no options, and a field whose option list is empty refuse the whole send with `TEMPLATE_INVALID`, naming the template, the hole and the rule, before any face is rendered; nothing reaches the transport. A host with no data engine builds no table, and such a hole is refused `TEMPLATE_INVALID` by the renderer, with the formula's `optionTableRefusal` sentence.
