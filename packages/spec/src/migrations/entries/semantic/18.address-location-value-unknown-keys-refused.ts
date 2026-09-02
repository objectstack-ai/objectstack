// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'address-location-value-unknown-keys-refused',
  surface: 'stored `address` and `location` field VALUES (`AddressSchema` / `AddressValueSchema`, '
    + '`LocationValueSchema` — ADR-0104 D1), and the two authoring doors that parse the same '
    + 'contract: a `location` / `address` field\'s literal `defaultValue` and an action param of '
    + 'those types — undeclared keys',
  replacement: 'the declared key the rejection names. An address value accepts exactly `street`, '
    + '`city`, `state`, `postalCode`, `country`, `countryCode`, `formatted`; a location value '
    + 'exactly `lat`, `lng`, `altitude`, `accuracy`. Every rejection carries the surface, the '
    + 'offending key and a rename (`postal_code` / `zipCode` / `zip` / `postcode` → `postalCode`, '
    + '`latitude` → `lat`, `longitude` → `lng`). A key that names no declared member is removed '
    + 'at the producer — never tolerated at a consumer (AGENTS.md #0.1)',
  reason:
    'Maintainer ruling 2026-09-01 on #13802 (option A). Both value classes were all-optional '
    + 'STRIPPING `z.object`s, so a value with a completely wrong key set parsed green and the '
    + 'wrong keys vanished from the parse output: the showcase seed wrote `postal_code`, the '
    + 'platform accepted it, dropped it, and rendered an empty ZIP box (#13388, objectui#6812; '
    + '#5143 named the same stripping on the widget round-trip), while a stored-value scan over '
    + 'the class could only ever report a clean count it had no way to earn. Closing the two '
    + 'shapes restores declared = enforced and pulls "loose" back to the one deliberate '
    + 'exception (`FileValueSchema`, untouched). Where the refusal BITES is the ADR-0104 write '
    + 'path\'s own evidence-gated posture, deliberately unchanged: a record write carrying an '
    + 'undeclared key is refused only on a deployment that has attested `adr-0104-value-shapes` '
    + '(or opted in with `OS_DATA_VALUE_SHAPE_STRICT_ENABLED=1`); everywhere else it stays '
    + 'warn-first and is reported to the admitted-violation sink, and `os migrate value-shapes` '
    + 'now COUNTS such keys, so a deployment holding them cannot attest until they are cleaned. '
    + 'No read path parses these shapes; a stored value reads back as written.',
  acceptanceCriteria:
    '`os migrate value-shapes` reports zero findings on `address` / `location` fields — every '
    + 'stored value carries only declared keys (`postalCode`, never `postal_code` / `zipCode`; '
    + '`lat` / `lng`, never `latitude` / `longitude` / `heading` / `speed`) — and every '
    + '`address` / `location` `defaultValue` literal and action-param value parses with only '
    + 'declared keys. Declared keys parse byte-identically to before; `FileValueSchema` still '
    + 'admits extra keys.',
};
