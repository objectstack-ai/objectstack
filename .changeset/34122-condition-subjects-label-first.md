---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(console): Studio condition editors list fields by their label

Clause-②: no (`@object-ui/app-shell` is `"private": true`; flipping the `labelSubjects` default reaches no published export)
Metadata-protocol: none

The subject list of every Studio condition editor now offers a field by its label, with its CEL path (`record.status`) beside it as secondary text: a hook's "Run only when", an action's "Visible when" and "Disabled when", a page block's "Visible when", and the generic condition field of the metadata forms. The flow Entry condition and the object Validations panel already did. A field with no label, or whose label only repeats its name, still reads as its path. The compiled condition is unchanged.
