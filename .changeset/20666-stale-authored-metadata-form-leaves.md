---
'@objectstack/platform-objects': patch
---

fix(platform-objects): the ja-JP, es-ES and zh-CN metadata-form descriptions, help texts and labels that contradicted their current English source are re-translated (#20666)

Clause-②: no

A translated metadata-form leaf that a translator wrote by hand is kept as
written when its English source changes later, so some leaves went on saying
what the old source said. On a ja-JP or es-ES console the permission-set form's
Tab & Row-Level Security section still offered custom context variables, and
the agent form's Capabilities section still offered tools; `en` dropped both
when the keys were removed.

Twelve leaves whose meaning contradicted the current English now match it:

- all three locales: the agent form's Capabilities section (skills and
  knowledge sources, no tools), the permission-set form's Tab & Row-Level
  Security section (tab visibility and RLS policies: ja-JP and es-ES no longer
  offer custom context variables, and zh-CN no longer names the section after
  sharing rules), and the report form's `blocks` help (dataset-bound
  sub-reports, not a join of several objects);
- ja-JP and es-ES: the email-template form's Identity section (the template is
  resolved by its `name` through `IEmailService.sendTemplate`, not by an `id`,
  and the section carries no content type);
- zh-CN: the report form's Joined blocks section label, which named the section
  after related objects.

Leaves whose English source only gained detail or was reworded, without
retracting what the translation says, are unchanged. Values only: no key is
added or removed, and no provenance table changes.
