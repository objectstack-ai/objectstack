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
 * The address classes the guard refuses by default. Each names a range a
 * request a tenant can aim must not reach unless the operator allowlists it —
 * except the two {@link NEVER_ALLOWLISTABLE_CLASSES}, which no allowlist opens.
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
    | 'unique-local'
    | 'nat64-local'
    | 'metadata';

/** Classes no allowlist entry can open. */
export const NEVER_ALLOWLISTABLE_CLASSES: ReadonlySet<EgressDenyClass> = new Set(['link-local', 'metadata']);

/**
 * Named instance-metadata addresses outside the link-local ranges. Never
 * allowlistable, whatever range they sit in (`100.100.100.200` is inside
 * CGNAT space, `fd00:ec2::254` inside unique-local space).
 */
export const METADATA_ADDRESSES: readonly string[] = Object.freeze([
    'fd00:ec2::254',
    '100.100.100.200',
    '192.0.0.192',
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
 */
const DENY_TABLE: ReadonlyArray<readonly [CidrBlock, EgressDenyClass]> = [
    [must('255.255.255.255', 32), 'broadcast'],
    [must('0.0.0.0', 8), 'unspecified'],
    [must('10.0.0.0', 8), 'private'],
    [must('100.64.0.0', 10), 'cgnat'],
    [must('127.0.0.0', 8), 'loopback'],
    [must('169.254.0.0', 16), 'link-local'],
    [must('172.16.0.0', 12), 'private'],
    [must('192.168.0.0', 16), 'private'],
    [must('224.0.0.0', 4), 'multicast'],
    [must('240.0.0.0', 4), 'reserved'],
    [must('::', 128), 'unspecified'],
    [must('::1', 128), 'loopback'],
    [must('fe80::', 10), 'link-local'],
    [must('fc00::', 7), 'unique-local'],
    [must('ff00::', 8), 'multicast'],
    [must('64:ff9b:1::', 48), 'nat64-local'],
];

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

/** Whether no allowlist entry may open this (already unwrapped) address. */
export function isNeverAllowlistable(address: ParsedAddress): boolean {
    return NEVER_ALLOWLISTABLE_BLOCKS.some((block) => cidrContains(block, address));
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
    return null;
}
