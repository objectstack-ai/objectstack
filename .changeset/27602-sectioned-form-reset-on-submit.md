---
'@object-ui/plugin-form': patch
---

fix(plugin-form): a sectioned `object-form` clears after a save when it declares `submitBehavior: { kind: 'continue' }` or `resetOnSuccess`, as the flat form does

Clause-②: no
Metadata-protocol: none

A "save and add another" form declares `submitBehavior: { kind: 'continue' }`, or `resetOnSuccess: true` on a create form. When the form's fields were grouped into sections (explicit `sections`, or sections derived from the object's field groups), the form kept the saved record's values after the save, so the next entry started from them and could be saved as a near-duplicate. The flat form already cleared. Both now read one shared rule: `continue` clears, `resetOnSuccess` clears a create form when no `submitBehavior` is declared, and a form that declares neither keeps its values.
