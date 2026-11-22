---
'@objectstack/spec': minor
'@objectstack/lint': minor
'@objectstack/platform-objects': patch
'@object-ui/app-shell': minor
'@object-ui/i18n': patch
---

feat(console): record create and edit stop loading internal forms; a field's Show on create switch

Clause-②: no (narrowing)
Metadata-protocol: semantic

The Console's record create and edit surfaces no longer load an object's internal form view. The create dialog, the edit dialog, the full-page create and edit (`/new`, `/record/:id/edit`) and a create or edit an action opens now lay the record out by the object's field groups (`fieldGroups`) and follow the rules on its fields (`visibleWhen`, `readonlyWhen`, `requiredWhen`, `required`). What used to steer those surfaces and now steers nothing: the default form view (`form`, `formViews.default`), the `create` form view, and on them `sections`, the `tabbed` and `wizard` layouts, `defaultTab`, `tabPosition`, `subforms`, `modalSize`, `buttons`, `layout` and `defaults`. A master-detail sub-table still comes from `fieldGroups[].relatedList`, and a flow screen reads its sub-table settings from there too.

An app that still declares an internal form installs and runs as before; the definition is inert. A public form (`sharing.enabled: true`) keeps loading at its own link by its own definition, and a named form an action of type `form` opens is unchanged.

`showOnCreate` is now live: a field with `showOnCreate: false` is left out of every create surface and stays on edit, the record page and lists. The field form (`field.form.ts`) and the Studio field inspector offer it as "Show on create", on by default; a required field keeps it on.

`@objectstack/lint` adds the advisory rule `form-view-internal-not-loaded`: a warning, never an error, on each internal create or edit form an app declares (a container's `form`, `formViews.create`, `formViews.default`, and a stored form view that is the default or named `OBJECT.create`), and on no public or named form.

Studio: the Data pillar's Form tab always lays out the object's field groups, and the Interfaces rail no longer lists internal forms; public forms and named forms stay listed.

An app that relied on its internal form for create defaults should move them to each field's `defaultValue`; sections move to `fieldGroups`, and required or conditional rules move onto the fields.
