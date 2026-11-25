// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0069 D5 — the ONE reading of an IP address and of an address range, for
 * every rule that matches an address against a range: the allow-list gate and
 * its save check (`auth-manager.ts`, `allowed-ip-ranges.ts`), and the
 * client-address trust rule's trusted-network form of `server.trustProxy`
 * (`client-address.ts`). One reading, so a range is never matched one way by
 * the gate and another way by the rule that decides which address the gate
 * judges.
 *
 * INTERNAL. `auth-manager.ts` re-exports the published names
 * (`parseIpRange`, `ipMatchesRange`, `unreadableIpRangeEntries`, `IpRange`),
 * so the package root keeps its surface.
 *
 * ⛔ Keep this module free of imports. The published `./client-address` entry
 * — the lean entry the runtime loads without the better-auth family — imports
 * the matcher from here, so a value import here would become a load-time
 * dependency of every consumer of that entry.
 */

/** ADR-0069 D5 — parse a dotted-quad IPv4 to a uint32, or null when not IPv4. */
export function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (!m) return null;
  const p = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (p.some((n) => n > 255)) return null;
  return (((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3]) >>> 0;
}

/**
 * An address as the ADR-0069 D5 matcher compares it: an IPv4 address as a
 * uint32, any other IPv6 address as its eight 16-bit groups, or `null` when
 * the text is neither. An IPv4-mapped IPv6 address (`::ffff:0:0/96`, dotted
 * or hex) is the IPv4 address it maps: a dual-stack listener reports an IPv4
 * peer in that form, and the allow-list judges the transport's peer address
 * when no proxy is trusted, so an IPv4 range must admit an IPv4 client on such
 * a socket. An IPv6 zone identifier (`%eth0`) is dropped: it names the
 * interface the address was reached on, not the address.
 */
type MatchedAddress = { v4: number } | { v6: number[] };

function readMatchedAddress(text: string): MatchedAddress | null {
  const trimmed = text.trim();
  const v4 = ipv4ToInt(trimmed);
  if (v4 !== null) return { v4 };
  const zoneAt = trimmed.indexOf('%');
  const groups = parseIpv6Literal((zoneAt === -1 ? trimmed : trimmed.slice(0, zoneAt)).toLowerCase());
  if (!groups) return null;
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return { v4: ((groups[6]! << 16) >>> 0) + groups[7]! };
  }
  return { v6: groups };
}

/** Do the first `bits` bits of two eight-group IPv6 addresses agree? */
function ipv6PrefixEqual(a: readonly number[], b: readonly number[], bits: number): boolean {
  for (let i = 0; i < 8 && bits > 0; i++, bits -= 16) {
    const mask = bits >= 16 ? 0xffff : (0xffff << (16 - bits)) & 0xffff;
    if ((a[i]! & mask) !== (b[i]! & mask)) return false;
  }
  return true;
}

/**
 * ADR-0069 D5 — one allow-list entry read as the range it names: its base
 * address ({@link readMatchedAddress}) and how many leading bits a client
 * address must share with it.
 */
export type IpRange = { v4: number; bits: number } | { v6: number[]; bits: number };

/**
 * A prefix length, by family width: one or two decimal digits for IPv4, one to
 * three for IPv6. ASCII digits only; the value is then held to the width.
 */
const PREFIX_LENGTH_DIGITS: Record<32 | 128, RegExp> = { 32: /^[0-9]{1,2}$/, 128: /^[0-9]{1,3}$/ };

/**
 * ADR-0069 D5 — THE reading of an allow-list entry, for every door that judges
 * or saves the list: the sign-in gate ({@link ipMatchesRange}), the settings
 * save check (`allowed-ip-ranges.ts`), the settings binding that applies a
 * stored or env-pinned list (`auth-plugin.ts`), and the deployment's own
 * declaration ({@link assertAllowedIpRanges}). One reading, so a list is never
 * saved under one rule and enforced under another.
 *
 * An entry is an address, IPv4 or IPv6 (an IPv4-mapped IPv6 address is the
 * IPv4 address it maps, and an IPv6 zone identifier is dropped), optionally
 * followed by `/` and a prefix length written in decimal digits: one or two,
 * from 0 to 32, for an IPv4 base; one to three, from 0 to 128, for an IPv6
 * base. Blanks around the entry are not part of it. Anything else names no
 * range and reads `null`: a prefix with any other character in it, one out of
 * the family's range, or nothing after the `/`; a second `/`; a blank inside
 * the entry; text that is not an address. Bits of the base past the prefix are
 * not judged (`203.0.113.5/24` is `203.0.113.0/24`).
 */
