---
'@objectstack/spec': minor
---

feat(spec): page variable `source` renders as a component picker (objectui#2328)

The page metadata form's `variables` repeater now declares explicit sub-fields
and pins `{ field: 'source', widget: 'ref:component' }`. A page variable's
`source` names the component (by `id`) that writes it, so Studio can offer it as
a dropdown of the components actually placed on the page — mirroring how the
sibling `object` field uses `ref:object` — instead of a free-text input the
author has to type an id into by hand. The `ref:component` widget itself lives
in objectui (app-shell metadata-admin); this change is the form-spec trigger.
