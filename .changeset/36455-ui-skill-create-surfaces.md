---
'@objectstack/skills': patch
---

docs(skills): the UI skill teaches the New and Edit forms as built from the object's fields and field groups, and `showOnCreate`

Clause-②: no
Metadata-protocol: none

objectstack-ui no longer teaches an object's internal create and edit form views, which the Console's create and edit surfaces stopped loading. `SKILL.md` Traps 1 and `rules/list-views.md` "Form Views" now say that New and Edit are built from the object's fields, sectioned by its `fieldGroups` (`collapse: 'collapsed'` folds a rarely filled section) and following the fields' own rules; that `showOnCreate: false` leaves a field off every create surface and is refused beside `required: true`; and that a container's `form`, `formViews.default` and `formViews.create` still parse, steer nothing, and are reported by `os validate` as `form-view-internal-not-loaded`. The two form views that load are kept: a named `formViews` entry an action of type `form` opens (`/forms/:name`), and a public form (`sharing.enabled: true`), taught as before. "Master-Detail Forms" drops the form-view `subforms` override, which is no longer read; the parent field group naming the child and the page block remain. `evals/views-apps-actions-pages.json`, evals 1, 6, 13 and 19: each taught or assumed an internal form view and now expects the object's field groups and `showOnCreate`.
