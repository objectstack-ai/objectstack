---
"@objectstack/spec": patch
---

A view container's `form` is its default form: it is never collapsed into a named form, and no named form is promoted to default

Clause-②: no

`ViewSchema` declares `form` the container's default form and `formViews` additional named forms. `expandViewContainer` / `expandViewContainerWithDiagnostics`, which every view registrar shares, now serves exactly that. Behaviour changes for authors:

- **A container with no `form` no longer serves its first named form as the default create/edit form.** Before, the first `formViews` entry was flagged `isDefault`, whatever it was: in the CRM example that was the anonymous Web-to-Lead form. Now no form item is flagged, and each named form is served only where it is asked for by name (a form action's `target`, `addRecord.formView`, a public `sharing.publicLink`). If you relied on the old promotion, move the intended create/edit form into `form`: `formViews: { edit: { … } }` becomes `form: { … }`, and a reference to `<object>.edit` becomes `<object>.form`.
- **A named form no longer replaces `form`.** Before, `form` was dropped when any named form shared its `type`, `label` and `columns`, even with different sections, and the first named form became the default. Now `form` is always served as `<object>.form`, flagged `isDefault`, and is the only form item flagged. A named form whose body equals `form` stays its own named item.
- **The default `list` collapses only into a named list that restates its whole body.** A `listViews` entry that repeats `list` key for key, the list's own `name` aside (the "default == `listViews.all`" pattern), still folds into that one named item. A named list that shares `list`'s `type`, `label` and `columns` but differs in anything else (a filter, a sort) is now its own view, and `list` is served beside it as `<object>.default`, the default list. Before, such a named list took the default's place, and the default list's own body was not served.

The CRM and showcase examples move their create/edit form into `form`. The showcase task's `showcase_log_time` and `showcase_new_task` actions now target `showcase_task.form`. The public Web-to-Lead and contact-us forms stay named.

⛔ No schema, parse, export or accept-set change.
