---
"@objectstack/spec": minor
"@objectstack/lint": minor
---

feat(spec,lint): a layout section can reference a declared field group instead of copying its members (#13855)

Additive accept widening. Maintainer ruling 2026-08-31 (option B on #13855):
「直接处理b」.

ADR-0085 makes `fieldGroups` + `Field.group` the canonical grouping, assembled in
one place — `deriveFieldGroupLayout` (ADR-0085 §5). The two layout escape hatches
were whole-takeover shapes with no way back to it: a custom record page's
`record:details` `properties.sections` and a view-level `form.sections` each
enumerated their members by hand, so an author who reached for either had to
hand-copy the same membership fact a second and third time. Nothing linked the
copies to the declaration, so every field added to the object afterwards made
them quietly staler — measured on a real app as three disagreeing groupings of
one object, with the detail page missing two fields the form showed.

**A section may now name the group instead.** On both surfaces:

```ts
sections: [
  { group: 'contact_info' },                 // members + presentation derived
  { label: 'Notes', fields: ['note'] },      // enumerated, unchanged
]
```

Members (every visible field whose `Field.group` points at the key, in
field-declaration order) and the group's own presentation (label, icon,
description, `collapse`, `visibleWhen`, and the drop when a group has no visible
members) all come from `deriveFieldGroupLayout`. Nothing is re-implemented in
section land.

**The mixing rule**, declared once for both surfaces and pinned:

- `group` and `fields` are mutually exclusive; a section declaring neither is
  refused (before this change it was unrepresentable, because `fields` was
  required).
- A group-referencing section carries no key the group already declares —
  `name`, `label`, `icon`/`description`, the collapse pair, `visibleWhen` (and
  its deprecated `visibleOn` spelling) are refused beside `group`, each with the
  pointer to the `fieldGroups` entry that owns it. Not a precedence rule: the
  absence of one. The surface keys the group says nothing about — `columns`,
  `pane`, `hideEmpty`, `showBorder`, `headerColor` — ride alongside as usual.
- Across sections, both kinds coexist in declared array order; a
  group-referencing section occupies one slot and expands in place.
- ⛔ Not on a wizard step: a group carries `visibleWhen` and `collapse`, and a
  wizard step has no slot for either (the #13704 refusals, reached through the
  object's declaration instead of the step's own keys).

**Existence is checked by reference diagnostics, not at parse.** The key names
something on a different schema, so the spec door takes any well-formed
snake_case key — the `UserFilterFieldSchema.field` precedent. `@objectstack/lint`
reports a dangling one as `page-section-group-unknown` (`record:details`) or
`form-section-group-unknown` (form views, both the canonical `sections` and the
legacy `groups` bucket), advisory like every other dangling-reference finding in
that family, with the object's declared groups listed in the hint.

The key grammar is now single-sourced as `FIELD_GROUP_KEY_PATTERN` beside the
derivation, so the declaring surface (`ObjectFieldGroupSchema.key`) and the two
referencing surfaces cannot drift into accepting different keys.

**Type-surface note for consumers.** `fields` becomes optional on both section
shapes (that is what makes `group` the other way to declare the same fact), so
`z.infer` now types it `… | undefined`. A consumer that reads `section.fields`
unconditionally must handle the reference form; every in-repo reader already
guards it. No authored metadata changes shape, and nothing that parsed before
stops parsing — `fields: []` included.

The renderer half (objectui) is tracked separately; until it lands, a
group-referencing section is declared and diagnosed but not yet rendered.
