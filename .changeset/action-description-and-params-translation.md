---
"@objectstack/spec": patch
---

fix(spec): an action's `description` and its parameter dialog now honour the translation bundle

`translateAction` overlaid only `label`, `confirmText`, `successMessage` and
`resultDialog`. The keys for the rest were already there — the translation
schema declares `_actions.ACTION.description` and
`_actions.ACTION.params.PARAM.{label, helpText, placeholder, options}`, and the
translation linter validates both, reporting a parameter key the action does not
declare with a did-you-mean naming the ones it does. So the keys parsed, they
linted, and they resolved to nothing: a translated deployment rendered a
translated action button that opened an untranslated form, because an action's
`description` is the explanatory line under the dialog title and its
parameters' `label` / `helpText` / `placeholder` / option labels are the rest of
that dialog.

They are applied now, wherever the action is served — the REST metadata read,
OpenAPI, MCP — and through `globalActions` for an action that belongs to no
object, the same object-scoped-first order every other action key already used.

Parameters are matched by `name`, falling back to `field` for a field-backed
parameter that names no key of its own: the same rule the linter collects
parameters by, so a key the linter accepts is a key the resolver finds. Option
labels are matched on the stored option `value`, since the authored side is an
array of options while the translation side is a `value` to label map.

Nothing changes for a bundle that carries none of these keys: the authored text
is kept, the parameter array keeps its identity, and a bundle key naming a
parameter the action does not declare is ignored rather than invented into the
dialog. No schema, no validator and no accepted shape moves — every key applied
here was already declared and already validated.
