---
'@object-ui/plugin-form': patch
'@object-ui/console': patch
'@object-ui/app-shell': patch
'@objectstack/spec': patch
---

fix(plugin-form): a `repeater` field on `span: 'auto'` takes the whole row again, on the record form and on `/forms/NAME`

Clause-②: no (layout only; an author could already set `span: 'full'`)
Metadata-protocol: none

The spec's form field `span` docblock lists `repeater` among the types that take the whole row by default. A repeater used to get there through the wide line-items widget it mapped to; since it moved to the JSON editor that `json`, `composite` and `record` also use, both form renderers gave it one cell. The default width now reads the object field's own type, so a repeater is wide and those three types stay one cell. The Studio form designer's canvas asks the same rule, so it lays a repeater out as the form does. An authored `colSpan` still wins. The named-form page passes the object field's type to the shared resolver, as it already passed `multiple`. The spec docblock's stale "through the `field:grid` widget" clause now says how the width is decided.
