// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { isIP } from 'node:net';

/**
 * Address arithmetic for the outbound-request guard: parse an IPv4 / IPv6
 * literal into a number, unwrap the IPv6 forms that carry an IPv4 address,
 * and classify the result against the non-public ranges.
 *
 * Pure and dependency-free (beyond `node:net`'s `isIP`), so the policy and
 * its pins judge exactly what the socket layer judges.
 */

/** An IP address as a family and a 32- or 128-bit unsigned integer. */
export interface ParsedAddress {
    readonly family: 4 | 6;
    readonly value: bigint;
}

/**
 * The address classes the guard refuses by default — together, every address
 * that is not public. Each names a range a guarded request must not reach
 * unless the operator allowlists it — except the two
 * {@link NEVER_ALLOWLISTABLE_CLASSES}, which no allowlist opens.
 */
export type EgressDenyClass =
    | 'unspecified'
    | 'loopback'
    | 'private'
    | 'cgnat'
    | 'link-local'
    | 'multicast'
    | 'broadcast'
    | 'reserved'
    | 'documentation'
    | 'benchmarking'
    | 'unique-local'
    | 'nat64-local'
    | 'metadata';

/** Classes no allowlist entry can open. */
export const NEVER_ALLOWLISTABLE_CLASSES: ReadonlySet<EgressDenyClass> = new Set(['link-local', 'metadata']);

/**
 * Named instance-metadata and host-platform addresses outside the link-local
 * ranges. Never allowlistable, whatever range they sit in. Every cloud's
 * IPv4 instance-metadata endpoint inside `169.254.0.0/16` (`169.254.169.254`,
 * `169.254.170.2`, `169.254.170.23`, `169.254.0.23`) and every IPv6 one inside
 * `fe80::/10` is already covered by the link-local tier; these are the ones
 * outside it:
 *
 * - `fd00:ec2::254` — the AWS instance metadata service over IPv6.
 * - `fd00:ec2::23` — the AWS EKS Pod Identity agent over IPv6.
 * - `fd20:ce::254` — the Google Cloud metadata server over IPv6.
 * - `fd00:c1::a9fe:a9fe` — the Oracle Cloud instance metadata service over IPv6.
 * - `fd00:a9fe:a9fe::1` — the Akamai (Linode) metadata service over IPv6.
 * - `100.100.100.200` — the Alibaba Cloud metadata service (inside CGNAT space).
 * - `192.0.0.192` — the Oracle Cloud legacy metadata address.
 * - `168.63.129.16` — the Azure host-platform endpoint (inside public space).
 *
 * An IPv6 form carrying one of the IPv4 members is judged as that member
 * ({@link unwrapEmbeddedV4}), and so is an RFC 6052 form under the local-use
 * NAT64 prefix ({@link nat64LocalCandidates}).
 */
export const METADATA_ADDRESSES: readonly string[] = Object.freeze([
    'fd00:ec2::254',
    'fd00:ec2::23',
    'fd20:ce::254',
    'fd00:c1::a9fe:a9fe',
    'fd00:a9fe:a9fe::1',
    '100.100.100.200',
    '192.0.0.192',
    '168.63.129.16',
]);

const V4_BITS = 32n;
const V6_BITS = 128n;

/** Parse an IPv4 or IPv6 literal (brackets and an IPv6 zone id tolerated). `null` when it is neither. */
export function parseAddress(input: string): ParsedAddress | null {
    let text = input.trim();
    if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
    const zone = text.indexOf('%');
    if (zone !== -1) text = text.slice(0, zone);
    const kind = isIP(text);
    if (kind === 4) return { family: 4, value: parseV4(text) };
    if (kind === 6) {
        const value = parseV6(text);
        return value === null ? null : { family: 6, value };
    }
    return null;
}

function parseV4(text: string): bigint {
    return text.split('.').reduce((acc, octet) => (acc << 8n) | BigInt(Number(octet)), 0n);
}

function parseV6(text: string): bigint | null {
    let head = text;
    let tailV4: bigint | null = null;
    const lastColon = head.lastIndexOf(':');
    const tail = head.slice(lastColon + 1);
    if (tail.includes('.')) {
        if (isIP(tail) !== 4) return null;
        tailV4 = parseV4(tail);
        head = `${head.slice(0, lastColon + 1)}0:0`;
    }
    const halves = head.split('::');
    if (halves.length > 2) return null;
    const left = halves[0] ? halves[0].split(':') : [];
    const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    const missing = 8 - left.length - right.length;
    if (halves.length === 1 && missing !== 0) return null;
    if (missing < 0) return null;
    const groups = [...left, ...new Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...right];
    if (groups.length !== 8) return null;
    let value = 0n;
    for (const group of groups) {
        if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
        value = (value << 16n) | BigInt(parseInt(group, 16));
    }
    if (tailV4 !== null) value = (value & ~0xffffffffn) | tailV4;
    return value;
}

