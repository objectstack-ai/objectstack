---
'@objectstack/spec': minor
'@objectstack/lint': minor
---

feat(spec,lint): object-level `composite` / `repeater` are untyped JSON — a typed list is a child object

Clause-②: no
Metadata-protocol: semantic
Ruling-ref: 6386744473

On an object field, `composite` and `repeater` are untyped JSON containers of CMS lineage (a Strapi component, an ACF group or repeater). The `FieldType` comments used to promise "declared sub-fields", but `FieldSchema` has no member that declares them, so nothing gave the inner keys labels, types, options, required flags or translations, and nothing could validate or address one row. The comments and the field-types docs now say so, and point a list that needs typed columns to a child object: a `master_detail` field pointing back at the parent, with `inlineEdit: 'grid'` to edit the rows inline on the parent's form.

The strict field schema already refused `fields`, `subFields` and `columns` on a field, but named only the key. The refusal now names the route: a typed list is a child object (`columns` also names the live `lookupColumns`, `relatedListColumns` and `inlineColumns`). This changes the message, not what parses.

New `@objectstack/lint` rule `field/embedded-sub-fields` (error): a `composite` / `repeater` object field carrying `fields`, `subFields` or `columns`. It fires on the doors that never parse (`os lint` on a raw object-literal config, `defineStack(x, { strict: false })`, the metadata-generation rubric); every parsed door refuses the field first. `os explain field/embedded-sub-fields` prints the reasoning. A form view's `fields` sub-rows and the Studio metadata forms are not judged.

What to do: nothing for a field that declares no sub-field key — the type is unchanged. A field that carried one never parsed under `defineStack`; model the list as a child object.
