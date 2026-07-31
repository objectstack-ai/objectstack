---
"@objectstack/lint": minor
"@objectstack/spec": minor
---

feat(lint): every field-bearing prop on a React page block resolves against the
object it names

#4329 closed ONE of them — `<ListView searchableFields>` — by running the
metadata rule's core from the gate that owns React block props. That prop was an
instance, not the class: every other prop a `kind:'react'` page binds BY FIELD
NAME shipped exactly as typed, the same silent drift `page-field-unknown`
already closes for the page-component `properties` bag one surface over.

`validate-react-page-props` now resolves all of them:

- `<ListView>` `fields` / `columns` / `sort` / `grouping` / `userFilters` /
  `hiddenFields` / `fieldOrder` / `filterableFields`
- `<ObjectForm>` `fields`, `initialValues` KEYS, `sections[].fields[]`
- `<RecordHighlights>` / `<RecordDetails>` / `<RecordPath>` /
  `<RecordRelatedList>` — via the SAME `COMPONENT_FIELD_SPECS` table the
  metadata surface uses, keyed by the block's `schemaType`, so the two surfaces
  agree by construction rather than by two lists that happen to match
- `<Block type="…">` — the escape hatch reaches the same table by the type the
  author writes, so it is checked instead of being a hole

Findings carry the metadata rule's id (`page-field-unknown`) at its advisory
severity, because the consumer behaves the same way: an unknown name is skipped
and the rest renders.

**A FILTER position gates instead.** `<ListView filters>` / `<ObjectChart
filter>` name fields in a QUERY, and an unknown column there is not a skipped
column: the predicate can never match, `SqlDriver` swallows the driver's
"no such column" and returns `[]`, and the surface renders an empty list that
looks exactly like "there is no data" — the silent zero `filter-token-unknown`
and `validate-flow-template-paths`' filter-position call both gate on. Those
are reported as `error`.

Filter positions are also resolved INDEPENDENTLY of each other, unlike every
other value this gate reads. `filters={['status', '=', stage]}` — a static field
beside a React-state value — is the shape a react page actually writes, and the
all-or-nothing static reader skipped the whole array, including the one position
that was knowable.

Everything else is unchanged: a value from a variable, a call, or behind a
spread is unresolvable rather than wrong and is skipped silently (ADR-0072 D1),
as are cross-package objects, objects with no authored field map, dotted
relationship paths, and registry-injected system columns.

### Breaking: `<RecordRelatedList objectName>` is the RELATED object, as the spec always said

`RecordRelatedListProps.objectName` is the related (child) object — that is what
`record:related_list` means on every metadata surface, what
`validate-page-field-bindings` resolves its `columns` against, and what the one
registry component behind both surfaces consumes. The React overlay declared
`objectName` a SECOND time and glossed it "The parent object", and the generated
contract publishes the overlay's description in place of the schema's — so the
react surface both contradicted the spec and lost any way to name the object it
renders.

FROM → TO for a page authored against the old gloss:

```diff
- <RecordRelatedList objectName="account"  recordId={id} relationshipField="account_id" columns={['name','total']} />
+ <RecordRelatedList objectName="invoice"  recordId={id} relationshipField="account_id" columns={['name','total']} />
```

`objectName` names the CHILD object being listed; the parent record stays bound
by `recordId`, and `relationshipField` is the child's field pointing back at it.
The lint above reports the old spelling (the child's columns and its FK do not
resolve against the parent). `objectName` is now also published as required, as
the schema declares it.

The class is closed as well as the instance: `REACT_OVERLAY_SHADOWS` in
`@objectstack/spec/ui` ledgers every overlay prop that restates a spec-schema
prop, and a test asserts the ledger equals the real collision set — so the next
overlay entry that silently redefines a schema prop fails a test instead of
shipping a second dialect.
