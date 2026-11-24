// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { classifyAddress, parseAddress, unwrapEmbeddedV4, formatAddress } from './address.js';
import { createEnvEgressPolicy, EgressAllowlistError, parseEgressAllowlist } from './policy.js';

/**
 * The rule: a webhook delivery or a flow `http` node request reaches only
 * public addresses unless the operator allowlists the target, and a
 * link-local or cloud metadata address can never be allowlisted. These pins
 * hold the policy half — each refused class, the IPv6 forms that carry an
 * IPv4 address, the never-allowlistable tier, and the allowlist's strict
 * grammar.
 */

const ctx = { source: 'webhook' } as const;

function verdict(address: string, allowedTargets = '', hostname = address) {
    return createEnvEgressPolicy({ allowedTargets }).canConnect({ address, hostname }, ctx) as {
        allow: boolean;
        denyClass?: string;
        allowlisted?: boolean;
    };
}

describe('each refused address class is refused by default', () => {
    const cases: Array<[string, string]> = [
        ['127.0.0.1', 'loopback'],
        ['127.255.0.9', 'loopback'],
        ['::1', 'loopback'],
        ['10.1.2.3', 'private'],
        ['172.16.0.1', 'private'],
        ['172.31.255.255', 'private'],
        ['192.168.1.1', 'private'],
        ['169.254.169.254', 'link-local'],
        ['169.254.0.1', 'link-local'],
        ['fe80::1', 'link-local'],
        ['100.64.0.1', 'cgnat'],
        ['100.127.255.254', 'cgnat'],
        ['0.0.0.0', 'unspecified'],
        ['0.1.2.3', 'unspecified'],
        ['::', 'unspecified'],
        ['224.0.0.1', 'multicast'],
        ['ff02::1', 'multicast'],
        ['255.255.255.255', 'broadcast'],
        ['240.0.0.1', 'reserved'],
        ['fc00::1', 'unique-local'],
        ['fd12:3456::1', 'unique-local'],
        ['64:ff9b:1::1', 'nat64-local'],
        ['100.100.100.200', 'metadata'],
        ['fd00:ec2::254', 'metadata'],
        ['192.0.0.192', 'metadata'],
    ];
    for (const [address, cls] of cases) {
        it(`${address} is refused as ${cls}`, () => {
            const v = verdict(address);
            expect(v.allow).toBe(false);
            expect(v.denyClass).toBe(cls);
        });
    }
});

describe('an IPv6 form carrying an IPv4 address is judged as that IPv4 address', () => {
    const cases: Array<[string, string, string]> = [
        ['::ffff:127.0.0.1', 'loopback', 'IPv4-mapped'],
        ['::ffff:7f00:1', 'loopback', 'IPv4-mapped, hex spelling'],
        ['::ffff:169.254.169.254', 'link-local', 'IPv4-mapped metadata'],
        ['::ffff:0:10.0.0.1', 'private', 'SIIT-translated'],
        ['64:ff9b::a9fe:a9fe', 'link-local', 'NAT64 well-known prefix'],
        ['64:ff9b::127.0.0.1', 'loopback', 'NAT64 with a dotted tail'],
        ['2002:7f00:1::', 'loopback', '6to4'],
        ['2002:a9fe:a9fe::1', 'link-local', '6to4 of the metadata address'],
        ['::127.0.0.1', 'loopback', 'IPv4-compatible'],
        ['::10.0.0.1', 'private', 'IPv4-compatible'],
        ['2001:0:4136:e378:8000:63bf:80ff:fffe', 'loopback', 'Teredo (client 127.0.0.1)'],
        ['[::ffff:192.168.0.1]', 'private', 'bracketed'],
    ];
    for (const [address, cls, form] of cases) {
        it(`${form}: ${address} is refused as ${cls}`, () => {
            const v = verdict(address);
            expect(v.allow).toBe(false);
            expect(v.denyClass).toBe(cls);
        });
    }

    it('unwrapping yields the carried IPv4 address', () => {
        expect(formatAddress(unwrapEmbeddedV4(parseAddress('::ffff:10.20.30.40')!))).toBe('10.20.30.40');
        expect(formatAddress(unwrapEmbeddedV4(parseAddress('2002:0a14:1e28::')!))).toBe('10.20.30.40');
    });
});

describe('CONTROL: public addresses are allowed', () => {
    for (const address of ['93.184.215.14', '8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8', '172.32.0.1', '100.128.0.1']) {
        it(`${address} is allowed`, () => {
            expect(verdict(address).allow).toBe(true);
            expect(classifyAddress(parseAddress(address)!)).toBeNull();
        });
    }
});

