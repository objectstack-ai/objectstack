---
'@objectstack/spec': minor
---

feat(spec): an object declares which of its fields is the record's picture — `imageField`, beside `nameField`

Clause-②: yes (widening)

`ObjectSchema` accepts one more optional key, `imageField`. It names the field
whose value is the record's picture, the way `nameField` names the field that is
the record's name: one object-level declaration, read by the record page header
(the record chrome every record detail page shares) — not a per-page
`page:header` prop.

```ts
defineStack({
  objects: [{
    name: 'crm_account',
    nameField: 'name',
    imageField: 'logo',
    fields: {
      name: Field.text({ label: 'Name' }),
      logo: Field.image({ label: 'Logo' }),
    },
  }],
});
```

- **What it may name.** A field of the same object whose type is `image` or
  `avatar`. A name the object does not declare, or a field of any other type
  (a `text` URL column, a `file`), is refused at parse with an issue at
  `imageField` that names the two accepted types — so `defineStack`,
  `ObjectSchema.create()`, `os validate` and the metadata save door
  (`422 INVALID_METADATA`) all refuse it.
- **An empty field.** The contract the reader is held to: a record whose
  picture field is empty shows no picture — no initials or placeholder in its
  place.
- **Who draws it.** No renderer reads the key yet. The record chrome in
  `@object-ui/components` is the reader to come, and until it lands an authored
  `imageField` is accepted, stored and served but nothing draws it. It takes
  effect when that renderer ships, with no re-authoring. The liveness ledger
  records the key as `planned`.

Nothing that parsed before is refused: the key is new, and an object that does
not set it is unchanged.
