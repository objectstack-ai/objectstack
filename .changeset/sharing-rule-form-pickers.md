---
"@objectstack/spec": minor
"@objectstack/plugin-sharing": minor
---

Field metadata gains a `widget` override (`FieldSchema.widget`) — names a
registered form component (resolved as `field:<widget>`) to render a field with,
overriding the default widget derived from `type` and degrading back to it when
unregistered. The generic object form already honored this hint (objectui
`ObjectForm`/`form.tsx` resolve `widget || type`); this promotes it to a
first-class, liveness-classified authoring property so any config object can ask
for a picker instead of a raw input.

`sys_sharing_rule` uses it so the Setup **New Sharing Rule** form is
pick-not-type instead of asking admins to hand-enter machine data:

- `object_name` → `object-ref` (choose a registered object by name)
- `criteria_json` → `filter-condition` (visual criteria builder scoped to the
  chosen object's fields; `dependsOn: object_name`)
- `recipient_id` → `recipient-picker` (record picker whose target follows
  `recipient_type`; `dependsOn: recipient_type`)

Also removes the `queue` recipient type: it is declared-but-unenforced (the
evaluator expands no users for it), so offering it authored a silently-inert rule
(ADR-0078). i18n bundles regenerated. Requires the matching objectui widgets; the
fields degrade to their `type` renderer where those aren't loaded.
