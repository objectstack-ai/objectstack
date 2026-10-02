---
'@objectstack/spec': patch
---

fix(spec): a bound action's translation is read only under its own object, never from `globalActions`

Clause-②: no

The i18n resolver reads an action's translated copy at one address, chosen by the action's own `objectName`. This covers `translateAction`, `resolveActionLabel`, `resolveActionConfirm`, `resolveActionSuccess`, `resolveActionResultDialog`, and `translateObject` for an object's inline actions.

- An action with an `objectName` reads only `objects.OBJECT._actions.ACTION`.
- An action with no `objectName` reads only `globalActions.ACTION`.

Before this, a bound action with no object-scoped copy fell back to `globalActions.ACTION`. The fallback covered its label, description, confirm text, success message, outcome messages, params and result dialog. `TranslationDataSchema.globalActions` declares that group for object-less actions only. `os validate` already refuses, at error level, a `globalActions` key that names a bound action, and says the key is never read. The resolver now matches both.

**What changes for a project.** A bundle that passes `os validate` is not affected. A bundle that keeps a bound action's copy under `globalActions` now shows that action's source text instead of the translation. `os validate` does not check a translation stored at runtime, so such a translation changes the same way. The fix is to move the keys from `globalActions.ACTION` to `objects.OBJECT._actions.ACTION`, where OBJECT is the action's `objectName`. The example apps under `examples/` and the translation bundles shipped in this repository's packages have no such key.
