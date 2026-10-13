---
"@objectstack/spec": minor
"@objectstack/lint": minor
---

A `record:details` section heading can show how many values a multi-value field holds on the current record: `sections[].count: { field }`, with the section's `label` writing the `{{ count }}` hole where the number goes.

Clause-②: yes (widening)

```ts
{
  name: 'plan_gap',
  label: '{{ count }} features need a higher plan',
  fields: ['capabilities_not_on_plan'],
  count: { field: 'capabilities_not_on_plan' },
}
```

- **`@objectstack/spec`.** `RecordDetailsProps.sections[]` accepts `count`, a closed object whose one key, `field`, is a bare machine name (snake_case, no dotted path). A section that declares `count` must write the `{{ count }}` hole in its `label`, in every locale of an inline label map. It is refused when it has no `label`, when the label has no hole, when the label writes any other `{{ … }}` hole (another variable, or the count with a formatter), when it writes the single-brace `{count}` / `${count}`, and beside `group` (a group-referencing section's heading is the group's own label). A translated `objects.<object>._sections.<name>.label` writes the same `{{ count }}` hole, and `os i18n extract` seeds it from the authored label. `SECTION_HEADING_COUNT_HOLE` exports the hole's grammar (inner whitespace is free: `{{count}}` is the same hole).
- **`@objectstack/lint`.** The page field-binding pass resolves `count.field` against the bound object, at error severity, on `os validate`, `os lint` and `os build`: a field the object does not declare is `page-field-unknown`, and a declared field that holds one value is the new `page-section-count-not-multi-value`. A multi-value field is `multiselect`, `checkboxes` or `tags`, or a `select`, `lookup`, `user`, `file` or `image` field with `multiple: true`. A section's `fields[]` miss stays a warning.
- **Not rendered yet.** The key is declared ahead of its renderer and its description carries the `[EXPERIMENTAL — not enforced]` marker: until the record detail renderer reads it, the hole renders as literal text.
- **Nothing to migrate.** No stack that parsed before is refused: every new refusal needs the new key. A `{{ count }}` hole in a section that declares no `count` is still accepted.
