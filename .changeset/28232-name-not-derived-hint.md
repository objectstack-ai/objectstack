---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(console): a metadata create form says so next to Name when the label cannot fill it

Clause-②: no
Metadata-protocol: none

A metadata create form that fills `name` from the label (a permission set, a view, a flow, a page, an action, a hook, a dashboard, a doc) keeps only the label's Latin letters and digits. A label written all in Chinese or Japanese therefore left Name empty and required, with nothing at the field saying why.

Now the Name row says "This label can't be turned into a name; type one in snake_case." (Chinese in the zh locale) while the label holds text that gives no name and Name is empty. The line goes away once a Name is typed. How a name is derived from the label does not change.

`SchemaForm` gains an optional `fieldNotes` prop: one line shown under a top-level field, keyed by field.