export function parseIpRange(entry: unknown): IpRange | null {
  if (typeof entry !== 'string') return null;
  const text = entry.trim();
  if (!text || /\s/.test(text)) return null;
  const slash = text.indexOf('/');
  const base = readMatchedAddress(slash === -1 ? text : text.slice(0, slash));
  if (!base) return null;
  const width = 'v4' in base ? 32 : 128;
  let bits: number = width;
  if (slash !== -1) {
    const prefix = text.slice(slash + 1);
    if (!PREFIX_LENGTH_DIGITS[width].test(prefix)) return null;
    bits = Number.parseInt(prefix, 10);
    if (bits > width) return null;
  }
  return 'v4' in base ? { v4: base.v4, bits } : { v6: base.v6, bits };
}

/** The entries of an allow-list that name no range ({@link parseIpRange}), in list order. */
export function unreadableIpRangeEntries<T>(entries: readonly T[]): T[] {
  return entries.filter((entry) => parseIpRange(entry) === null);
}

/**
 * Expand an IPv6 literal (already unbracketed) to its eight 16-bit groups, or
 * `null` when it is not one. Handles `::` elision and a trailing embedded
 * IPv4 (`::ffff:10.0.0.5`) so the classifier below reads real bits rather
 * than matching text prefixes.
 */
export function parseIpv6Literal(host: string): number[] | null {
  if (!/^[0-9a-f:.]+$/.test(host)) return null;
  const halves = host.split('::');
  if (halves.length > 2) return null;
  const toGroups = (part: string): number[] | null => {
    if (part === '') return [];
    const pieces = part.split(':');
    const out: number[] = [];
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i]!;
      if (piece.includes('.')) {
        // An embedded IPv4 tail is legal only in the last position.
        if (i !== pieces.length - 1) return null;
        const v4 = ipv4ToInt(piece);
        if (v4 === null) return null;
        out.push((v4 >>> 16) & 0xffff, v4 & 0xffff);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(piece)) return null;
      out.push(parseInt(piece, 16));
    }
    return out;
  };
  const head = toGroups(halves[0]!);
  if (head === null) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const tail = toGroups(halves[1]!);
  if (tail === null) return null;
  const elided = 8 - head.length - tail.length;
  if (elided < 1) return null;
  return [...head, ...new Array<number>(elided).fill(0), ...tail];
}

/**
 * ADR-0069 D5 — does `ip` match `range`? The range is read by
 * {@link parseIpRange}: an IPv4 CIDR (`a.b.c.d/n`), an IPv6 CIDR
 * (`2001:db8::/32`: the first `n` of 128 bits), or one exact address. The
 * address is read as the address it denotes ({@link readMatchedAddress}), so
 * an IPv4-mapped IPv6 address on either side compares as its IPv4 address, and
 * an exact IPv6 entry matches however it is spelled. An address is matched only
 * against a range of its own family: an IPv4 range never admits a pure IPv6
 * address, nor an IPv6 range an IPv4 one.
 *
 * An entry that names no range matches no address, its own base address
 * included, so a list holding one admits exactly what its other entries admit.
 * An `ip` that is not an address matches no entry.
 *
 * One matcher for every door that judges the list: the sign-in gate
 * ({@link AuthManager.isClientIpAllowed}) and the settings save check
 * (`allowed-ip-ranges.ts`) must judge the same address the same way.
 */
export function ipMatchesRange(ip: string, range: string): boolean {
  const parsed = parseIpRange(range);
  if (!parsed || typeof ip !== 'string') return false;
  const address = readMatchedAddress(ip);
  if (!address) return false;
  if ('v4' in parsed) {
    if (!('v4' in address)) return false;
    const mask = parsed.bits === 0 ? 0 : (~0 << (32 - parsed.bits)) >>> 0;
    return ((address.v4 & mask) >>> 0) === ((parsed.v4 & mask) >>> 0);
  }
  if (!('v6' in address)) return false;
  return ipv6PrefixEqual(address.v6, parsed.v6, parsed.bits);
}