describe('an allowlisted target passes; a metadata address never does', () => {
    it('an exact host entry opens that host even though it resolves to a private address', () => {
        const v = verdict('10.0.0.7', 'hooks.internal', 'hooks.internal');
        expect(v).toMatchObject({ allow: true, allowlisted: true });
    });

    it('the host entry opens only that host', () => {
        expect(verdict('10.0.0.7', 'hooks.internal', 'other.internal').allow).toBe(false);
    });

    it('a CIDR entry opens the addresses inside it, and only those', () => {
        expect(verdict('10.1.2.3', '10.0.0.0/8')).toMatchObject({ allow: true, allowlisted: true });
        expect(verdict('192.168.0.1', '10.0.0.0/8').allow).toBe(false);
        expect(verdict('127.0.0.1', '127.0.0.1')).toMatchObject({ allow: true, allowlisted: true });
        expect(verdict('::ffff:127.0.0.1', '127.0.0.1')).toMatchObject({ allow: true, allowlisted: true });
    });

    it('a metadata address is refused even when an allowlist entry covers it', () => {
        expect(verdict('100.100.100.200', '100.64.0.0/10').allow).toBe(false);
        expect(verdict('100.100.100.200', '100.64.0.0/10').denyClass).toBe('metadata');
        expect(verdict('fd00:ec2::254', 'fd00::/8').allow).toBe(false);
        expect(verdict('169.254.169.254', '169.0.0.0/8').allow).toBe(false);
        expect(verdict('169.254.169.254', 'meta.internal', 'meta.internal').allow).toBe(false);
        expect(verdict('fe80::1', 'meta.internal', 'meta.internal').allow).toBe(false);
        expect(verdict('::ffff:169.254.169.254', 'meta.internal', 'meta.internal').allow).toBe(false);
    });
});

describe('a malformed or over-broad allowlist refuses to build', () => {
    const refused = [
        '0.0.0.0/0',
        '::/0',
        '10.0.0.0/7',
        '*',
        '*.internal',
        'http://hooks.internal',
        'hooks.internal:8080',
        'hooks.internal/path',
        '10.0.0.1/8',
        '10.0.0.0/33',
        '10.0.0',
        'a,,b',
        'bad_host',
        '169.254.169.254',
        '169.254.0.0/16',
        'fe80::/64',
        'fd00:ec2::254',
        '100.100.100.200',
        '168.63.129.16',
        'fd00:ec2::23',
        'fd20:ce::254',
        'fd00:c1::a9fe:a9fe',
        'fd00:a9fe:a9fe::1',
        '::ffff:168.63.129.16',
        '64:ff9b:1::a9fe:a9fe',
        '64:ff9b:1:a9fe:a9:fe00::',
        '::ffff:0:0/96',
        '[::1]',
    ];
    for (const raw of refused) {
        it(`'${raw}' is refused`, () => {
            expect(() => parseEgressAllowlist(raw)).toThrow(EgressAllowlistError);
            try {
                parseEgressAllowlist(raw);
            } catch (err) {
                expect((err as EgressAllowlistError).code).toBe('EGRESS_ALLOWLIST_INVALID');
            }
        });
    }

    it('every problem is named at once', () => {
        try {
            parseEgressAllowlist('0.0.0.0/0, *, ok.host');
            throw new Error('did not refuse');
        } catch (err) {
            expect((err as EgressAllowlistError).problems).toHaveLength(2);
        }
    });

    it('createEnvEgressPolicy throws on a malformed allowlist', () => {
        expect(() => createEnvEgressPolicy({ allowedTargets: '0.0.0.0/0' })).toThrow(EgressAllowlistError);
    });

    it('CONTROL: well-formed entries parse', () => {
        expect(parseEgressAllowlist(' hooks.internal , 10.0.0.0/8,127.0.0.1, fd00::/8, ::1, Localhost ')).toHaveLength(6);
        expect(parseEgressAllowlist(undefined)).toEqual([]);
        expect(parseEgressAllowlist('  ')).toEqual([]);
    });
});