/** Format a parsed address back to its canonical text (IPv6 uncompressed groups, lower case). */
export function formatAddress(address: ParsedAddress): string {
    if (address.family === 4) {
        return [24n, 16n, 8n, 0n].map((shift) => String((address.value >> shift) & 0xffn)).join('.');
    }
    const groups: string[] = [];
    for (let shift = 112n; shift >= 0n; shift -= 16n) groups.push(((address.value >> shift) & 0xffffn).toString(16));
    return groups.join(':');
}

/** A CIDR block: a network address and a prefix length within its family. */
export interface CidrBlock {
    readonly family: 4 | 6;
    readonly network: bigint;
    readonly prefix: number;
}

function bitsOf(family: 4 | 6): bigint {
    return family === 4 ? V4_BITS : V6_BITS;
}

function maskOf(family: 4 | 6, prefix: number): bigint {
    const bits = bitsOf(family);
    const all = (1n << bits) - 1n;
    return prefix === 0 ? 0n : (all >> (bits - BigInt(prefix))) << (bits - BigInt(prefix));
}

/** Build a CIDR block from a literal network and prefix. `null` on a malformed literal or prefix. */
export function cidr(network: string, prefix: number): CidrBlock | null {
    const parsed = parseAddress(network);
    if (!parsed) return null;
    if (!Number.isInteger(prefix) || prefix < 0 || BigInt(prefix) > bitsOf(parsed.family)) return null;
    return { family: parsed.family, network: parsed.value & maskOf(parsed.family, prefix), prefix };
}

/** Whether `address` lies inside `block` (same family only). */
export function cidrContains(block: CidrBlock, address: ParsedAddress): boolean {
    if (block.family !== address.family) return false;
    return (address.value & maskOf(block.family, block.prefix)) === block.network;
}

/** Whether every address of `inner` lies inside `outer`. */
export function cidrWithin(inner: CidrBlock, outer: CidrBlock): boolean {
    return inner.family === outer.family && inner.prefix >= outer.prefix
        && cidrContains(outer, { family: inner.family, value: inner.network });
}

/** Whether the two blocks share at least one address. */
export function cidrOverlaps(a: CidrBlock, b: CidrBlock): boolean {
    return cidrWithin(a, b) || cidrWithin(b, a);
}

function must(network: string, prefix: number): CidrBlock {
    const block = cidr(network, prefix);
    if (!block) throw new Error(`egress: built-in range ${network}/${prefix} does not parse`);
    return block;
}

/**
 * The refused ranges, first match wins (narrower rows above the wider ones
 * that contain them). Judged AFTER {@link unwrapEmbeddedV4}, so an IPv6 form
 * carrying an IPv4 address is judged as that IPv4 address.
 *
 * Together with {@link GLOBAL_UNICAST_V6} this answers "a public address": the
 * IANA special-purpose ranges that are not globally reachable are refused —
 * documentation, benchmarking and IETF protocol-assignment blocks included —
 * and an IPv6 address outside global unicast `2000::/3` is refused whatever
 * it is. A few anycast service addresses inside the refused protocol blocks
 * are refused with them: the safe direction for a rule that promises only
 * public addresses are reached.
 */
const DENY_TABLE: ReadonlyArray<readonly [CidrBlock, EgressDenyClass]> = [
    [must('255.255.255.255', 32), 'broadcast'],
    [must('0.0.0.0', 8), 'unspecified'],
    [must('10.0.0.0', 8), 'private'],
    [must('100.64.0.0', 10), 'cgnat'],
    [must('127.0.0.0', 8), 'loopback'],
    [must('169.254.0.0', 16), 'link-local'],
    [must('172.16.0.0', 12), 'private'],
    [must('192.0.0.0', 24), 'reserved'],
    [must('192.0.2.0', 24), 'documentation'],
    [must('192.88.99.0', 24), 'reserved'],
    [must('192.168.0.0', 16), 'private'],
    [must('198.18.0.0', 15), 'benchmarking'],
    [must('198.51.100.0', 24), 'documentation'],
    [must('203.0.113.0', 24), 'documentation'],
    [must('224.0.0.0', 4), 'multicast'],
    [must('240.0.0.0', 4), 'reserved'],
    [must('::', 128), 'unspecified'],
    [must('::1', 128), 'loopback'],
    [must('fe80::', 10), 'link-local'],
    [must('fc00::', 7), 'unique-local'],
    [must('ff00::', 8), 'multicast'],
    [must('64:ff9b:1::', 48), 'nat64-local'],
    [must('2001:2::', 48), 'benchmarking'],
    [must('2001:db8::', 32), 'documentation'],
    [must('2001::', 23), 'reserved'],
    [must('3fff::', 20), 'documentation'],
];

