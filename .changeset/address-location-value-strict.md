---
"@objectstack/spec": minor
---

feat(spec): refuse undeclared keys on `address` and `location` values — `AddressSchema` / `LocationValueSchema` are strict (#13802)

<!-- adr-0087: registered address-location-value-unknown-keys-refused -->

**BREAKING** accept-set narrowing on two ADR-0104 D1 value contracts, shipped
as `minor` under the repo's launch-window convention for breaking changes; the
migration prescription is registered under protocol major 18. Maintainer
ruling 2026-09-01 on #13802 (director decision batch #26, verbatim 「同意」):
option A.

`LocationValueSchema` and `AddressSchema` (`AddressValueSchema` is the same
schema) were all-optional **stripping** `z.object`s. Every member being
optional meant a value with a completely wrong key set still parsed green,
and the wrong keys vanished from the parse output — the showcase seed wrote
`postal_code`, the platform accepted it, dropped it, and rendered an empty ZIP
box (#13388), while a stored-value scan over either class could only ever
report a clean count it had no way to earn. Both are now `strictObject`s.
`FileValueSchema` stays `z.looseObject` — the one deliberate loose site,
untouched.

**What is refused:** any key the shape does not declare, with a prescriptive
message naming the surface, the key, and a rename where one is known
(`postal_code` / `zipCode` / `zip` / `postcode` → `postalCode`;
`latitude` → `lat`, `longitude` → `lng`). The zod issue is
`unrecognized_keys` and its `keys` name the offending spellings.

**What stays accepted:** every declared key byte-identically —
`street`, `city`, `state`, `postalCode`, `country`, `countryCode`, `formatted`
on an address; `lat`, `lng`, `altitude`, `accuracy` on a location.

**Where the refusal bites — and where it deliberately does not** (the
ADR-0104 posture is unchanged; this changeset narrows the contract, not the
write path's evidence gate):

- **Authoring, hard reject, unconditional:** a `location` / `address` field's
  literal `defaultValue` (`FieldSchema`, #7127) and an action param of those
  types (`validateActionParams`, strict by default since 17.0).
- **Record writes, per deployment:** objectql's `validateRecord` rejects the
  value (`400 VALIDATION_FAILED`, field code `invalid_type`, message naming
  the key) **only** on a deployment that has attested `adr-0104-value-shapes`
  or set `OS_DATA_VALUE_SHAPE_STRICT_ENABLED=1` (`OS_ALLOW_LAX_VALUE_SHAPES=1`
  re-opens). Everywhere else the write is **admitted** warn-first, logged once
  per field, and reported to the admitted-violation sink — exactly as before.
- **`os migrate value-shapes`** now counts an undeclared key as a violation,
  so a deployment holding such values cannot attest until they are cleaned at
  the producer. That scan is what keeps the strict flip from stranding stored
  data.
- **Read paths: none.** No consumer parses these shapes on read; a stored
  `{ …, postal_code }` reads back as it was written. No read path was
  narrowed, and no consumer-side alias is introduced — `postal_code` is
  refused, never read.

## FROM → TO

```ts
// before — parsed green; `postal_code` silently gone from the parsed output
valueSchemaFor({ type: 'address' }, 'stored').safeParse(
  { street: '1 Main St', city: 'Seattle', state: 'WA', postal_code: '98101', country: 'US' })
// => { success: true, data: { street, city, state, country } }

// after — refused, naming the key and the declared spelling
// => { success: false, error: { issues: [{ code: 'unrecognized_keys', keys: ['postal_code'],
//      message: 'Unrecognized key(s) on this address value: `postal_code`. Did you mean `postal_code` → `postalCode`? …' }] } }
```

Fix: spell the key as the contract declares it — `postal_code` → `postalCode`
in the producer (seed, importer, geocoder adapter, widget). For a location,
`latitude` / `longitude` → `lat` / `lng`; drop device extras such as
`heading` / `speed` or model them as fields of their own. Run
`os migrate value-shapes` to find stored values that carry undeclared keys.
