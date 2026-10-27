// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The stored text of a client address (`./client-address-canonical.ts`):
// RFC 5952 for IPv6, the value as it came otherwise. The integration half —
// that every seam storing a sign-in's address goes through it — is
// `session-client-address-capture.test.ts`.

import { describe, it, expect } from 'vitest';
import { canonicalClientAddress } from './client-address-canonical';

describe('canonicalClientAddress', () => {
  it.each([
    // The four forms the card names.
    ['the unspecified address in full', '0000:0000:0000:0000:0000:0000:0000:0000', '::'],
    ['loopback in full', '0000:0000:0000:0000:0000:0000:0000:0001', '::1'],
    ['a documentation address with a zero run', '2001:0db8:0000:0000:0000:0000:0000:0001', '2001:db8::1'],
    ['IPv4', '203.0.113.7', '203.0.113.7'],
    // RFC 5952 §4.
    ['uppercase hexadecimal (§4.3)', '2001:DB8::ABCD', '2001:db8::abcd'],
    ['leading zeros in a group (§4.1)', '2001:0db8::0001', '2001:db8::1'],
    ['the longest zero run, not the first (§4.2.3)', '2001:0:0:1:0:0:0:1', '2001:0:0:1::1'],
    ['the first of two equal runs (§4.2.3)', '2001:db8:0:0:1:0:0:1', '2001:db8::1:0:0:1'],
    ['a single zero group is not compressed (§4.2.2)', '2001:db8:0:1:1:1:1:1', '2001:db8:0:1:1:1:1:1'],
    ['a misplaced :: is moved to the longest run', '2001:db8::1:0:0:0:1', '2001:db8:0:1::1'],
    ['already canonical', '::1', '::1'],
    // RFC 5952 §5.
    ['IPv4-mapped keeps the mixed notation', '::ffff:203.0.113.7', '::ffff:203.0.113.7'],
    ['IPv4-mapped in hexadecimal gains the mixed notation', '0:0:0:0:0:FFFF:CB00:7107', '::ffff:203.0.113.7'],
    ['an embedded IPv4 that is not mapped is written in hexadecimal', '64:ff9b::203.0.113.7', '64:ff9b::cb00:7107'],
    // A zone identifier is kept as it came.
    ['a zone identifier', 'FE80:0:0:0:0:0:0:1%eth0', 'fe80::1%eth0'],
  ])('%s: %s → %s', (_label, input, expected) => {
    expect(canonicalClientAddress(input)).toBe(expected);
  });

  it.each([
    ['an unparseable string', 'not-an-address'],
    ['a bracketed address', '[::1]'],
    ['an address with a port', '203.0.113.7:443'],
    ['surrounding whitespace', ' ::1 '],
    ['the empty string', ''],
  ])('%s is returned exactly as it came', (_label, input) => {
    expect(canonicalClientAddress(input)).toBe(input);
  });

  it('undefined stays undefined', () => {
    expect(canonicalClientAddress(undefined)).toBeUndefined();
  });
});
