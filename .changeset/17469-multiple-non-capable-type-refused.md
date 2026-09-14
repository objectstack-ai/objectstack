---
"@objectstack/spec": minor
"@objectstack/driver-sql": minor
---

fix(spec)!: `multiple: true` is refused on every type outside the multi-capable set, and driver-sql derives JSON-column storage from the spec predicate (#17469)

<!-- adr-0087: registered field-multiple-non-capable-type-refused -->

**BREAKING** in the accept-set sense, landing in the launch window as `minor`
(the lockstep convention: `major` is refused by `check-changeset-no-major`, and
breaking-ness is carried by this banner plus the ADR-0087 disposition).

Two definitions of "multi-valued" disagreed, and the user saw the disagreement as
a `400`.

- `FieldSchema` accepted `multiple: true` on **any** type.
- `@objectstack/driver-sql`'s `isJsonField` read the flag raw —
  `JSON_COLUMN_TYPES.has(type) || !!field.multiple` — and built a **JSON array
  column** for it.
- `isMultiValueField` — the published spec predicate consumers shape queries from
  — answered **"not multi-value"** for that same field, because `master_detail` /
  `tree` / `text` are outside `MULTI_CAPABLE_TYPES`.

So a related list composed `=` against a JSON array column, and the driver refused
the equality family there with a `400`.

In business terms: `multiple` means "this cell holds several values at once", and
that has meaning only on multi-select, multi-record / multi-user and multi-file
fields — exactly what the spec already declares. A child record with several
masters, a tree node with several parents, or a text box holding several texts has
no meaning on any mainstream platform. The declaration was accepted silently, the
UI rendered a single value, the database built a JSON array column, and the
related list answered the user a 400.

FROM → TO, for metadata that used to parse and now fails:

```ts
// FROM — parsed, stored a JSON array, rendered single, answered `=` with 400
{ type: 'text',          label: 'Aliases',  multiple: true }
{ type: 'master_detail', label: 'Parents',  reference: 'account', multiple: true }
{ type: 'tree',          label: 'Parents',  reference: 'category', multiple: true }

// TO — pick the type that actually holds several values…
{ type: 'tags',   label: 'Aliases' }                                   // several free-form strings
{ type: 'lookup', label: 'Parents', reference: 'account', multiple: true }  // several related records

// …or drop the key, if the cell really holds one value.
{ type: 'text',          label: 'Alias' }
{ type: 'master_detail', label: 'Parent', reference: 'account' }
```

The refusal names the field, its type and the alternative, on the `multiple` path.
`radio` keeps its own narrower 2026-08-22 message (#11437); the two never
double-fire.

**`MULTI_CAPABLE_TYPES` and `isMultiValueField` are untouched**, deliberately: a
field that was already multi-valued by that predicate keeps its declaration, its
storage and its read path byte-identically. What moved is which declarations can
be newly authored, plus the storage decision for the shapes that are now refused.

**Storage change (`@objectstack/driver-sql`)**: `isJsonField` becomes
`JSON_COLUMN_TYPES.has(type) || isMultiValueField(field)`. The file's own header
already called `JSON_COLUMN_TYPES` membership "owned by `@objectstack/spec`"; that
sentence is now true for the `multiple` half too. A column whose field is
multi-valued by the spec predicate is a JSON column exactly as before; the shapes
that change are the ones the schema now refuses at the entrance.

⚠️ **Two consequences worth reading before you upgrade.**

1. A **stored** field carrying `multiple: true` on a non-capable type has no
   lossless conversion — its column was physically built as a JSON array. The
   ADR-0087 semantic entry `field-multiple-non-capable-type-refused` emits the
   structured TODO naming the object, field and type; migrating the data is the
   author's judgment call, and the entry states how to prove it.
2. `isMultiValueField` reads the **authorable** `FieldType` vocabulary. A driver
   -internal column-type alias (`string` / `integer` / `int` / `float` — the
   introspected-column spellings) is not a `FieldType`, so a hand-declared
   external object that puts `multiple: true` on one of those no longer gets a
   JSON column. Declare such a column as `object` or `array` (both are
   `JSON_COLUMN_TYPES` members and unchanged), or as the authorable type it
   really is.
