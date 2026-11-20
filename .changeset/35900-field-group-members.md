---
'@objectstack/spec': minor
'@objectstack/lint': minor
'@object-ui/app-shell': minor
'@objectstack/platform-objects': minor
'@object-ui/plugin-detail': minor
---

feat(spec): a field group lists its own members and their order (`fieldGroups[].fields`)

Clause-②: yes (widening)
Metadata-protocol: added

A field group may now list which fields it shows and in what order:

```ts
fieldGroups: [
  { key: 'basic', label: 'Basic', fields: ['account', 'name', 'valid_until'] },
  { key: 'terms', label: 'Terms', fields: ['terms'] },
]
```

The record page, the create and edit forms and the drawer show the group's fields in the list's order, whatever order the object's `fields` declares them in, so a group can be reordered without moving any field (and without changing a list view's default column order).

Nothing changes for an object that writes no `fields` on its groups: a group without the list still holds the fields whose `group` names it, in field declaration order. `Field.group` is the older spelling and is still read; it is not deprecated for removal.

The two spellings must agree. The object parse refuses a field one group lists while its own `group` names another group (reported at both places), a field two groups list, a name one list repeats, and `fields` on a group that places a related list (`relatedList`). A field whose `group` names a listing group that leaves it out is shown after the listed fields, never dropped. A listed name the object does not declare is skipped, so removing a field never makes the object unparseable; `os lint` warns about it (`field-group-member-unknown`).

New export: `readFieldGroupMembership` (`@objectstack/spec/data`), the membership `deriveFieldGroupLayout` places sections from, for editors that also show hidden fields.

Studio: dragging a field inside a group, or into another group, now writes those groups' `fields` lists and leaves the object's field declaration order alone. Only the ungrouped bucket, which has no list, still reorders by declaration order. Moving a field to another group from the field inspector does the same once a list is involved.
