---
'@objectstack/objectql': minor
'@objectstack/spec': minor
---

feat(objectql,spec): `Field.valueDomain` binds at the write seam — a non-member is refused with `value_domain` (maintainer ruling 2026-09-02 on #14168, engine half)

**BREAKING** accept-set narrowing on the ObjectQL record write path, shipped as
`minor` under the repo's launch-window convention for breaking changes.

The key is **already published, and published unenforced**. The version-packages
cut `8a1bad8b8` (2026-09-04 10:20Z) consumed the spec half's changeset
`field-value-domain-slot.md` and released `@objectstack/spec@17.3.0`, which
declares `Field.valueDomain`, parses it, and refuses it on any type other than
`text` — and never reads it when a record is written. The 17.3.0 liveness ledger
states the gap in its own words: "a non-member WRITTEN to a `text` field
declaring a domain is accepted today". That write is accepted on 17.3.0 and is
refused from this release on.

**Refused shape**, precisely: a record write that supplies a value for a `text`
field whose definition declares `valueDomain`, where the WRITTEN value is not a
member of the named standard. It fails with the field error code `value_domain`,
carrying `constraint: { valueDomain }` and a message that names the standard in
all four platform locales. Nothing else narrows — a field that declares no
`valueDomain` is untouched, and so is every other field type, because the schema
accepts the key on `text` alone and the validator judges exactly that set.

**Remedy: write a member of the declared standard.** `iana_time_zone` admits
`UTC` and refuses `Mars/Olympus`; `iso_4217_currency` admits `CHF` and refuses
`chf`; `iso_3166_alpha2` admits `CH` and refuses `ZZ`. Dropping the
`valueDomain` declaration from the field lifts the refusal entirely, for an
author who declared a domain they did not mean.

**No stored row is touched, and none becomes invalid.** This is the `min` /
`max` / `maxLength` transition-gate class: a value stored before the domain was
declared — or before this release — is never re-read, and it survives an edit of
another field on the same record. An absent or empty value follows the field's
`required` handling, not this check.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is
renamed, retired or tombstoned. `Field.valueDomain` keeps its name, its type and
its position; this release only makes the declaration the key already carries
bind at the write seam, so `objectstack migrate meta` has no metadata to
rewrite — a document that declares a domain is already in its final spelling,
and one that declares none is untouched. ⚠️ This disposition does NOT rest on
the key being unpublished, and must not be read that way: 17.3.0 shipped
`Field.valueDomain` declared, parsed and UNENFORCED, which is exactly why this
changeset carries the BREAKING banner above. It rests on the stored side
instead. A stored value outside a declared domain is never re-read, so no stored
row is invalidated here and none is reachable by a ledger entry at all. And
which member a stored non-member SHOULD have been is authoring intent no ledger
entry can decide: the stored string carries no evidence of whether the author
meant a different member of that standard, a different standard, or no
declaration at all. The channel that reaches the author is the refusal itself,
raised at the write, naming the standard — the same ground the sibling
accept-set narrowing #15319 stands its own `no-migration-prescription`
disposition on. -->

- The membership test is the spec's shared `isValueDomainMember` — the same
  predicate, over the same closed vocabulary, that a settings specifier's
  `valueDomain` uses. A time zone accepted in Settings is the time zone
  accepted in a field.
- The two authoring forms (`fieldForm`, `objectForm`) gain a `valueDomain`
  control, shown on exactly the types the schema accepts the key on. The
  object-form control's choices are derived from the vocabulary, not re-typed.
