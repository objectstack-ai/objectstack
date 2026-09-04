---
'@objectstack/objectql': minor
'@objectstack/spec': minor
---

feat(objectql,spec): `Field.valueDomain` binds at the write seam — a non-member is refused with `value_domain` (maintainer ruling 2026-09-02 on #14168, engine half)

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is
renamed, retired or tombstoned: this release makes an optional key that was
declared in the same unreleased version START ENFORCING, and adds its two
authoring-form rows. `objectstack migrate meta` has nothing to rewrite — a
stored value outside a domain is never re-read, and metadata that declares a
domain is already in its final spelling. No BREAKING banner, and the derivation
is in the PR body: `Field.valueDomain` has never appeared in a published
release (its declaring changeset, `field-value-domain-slot.md`, is still
pending in `.changeset/` and the whole fixed group versions in lockstep), so no
published version ever accepted a non-member for a declared domain. The accept
set that narrows here is one no consumer has ever been able to reach. -->

A `text` field declaring `valueDomain` now has that declaration enforced when a
record is written: a value that is not a member of the named standard is
refused with the field error code `value_domain`, carrying
`constraint: { valueDomain }` and a message that names the standard in all four
platform locales. Until now the key parsed and constrained nothing.

- The membership test is the spec's shared `isValueDomainMember` — the same
  predicate, over the same closed vocabulary, that a settings specifier's
  `valueDomain` uses. A time zone accepted in Settings is the time zone
  accepted in a field: `iana_time_zone` admits `UTC` and refuses
  `Mars/Olympus`, `iso_4217_currency` admits `CHF` and refuses `chf`,
  `iso_3166_alpha2` admits `CH` and refuses `ZZ`.
- **Written value only** — the `min` / `max` / `maxLength` transition-gate
  class. A value stored before the domain was declared is never re-read and
  survives an edit of another field on the same record; an absent or empty
  value follows the field's `required` handling, not this check.
- The two authoring forms (`fieldForm`, `objectForm`) gain a `valueDomain`
  control, shown on exactly the types the schema accepts the key on. The
  object-form control's choices are derived from the vocabulary, not re-typed.
