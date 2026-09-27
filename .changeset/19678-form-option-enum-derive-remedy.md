---
"@objectstack/spec": patch
---

A metadata form's option-value refusal now says what to do: `defineForm`'s module-load refusal of an inline option `value` that fails the system-identifier grammar names the derive path, and the form field's `options` describe states the rule it belongs to (#19678, #19907).

Clause-②: no

A form option `value` is a lowercase system identifier — `FormSelectOptionSchema` reuses `SelectOptionSchema.value` by reference — so an enum member carrying a hyphen or a capital (`object.managedBy`'s `system-data`, `action.openIn`'s `new-tab`, `action.execution`'s `perRecord`) cannot be written as an inline option at all. That bound stays. An enum-typed metadata-form row may still carry an inline `options` list, to give its members human labels or to offer a deliberate subset. A row whose members cannot be spelled as option values omits `options`: the control derives the members from the served JSON Schema, and their meanings go in `helpText`.

- **The refusal names the remedy.** `defineForm` still throws a `ZodError` at module load with the same issues and codes (`invalid_format` for the pattern, `too_small` for the two-character floor). The grammar message on an inline option's `value` is kept, and now carries the derive path after it, for a row whose members cannot be spelled as option values. Only schema-bound forms built by `defineForm` get this sentence. The grammar message where it is declared (`SystemIdentifierSchema`) is unchanged, because it also bounds object-field options and three object-storage names, where omitting `options` is not the answer.
- **The describe states the rule** on `FormFieldSchema.options`: an inline list is allowed on an enum-typed row, and the derive path is named for a row whose members cannot be spelled. That text is served in the JSON Schema and on the generated reference page.
- ⛔ **No accept-set change.** Every value refused before is still refused, and every value accepted before is still accepted. No key, export or schema shape moves.
