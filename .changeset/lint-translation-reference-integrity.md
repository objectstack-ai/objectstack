---
"@objectstack/lint": minor
"@objectstack/cli": minor
---

feat(lint): translation-bundle reference integrity + option-key validation (#3583)

The i18n gate only ever ran forward: `os i18n check` asks which keys the
metadata expects that no bundle carries. Nothing asked the reverse — which keys
a bundle carries that no metadata claims — even though the spec already names
the answer (`TranslationDiffStatus 'redundant'`, `TranslationCoverageResult.redundantKeys`,
both declared with no producer).

That direction ships two failure modes, both found in the HotCRM audit: bundles
keyed to fields an object no longer declares (a rename that left the translation
behind), and select-option translations keyed by the option's **display label**
or a variant spelling of its value (`direct-mail` for `direct_mail`, `planned`
for `planning`). Neither breaks anything — which is the problem. The resolver
finds nothing and renders the source string, so the screen looks translated and
one field or one picklist value quietly does not.

New rule `validateTranslationReferences` walks every bundle in
`stack.translations` against the stack it ships with, wired into `os validate`,
`os lint`, and `os compile`:

| Key | Must name |
|---|---|
| `objects.{object}` | an object this stack defines, or a platform object |
| `objects.{object}.fields.{field}` | a field that object declares |
| `objects.{object}.fields.{field}.options.{key}` | an option's stored `value` |
| `objects.{object}._views` / `._actions` / `._sections` / `._actions.*.params` | a view `name` / bound action / `fieldGroups[].key` or named section / param `name` |
| `apps.{app}` / `.navigation.{id}` | an app `name` / navigation item `id` |
| `dashboards.{dash}` / `.widgets.{id}` / `.actions.{actionUrl}` | dashboard `name` / widget `id` / header `actionUrl` |
| `globalActions.{action}` | an action with no `objectName` |

Every finding is a **warning** (`translation-target-unknown`,
`translation-option-key-unknown`): an orphan key is inert, not broken, and the
severity should say so. Diagnostics carry the declared names to choose from,
name the stored value when a key turns out to be the display label, and suggest
a namespace-segment match (`task` → `todo_task`) that edit distance alone misses.

Cross-package objects follow the existing ladder: a registered platform object
is skipped wholly (its fields are not visible from a stack lint), a
platform-prefixed name no package registers is reported once on the object key,
and the subtree is never half-checked. `messages`, `validationMessages`,
`settings`, `settingsCommon` and `metadataForms` are deliberately not judged —
their keys are owned by application code, plugins, and the platform's own
metadata-type registry, so no enumerable universe exists to resolve against.
