---
'@object-ui/react': patch
---

fix(react): an inline action's `description` locale map shows in the user's language in the param dialog

Clause-②: no
Metadata-protocol: none

An inline action on a page (`element:button` with `properties.action`) can declare a `description`, the line its param dialog shows under the title. It may be written as a per-locale map such as `{ en: '…', 'zh-CN': '…' }`. Before this change the action text localizer left that map alone, so the dialog received an object instead of a sentence.

What changes:

- `useActionTextLocalizer` now collapses a declared `description` to the active language, the same way it already treats `confirmText`, `successMessage` and `errorMessage`. A plain string comes back unchanged, and a `{ dialect: 'template', source }` envelope comes back as itself.
- It does not read a translation bundle entry for `description`. The param-dialog host still resolves `_actions.<name>.description` over the string it is handed.
- An action that declares no `description` gains no key, so its dialog keeps the generic "Please provide the required information to continue." line.

What to do: nothing. Nothing a page, view or action declares changes.
