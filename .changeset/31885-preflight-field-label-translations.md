---
'@objectstack/spec': minor
'@objectstack/lint': minor
---

feat(i18n): an action's `preflight` panel field labels are translatable through bundles, the same way `resultDialog.fields` labels are

Clause-②: yes (widening)
Metadata-protocol: added
Skills-docs: follow-up owed — skills/objectstack-i18n/SKILL.md (the `_actions` key row and the translation-target-unknown list name `resultDialog.fields.{path}` but not `preflight.fields.{path}`)

A translation bundle can now carry `objects.OBJECT._actions.ACTION.preflight.fields.PATH` (and `globalActions.ACTION.preflight.fields.PATH` for an object-less action): the translated label of one field the action's `preflight.fields[]` declares, keyed by its literal `path` with dots kept inside the one key (`"verdict.summary"`), exactly as `resultDialog.fields.PATH` is.

- `@objectstack/spec`: `TranslationDataSchema` / `ObjectTranslationDataSchema` declare the strict `preflight: { fields }` node under every action entry (a `title` there is refused with guidance: a preflight declares none). `translateAction` overlays the translated labels onto the declared `preflight.fields` through the new `resolveActionPreflight(bundle, action, opts)` (with its `PreflightLike` input shape), leaving the read, path and seeds untouched; an action with no `preflight`, or a preflight with no `fields`, comes back unchanged.
- `@objectstack/lint`: `os i18n extract` and the i18n coverage walk emit one key per labelled preflight field, and `validateTranslationReferences` reports a `preflight.fields.PATH` key the action does not declare as `translation-target-unknown` (an action with no `preflight`, a preflight with no `fields`, or an undeclared path), as it does for `resultDialog.fields.PATH`.

The console does not draw the preflight panel yet; when it does, it reads these labels from the served, translated action.
