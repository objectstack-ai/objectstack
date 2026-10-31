---
'@object-ui/core': patch
'@object-ui/react': patch
---

fix(core,react): an action's `description`, a param's `helpText` and an `outcomeMessages` entry read the `template` envelope

Clause-②: no
Metadata-protocol: none

objectstack#27948 step 2 types these three as `template` slots, so a served action can carry `{ dialect: 'template', source }` where it carried a string.

- **Param dialog.** The runner hands the param-collection handler the action and params with `description` and each `helpText` reduced to their text (`actionCopyText`), so the dialog draws the sentence, never `[object Object]`; a locale map is handed on unchanged for the host to localize.
- **Outcome toast.** `useActionTextLocalizer` keeps an `outcomeMessages` envelope's shape (a bundle entry replaces its `source`) instead of collapsing it to the word "template", and the runner fills the envelope's holes as it fills the string's.

- **Studio's action preview** (`@object-ui/app-shell`, unpublished) draws a param's `helpText`, `confirmText` and `successMessage` from the envelope's `source`: it drew `helpText` raw (an object as a React child) and read the other two as a locale map, which showed the word "template".

What to do: nothing. `${…}` copy written before the migration keeps reading.