/** IPv6 global unicast; an IPv6 address outside it (after unwrapping) is refused as `reserved`. */
const GLOBAL_UNICAST_V6 = must('2000::', 3);

/** The never-allowlistable ranges, as blocks (the link-local rows plus each metadata address). */
export const NEVER_ALLOWLISTABLE_BLOCKS: readonly CidrBlock[] = Object.freeze([
    must('169.254.0.0', 16),
    must('fe80::', 10),
    ...METADATA_ADDRESSES.map((a) => must(a, a.includes(':') ? 128 : 32)),
]);

const MAPPED = must('::ffff:0:0', 96);
const SIIT = must('::ffff:0:0:0', 96);
const NAT64 = must('64:ff9b::', 96);
const SIX_TO_FOUR = must('2002::', 16);
const TEREDO = must('2001::', 32);
const COMPAT = must('::', 96);

/**
 * The IPv4 address an IPv6 address carries, when it is one of the forms that
 * route to (or translate into) an IPv4 destination: IPv4-mapped
 * (`::ffff:a.b.c.d`), SIIT (`::ffff:0:a.b.c.d`), NAT64 well-known prefix
 * (`64:ff9b::a.b.c.d`), 6to4 (`2002:AABB:CCDD::`), Teredo (client address,
 * bit-inverted) and IPv4-compatible (`::a.b.c.d`, past `::` and `::1`). Any
 * other address is returned unchanged.
 */
export function unwrapEmbeddedV4(address: ParsedAddress): ParsedAddress {
    if (address.family !== 6) return address;
    const v = address.value;
    const low32 = v & 0xffffffffn;
    if (cidrContains(MAPPED, address) || cidrContains(SIIT, address) || cidrContains(NAT64, address)) {
        return { family: 4, value: low32 };
    }
    if (cidrContains(SIX_TO_FOUR, address)) return { family: 4, value: (v >> 80n) & 0xffffffffn };
    if (cidrContains(TEREDO, address)) return { family: 4, value: low32 ^ 0xffffffffn };
    if (cidrContains(COMPAT, address) && v > 1n) return { family: 4, value: low32 };
    return address;
}

const NAT64_LOCAL = must('64:ff9b:1::', 48);

/**
 * The IPv4 addresses an address under the local-use NAT64 prefix
 * (`64:ff9b:1::/48`, RFC 8215) may carry, one per RFC 6052 layout a
 * translator under that prefix can use (/48, /56, /64 and /96 network
 * prefixes). The prefix length is the translator's configuration, which this
 * guard cannot see, so every layout is a candidate. Empty for any other
 * address.
 */
export function nat64LocalCandidates(address: ParsedAddress): ParsedAddress[] {
    if (address.family !== 6 || !cidrContains(NAT64_LOCAL, address)) return [];
    const v = address.value;
    const v4 = (value: bigint): ParsedAddress => ({ family: 4, value: value & 0xffffffffn });
    return [
        v4((((v >> 64n) & 0xffffn) << 16n) | ((v >> 40n) & 0xffffn)), // /48: bits 48-63, then 72-87
        v4((((v >> 64n) & 0xffn) << 24n) | ((v >> 32n) & 0xffffffn)), // /56: bits 56-63, then 72-95
        v4(v >> 24n), // /64: bits 72-103
        v4(v), // /96: bits 96-127
    ];
}

/**
 * Whether no allowlist entry may open this (already unwrapped) address: it
 * lies in a never-allowlistable block, or it sits under the local-use NAT64
 * prefix in a layout that carries an IPv4 address in one.
 */
export function isNeverAllowlistable(address: ParsedAddress): boolean {
    const inNever = (a: ParsedAddress) => NEVER_ALLOWLISTABLE_BLOCKS.some((block) => cidrContains(block, a));
    return inNever(address) || nat64LocalCandidates(address).some(inNever);
}

/**
 * The deny class of an address, judged on its unwrapped form, or `null` when
 * it is public. A named metadata address answers `metadata` before any range.
 */
export function classifyAddress(address: ParsedAddress): EgressDenyClass | null {
    const effective = unwrapEmbeddedV4(address);
    for (const block of NEVER_ALLOWLISTABLE_BLOCKS) {
        if (block.prefix === (block.family === 4 ? 32 : 128) && cidrContains(block, effective)) return 'metadata';
    }
    for (const [block, cls] of DENY_TABLE) {
        if (cidrContains(block, effective)) return cls;
    }
    if (effective.family === 6 && !cidrContains(GLOBAL_UNICAST_V6, effective)) return 'reserved';
    return null;
}