describe('every cloud metadata address is refused by default and under a covering allowlist entry', () => {
    // [member, a covering allowlist entry, a neighbour that entry does open]
    const members: Array<[string, string, string]> = [
        ['fd00:ec2::254', 'fd00::/8', 'fd00:ec2::253'],
        ['fd00:ec2::23', 'fd00::/8', 'fd00:ec2::22'],
        ['fd20:ce::254', 'fd20::/16', 'fd20:ce::253'],
        ['fd00:c1::a9fe:a9fe', 'fd00::/8', 'fd00:c1::a9fe:a9fd'],
        ['fd00:a9fe:a9fe::1', 'fd00::/8', 'fd00:a9fe:a9fe::2'],
        ['100.100.100.200', '100.64.0.0/10', '100.100.100.201'],
        ['192.0.0.192', '192.0.0.0/24', '192.0.0.193'],
        ['168.63.129.16', '168.63.0.0/16', '168.63.129.17'],
    ];
    for (const [member, covering, neighbour] of members) {
        it(`${member} is refused by default`, () => {
            expect(verdict(member)).toMatchObject({ allow: false, denyClass: 'metadata' });
        });
        it(`${member} is refused under '${covering}'`, () => {
            expect(verdict(member, covering)).toMatchObject({ allow: false, denyClass: 'metadata' });
            expect(verdict(member, `meta.internal,${covering}`, 'meta.internal')).toMatchObject({ allow: false });
        });
        it(`CONTROL: its neighbour ${neighbour} is opened by '${covering}'`, () => {
            expect(verdict(neighbour, covering)).toMatchObject({ allow: true });
        });
    }

    it('CONTROL: the Azure neighbour is public and allowed with no allowlist at all', () => {
        expect(verdict('168.63.129.17')).toMatchObject({ allow: true });
    });

    // An IPv6 form of an IPv4 member, under an allowlist that covers the form.
    const forms: Array<[string, string, string]> = [
        ['::ffff:168.63.129.16', '168.63.0.0/16', 'IPv4-mapped'],
        ['::ffff:6464:64c8', '100.64.0.0/10', 'IPv4-mapped, hex spelling'],
        ['64:ff9b::a83f:8110', '168.63.0.0/16', 'NAT64 well-known prefix'],
        ['2002:a83f:8110::1', '168.63.0.0/16', '6to4'],
        ['::192.0.0.192', '192.0.0.0/24', 'IPv4-compatible'],
    ];
    for (const [address, covering, form] of forms) {
        it(`${form}: ${address} is refused by default and under '${covering}'`, () => {
            expect(verdict(address)).toMatchObject({ allow: false, denyClass: 'metadata' });
            expect(verdict(address, covering)).toMatchObject({ allow: false, denyClass: 'metadata' });
        });
    }
});

describe('an address under the local-use NAT64 prefix that carries a never-allowlistable IPv4 address is never opened', () => {
    // 169.254.169.254 and 168.63.129.16 in each RFC 6052 layout a translator under 64:ff9b:1::/48 can use.
    const layouts: Array<[string, string]> = [
        ['64:ff9b:1::a9fe:a9fe', '/96'],
        ['64:ff9b:1:0:a9:fea9:fe00:0', '/64'],
        ['64:ff9b:1:a9:fe:a9fe::', '/56'],
        ['64:ff9b:1:a9fe:a9:fe00::', '/48'],
        ['64:ff9b:1::a83f:8110', '/96, the Azure host-platform address'],
    ];
    for (const [address, layout] of layouts) {
        it(`${layout}: ${address} is refused by default and under '64:ff9b:1::/48'`, () => {
            expect(verdict(address)).toMatchObject({ allow: false, denyClass: 'nat64-local' });
            expect(verdict(address, '64:ff9b:1::/48')).toMatchObject({ allow: false });
        });
    }

    it("CONTROL: a private IPv4 address under the prefix is opened by '64:ff9b:1::/48'", () => {
        expect(verdict('64:ff9b:1::a00:1', '64:ff9b:1::/48')).toMatchObject({ allow: true, allowlisted: true });
    });

    it('an allowlist entry naming one such address refuses to build; CONTROL: one carrying a private address parses', () => {
        expect(() => parseEgressAllowlist('64:ff9b:1::a9fe:a9fe')).toThrow(EgressAllowlistError);
        expect(() => parseEgressAllowlist('64:ff9b:1::a83f:8110')).toThrow(EgressAllowlistError);
        expect(parseEgressAllowlist('64:ff9b:1::a00:1')).toHaveLength(1);
    });
});

describe('only public addresses: every special-purpose range that is not globally reachable is refused', () => {
    const refused: Array<[string, string]> = [
        ['192.0.2.1', 'documentation'],
        ['198.51.100.7', 'documentation'],
        ['203.0.113.9', 'documentation'],
        ['::ffff:192.0.2.1', 'documentation'],
        ['198.18.0.1', 'benchmarking'],
        ['198.19.255.254', 'benchmarking'],
        ['192.0.0.9', 'reserved'],
        ['192.88.99.1', 'reserved'],
        ['2001:db8::1', 'documentation'],
        ['3fff::1', 'documentation'],
        ['2001:2::1', 'benchmarking'],
        ['2001:10::1', 'reserved'],
        ['100::1', 'reserved'],
        ['4000::1', 'reserved'],
        ['5f00::1', 'reserved'],
    ];
    for (const [address, cls] of refused) {
        it(`${address} is refused as ${cls}`, () => {
            expect(verdict(address)).toMatchObject({ allow: false, denyClass: cls });
        });
    }

    it('an allowlist entry opens a refused special-purpose range (it is not in the never tier)', () => {
        expect(verdict('192.0.2.1', '192.0.2.0/24')).toMatchObject({ allow: true, allowlisted: true });
    });

    for (const address of ['192.0.3.1', '198.17.255.254', '198.20.0.1', '198.51.101.1', '203.0.114.1', '192.88.100.1', '2001:200::1', '2001:db9::1', '3fff:1000::1', '2c0f::1']) {
        it(`CONTROL: the neighbouring public address ${address} is allowed`, () => {
            expect(verdict(address).allow).toBe(true);
            expect(classifyAddress(parseAddress(address)!)).toBeNull();
        });
    }
});
