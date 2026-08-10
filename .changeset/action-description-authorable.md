---
"@objectstack/spec": minor
"@objectstack/cli": patch
---

feat(spec,cli): `description` is authorable on an action (#7367)

An action may now declare a top-level `description`, I18nLabel-shaped exactly as
`label` is (plain string or `{ en, 'zh-CN', … }` map). It is the explanatory line
the param dialog shows under the title.

**This closes a producer gap, not a renderer gap.** The consumer half already
shipped and has been unreachable: objectui's `ActionParamDialog` renders the
string as the dialog's `DialogDescription`, two independent handlers feed it as
`actionDescription(objectName, actionName, action.description)`, and the
resolver already walks `objects.{object}._actions.{action}.description` with a
`globalActions.{action}.description` fallback. Nothing could author any of it —
`ActionSchema` is a `strictObject` and refused the key outright, and the
translation shape refused the matching bundle key. The mirror image of
declared-but-unenforced: machinery with no way in.

Three surfaces move together, so the key is never declared without being
extractable:

- **`ActionSchema`** — optional `description`.
- **Action translations** (`objects.{o}._actions.{a}` and `globalActions.{a}`) —
  the matching `description` slot, so a bundle can carry the translated string
  at the address the resolver already reads.
- **`os i18n extract`** — emits the key beside `label` / `confirmText` /
  `successMessage` / `params`. It is seeded only when the action declares one;
  an action without a description is not a translation gap, because the dialog
  falls back to its own generic string.

**What to write in it.** An action that collects `params` and also sets
`confirmText` shows two dialogs for one decision — the confirm, then the param
prompt. Per the maintainer's 2026-08-10 ruling, carry the confirm question in
`description` instead: one condition, one wording, one dialog, nothing sent until
that dialog's own Confirm. `confirmText` remains correct for a param-less action,
where the confirm is the only dialog.

`description` is not `ai.description`. That one is the LLM-facing tool contract
(≥40 chars, required when `ai.exposed`) and is unchanged; this one is
human-facing dialog copy and is never sent to a model.

Additive and optional: every existing action, bundle and extract keeps parsing
unchanged. Inline actions (`InlineActionSchema`) deliberately do not gain the
key — that shape forwards only what a host renderer honours, and widens when a
renderer widens.
