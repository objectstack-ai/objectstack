---
'@objectstack/spec': minor
---

feat(spec): `Field.valueDomain` — one closed standard-domain vocabulary and one membership predicate shared by settings specifiers and object fields (maintainer ruling 2026-09-02 on #14168, spec half)

<!-- adr-0087: not-required (accept-set expansion) One new CLOSED optional key
on an existing shape (`FieldSchema.valueDomain`) and one new member of the
closed field-level error catalog (`value_domain`); nothing authorable is
renamed, retired or tombstoned, so there is no conversion to register.
`SpecifierValueDomainSchema` keeps its export name and its exact three
members — it is now an alias of the shared schema, not a second declaration. -->

An object field can now declare that its written value must be a member of a
published standard, with the SAME closed vocabulary a settings specifier's
`valueDomain` already uses — `iana_time_zone` · `iso_4217_currency` ·
`iso_3166_alpha2` — and the same definition of membership. The vocabulary does
not widen.

- `Field.valueDomain` (`@objectstack/spec/data`): authorable on `text` only —
  the one type whose stored value is a single plain string naming the member.
  On any other type the declaration is refused at parse with a located issue
  naming the type (the same applicability door `maxLength` / `minLength` use).
  A domain outside the vocabulary (`iso_8601_date`) is refused by name.
- `ValueDomainSchema` / `ValueDomain` / `isValueDomainMember(domain, value)` /
  `ISO_3166_ALPHA2_CODES` (`@objectstack/spec/shared`): the vocabulary and its
  ONE membership predicate, declared once. `iana_time_zone` is the
  `Intl.DateTimeFormat` probe (`UTC`, `Asia/Kolkata`, `Europe/Kyiv` are
  members; `Europe/Munich` is not — never the `Intl.supportedValuesOf`
  enumeration, which omits `UTC`); `iso_4217_currency` is the key set of the
  package's checked-in CLDR snapshot (162 codes, exact uppercase);
  `iso_3166_alpha2` is the explicit list of the 249 officially assigned
  codes (exact uppercase).
- `SpecifierValueDomainSchema` / `SpecifierValueDomain`
  (`@objectstack/spec/system`): unchanged name, unchanged members, now an
  alias of `ValueDomainSchema` — nothing that imports them moves.
- `FieldErrorCode` gains `value_domain` (ADR-0114 D1: the code is the
  property's own name, like `max_length`), with message templates in the
  four platform locales (`value_domain`, plus one finer variant per domain).

What this release does NOT yet do: refuse a non-member on the record write
path. The record validator does not read `Field.valueDomain` yet; that
enforcement and the settings door's re-point onto the shared predicate are the
engine and services halves of the same ruling and ship in their own releases.
Until the engine half lands, a domain declared on a `text` field is accepted
at parse and describes the contract the write path will enforce.
