---
'@objectstack/lint': minor
---

`os validate`, `os build` and `os lint` now check every keyed child of an action's translation entry against what the action declares, under both `objects.OBJECT._actions.ACTION` and `globalActions.ACTION`. Before this, only `params.NAME` was checked.

Clause-②: yes

**What is refused.** Two keys are new `translation-target-unknown` errors, the same code and level an undeclared `params` key already gets:

- `outcomeMessages.OUTCOME` when the action's own `outcomeMessages` does not declare that outcome, or declares no `outcomeMessages` at all. `translateAction` overlays only the outcomes the action declares, so such copy is never shown.
- `resultDialog.fields.PATH` when no entry of the action's `resultDialog.fields[]` has that literal `path`, or the action declares no `resultDialog` or a dialog with no `fields`. The label lookup is keyed by each declared field's `path`, dots included, so such a label is never shown. The finding's config path quotes a dotted key as one member (`resultDialog.fields["client.ghost"]`).

**What is warned.** `params.NAME.options.VALUE` under a declared param is judged against that param's inline `options[].value`. It is a `translation-option-key-unknown` warning, the code and level a field's `options` key already gets, and it names the stored value when the key is a display label. An options map under a param with no inline options and no `field` is warned once, because nothing reads it. A field-backed param with no inline `options` inherits its list from the field when the dialog renders, so its option keys are not judged.

**What changes for a project.** A bundle that carries one of the refused keys now fails `os validate` with exit 1 instead of passing, and `os build` refuses it. The fix is to rename the key to a declared outcome or result-field `path`, declare the outcome or field on the action first, or delete the key. The option-key warning changes an exit code only under `--strict`. The four example apps (`app-crm`, `app-todo`, `app-showcase`, `app-multi-package`) and the bundle shipped with `@objectstack/platform-objects` produce no finding on any of these keys, so none of their exit codes change.
