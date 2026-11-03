---
'@object-ui/plugin-grid': patch
'@object-ui/app-shell': patch
---

fix(plugin-grid): the import wizard no longer demands a required field that carries a default

Clause-②: yes (widening)
Metadata-protocol: none

The mapping step held Next with "required field(s) not mapped" for a required field left unmapped even when the field declares a `defaultValue`, static or an expression, which the create fills for a row that leaves the field out. A file without that column could not be imported. The step now treats such a field as satisfied, and leaves the value to the server. The same check spares the preview's blank cell in a mapped column of such a field, which the server also fills with the default. An option marked `default: true` counts as a default when no `defaultValue` is declared, as the create reads it. A required field with no default still blocks, and its blank cell is still marked. The wizard reads only whether a default is declared; it never evaluates one.

`ImportWizardProps['fields']` gains an optional `defaultValue` (passed through as the object schema declares it), and its option objects an optional `default`. The Console's two hosts of the wizard, the object list's Import and the AI chat's spreadsheet import, now pass the field's `defaultValue` through.

What to do: a host that builds the wizard's `fields` itself passes each field's `defaultValue` through to get the same behaviour; without it a defaulted required field is still demanded.
