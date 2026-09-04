---
"@objectstack/service-settings": minor
---

fix(service-settings): the settings door answers from the ONE shared value-domain predicate, and refuses a non-member with `value_domain` (#15162)

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable moves: no spec key, export, config field or stored metadata changes spelling or shape, no schema in `packages/spec` changes, and `objectstack migrate meta` has nothing to rewrite. What moves is the `code` value one `FieldError` carries for one condition — the settings save door's refusal of a value outside a declared `valueDomain` — which now spells the standard-catalog member `value_domain` that the field-level half of the same ruling added. The consumer note below is guidance for a client branching on that code; it prescribes no rewrite of any authored artifact. -->

**BREAKING** for a client that branches on the refusal code. Landing inside
the launch window, so it ships as `minor` (the lockstep convention forbids
`major`); the banner is the carrier, not the bump.

The services half of the maintainer's ruling of 2026-09-02: **one closed
vocabulary and one membership predicate shared by settings specifiers and
object fields**. The spec half declared them in `@objectstack/spec/shared`;
this package had been carrying a second copy of all three definitions since
`Specifier.valueDomain` shipped. The copies are deleted and the door now asks
`isValueDomainMember` — the same call the record write path makes.

**The wire change**, measured on `PUT /api/settings/localization` with
`{"timezone": "Mars/Olympus"}`, base `a56baa2bd` vs this branch:

| | before | after |
|:--|:--|:--|
| `fields[0].code` | `invalid_value` | `value_domain` |
| `fields[0].message` | `Default timezone must be a valid IANA time zone identifier (e.g. 'Europe/Zurich'). Received 'Mars/Olympus'.` | `Default timezone must be a valid IANA time zone identifier, e.g. Europe/Zurich (got "Mars/Olympus")` |

Everything else is byte-identical: HTTP 400, the envelope code
`SETTINGS_VALIDATION`, `field`, `label`, `constraint: { valueDomain: … }` and
the echoed `value`. A client that reads `constraint.valueDomain` — the
machine-readable half ADR-0114 asks it to read — is unaffected. A client that
branches on `code === 'invalid_value'` for a domain breach must move to
`value_domain`.

Why the code moved: ADR-0114's rule is that the code is the **constraint's own
name**, the way `max_length` names the bound it breached. This branch took
`invalid_value` — the catalog's slot for "rejected for a reason no other
member names" — only while no member named a standard-domain breach. The
field-level card's spec half added one, so the slot no longer applies. The
message now renders the published catalog template
`value_domain_<domain>` in `en`, which is the same catalog the record write
path renders, so the two doors under one ruling describe one domain in one set
of words. For an `encrypted` specifier the offending value is still never
echoed: the template's value placeholder takes the same mask the REST boundary
uses (`fields[0].value` stays absent, as before).

**No value changes verdict.** The accept sets were measured, not assumed, on
the repo's Node 22 baseline (v22.22.2):

- `iso_3166_alpha2` — the two 249-code lists diffed mechanically before either
  was deleted: identical, including order; symmetric difference 0.
- `iso_4217_currency` — this one changes DEFINITION: a run-time
  `Intl.supportedValuesOf('currency')` probe becomes the key set of the
  checked-in CLDR snapshot `CURRENCY_FRACTION_DIGITS`. 162 codes vs 162,
  symmetric difference 0 in both directions (`CHF` in both, `XYZ` in neither).
  The behaviour that changes is that the verdict no longer varies with the
  host's ICU build — the direction the shared module argues for. A door-level
  test now re-measures it: every code the run-time probe admits must still be
  admitted.
- `iana_time_zone` — the identical `Intl.DateTimeFormat` probe on both sides,
  unmoved.

A ratchet pin (`value-domains.shared-predicate.pin.test.ts`) reddens if any
non-test source in this package re-acquires a membership table, an `Intl`
enumeration probe, or a second caller of the predicate.
