---
'@objectstack/lint': minor
---

`os validate`, `os build` and `os lint` now check an action translation's result-dialog copy against whether the action declares a `resultDialog`, under both `objects.OBJECT._actions.ACTION` and `globalActions.ACTION`.

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No spec key, export or stored value moves: TranslationDataSchema parses these three keys exactly as before, so objectstack migrate meta has nothing to convert, and the runtime publish door never runs this rule on a translation write (the member's runtime types default to flow). The refusal is a lint finding at the authoring doors that names the key; its remedy is the author's choice between moving the copy, declaring the dialog or deleting the copy, not a mechanical rewrite of one shape into another. -->

**What is refused.** `resultDialog.title`, `resultDialog.description` and `resultDialog.acknowledge` under an action that declares no `resultDialog` are now `translation-target-unknown` errors, one per key: the code and level an undeclared `params`, `outcomeMessages` or `resultDialog.fields` key already gets. `translateAction` returns no dialog for such an action, so the copy is never read. Before this, only `resultDialog.fields.PATH` was checked under the dialog, and these three keys passed.

**What still passes.** The same three keys under an action that declares a `resultDialog` are read and pass, whether or not the dialog sets that text itself.

**BREAKING** — an accept-set narrowing at the `os validate`, `os build` and `os lint` doors, shipped as `minor` under the launch-window convention. **What changes for a project.** A bundle that carries one of these keys under an action with no `resultDialog` now fails `os validate` with exit 1 instead of passing, and `os build` refuses it. The fix is to move the keys under the action that declares the dialog, declare the `resultDialog` on the action if it should show one, or delete the keys. The four example apps (`app-crm`, `app-todo`, `app-showcase`, `app-multi-package`) and the bundle shipped with `@objectstack/platform-objects` produce no finding on these keys, so none of their exit codes change.
