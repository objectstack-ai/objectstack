// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ONE text form a stored client address takes: RFC 5952 for IPv6, the
 * value as it came for everything else.
 *
 * ## Where it is applied
 *
 * At every seam that STORES the address of a sign-in, so the session row, the
 * audit rows copied from it and the user's last-login stamp spell one address
 * one way:
 *
 *  - the session row's `ip_address`, in the `session.create.before` database
 *    hook every session creation passes (`auth-manager-database-hooks.ts`);
 *  - the refused-sign-in fingerprint of the `login_failed` / `account_locked`
 *    audit rows (`auth-session-audit.ts` `signInClientFingerprint`), which must
 *    carry the same address as the `login` row of a successful sign-in;
 *  - the ADR-0069 D7 `last_login_ip` stamp (`auth-manager-sign-in-lockout.ts`
 *    `stampLastLogin`).
 *
 * The address those seams store is the one the client-address trust rule
 * established (`./client-address.ts`). The vendored auth library's own reader
 * re-derives a session's address from it and stores a different text: every
 * IPv6 address expanded to eight four-digit groups and masked to its /64
 * network (`::1` becomes `0000:0000:0000:0000:0000:0000:0000:0000`), and an
 * IPv4-mapped one unmapped. That derivation is its rate-limit bucket, not the
 * client's address.
 *
 * ## Why not in `./client-address.ts`
 *
 * That module is a published entry the runtime's inbound rate limiter loads,
 * and it is kept free of imports; this one needs `node:net`. The trust rule
 * also feeds the ADR-0069 D5 allow-list, which compares exact IPv6 entries as
 * text, so rewriting the rule's own answer would change which configured
 * entries match. This module changes only what is stored.
 *
 * ## The form
 *
 *  - IPv6 (`isIPv6` from `node:net`): lowercase hexadecimal, no leading zeros
 *    in a group, and the longest run of two or more zero groups (the first, on
 *    a tie) written `::` — RFC 5952 §4. An IPv4-mapped address
 *    (`::ffff:0:0/96`) keeps the mixed notation of RFC 5952 §5,
 *    `::ffff:192.0.2.1`. A zone identifier (`%eth0`) is kept as it came.
 *  - Anything else, IPv4 included, is returned unchanged. An unparseable value
 *    is stored as it came: this never throws, and no sign-in is refused over
 *    the text of an address.
 */

import { isIPv6 } from 'node:net';

/** The eight 16-bit groups of a bare IPv6 address (no zone), or `null`. */
function ipv6Groups(bare: string): number[] | null {
  const halves = bare.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string): number[] | null => {
    if (part === '') return [];
    const groups: number[] = [];
    const tokens = part.split(':');
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!;
      if (token.includes('.')) {
        // An embedded IPv4 address is the last 32 bits, so the last token.
        if (i !== tokens.length - 1) return null;
        const octets = token.split('.');
        if (octets.length !== 4 || octets.some((o) => !/^\d{1,3}$/.test(o) || Number(o) > 255)) return null;
        const [a, b, c, d] = octets.map(Number) as [number, number, number, number];
        groups.push((a << 8) | b, (c << 8) | d);
      } else {
        if (!/^[0-9a-f]{1,4}$/i.test(token)) return null;
        groups.push(Number.parseInt(token, 16));
      }
    }
    return groups;
  };
  const head = parse(halves[0]!);
  const tail = halves.length === 2 ? parse(halves[1]!) : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

/** RFC 5952 §4 text of eight groups. */
function compressIPv6(groups: readonly number[]): string {
  // §4.2.1–4.2.3: the longest run of two or more zero groups, the first on a tie.
  let bestStart = -1;
  let bestLength = 1;
  for (let i = 0; i < groups.length; ) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < groups.length && groups[j] === 0) j++;
    if (j - i > bestLength) {
      bestStart = i;
      bestLength = j - i;
    }
    i = j;
  }
  // §4.1 and §4.3: no leading zeros, lowercase.
  const hex = groups.map((g) => g.toString(16));
  if (bestStart === -1) return hex.join(':');
  return `${hex.slice(0, bestStart).join(':')}::${hex.slice(bestStart + bestLength).join(':')}`;
}

/**
 * `address` in the form a stored client address takes (see the module
 * header): RFC 5952 for IPv6, unchanged otherwise. `undefined` stays
 * `undefined`. Never throws.
 */
export function canonicalClientAddress(address: string): string;
export function canonicalClientAddress(address: string | undefined): string | undefined;
export function canonicalClientAddress(address: string | undefined): string | undefined {
  if (typeof address !== 'string' || !isIPv6(address)) return address;
  const zoneAt = address.indexOf('%');
  const bare = zoneAt === -1 ? address : address.slice(0, zoneAt);
  const zone = zoneAt === -1 ? '' : address.slice(zoneAt);
  const groups = ipv6Groups(bare);
  if (!groups) return address;
  // §5: an IPv4-mapped address keeps the mixed notation.
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const [g6, g7] = [groups[6]!, groups[7]!];
    return `::ffff:${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}${zone}`;
  }
  return `${compressIPv6(groups)}${zone}`;
}
