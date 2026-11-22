// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0069 D5/D7 — the client-address trust rule (`./client-address.ts`), read
// directly: the trusted-network form of `server.trustProxy`, the merging of
// header lines, `readTrustProxy` (the one reading of the declaration every
// consumer applies), and the once-per-process operator warning under
// `server.trustProxy: true`. The consumers' own pins drive the same rule
// through their doors (`client-ip-allow-list-trust-rule.test.ts` here; the
// runtime's `security/inbound-rate-limit.test.ts` and `endpoint-policy.test.ts`).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  LEGACY_TRUST_PROXY_WARNING,
  readTrustProxy,
  resolveClientAddress,
  type TrustedProxyNetworks,
} from './client-address';

/** Documentation ranges (RFC 5737 / RFC 3849) and a private proxy network. */
const PROXY_NETWORK = '10.0.0.0/8';
const PROXY_HOP = '10.0.0.2';
const INNER_HOP = '10.1.2.3';
const CLIENT = '203.0.113.7';
const OTHER = '198.51.100.9';

const NETWORKS: TrustedProxyNetworks = { networks: [PROXY_NETWORK], header: 'x-forwarded-for' };

/** The latch the once-per-process warning keeps on `globalThis`. */
const WARNED = Symbol.for('@objectstack/plugin-auth/client-address:legacy-trust-proxy-warned');

beforeEach(() => {
  delete (globalThis as unknown as Record<symbol, unknown>)[WARNED];
});

describe('the trusted-network form reads the client from the right, past the declared proxies', () => {
  it('takes the first entry from the right that is outside the declared networks', () => {
    // An appending proxy: the entry it adds for its own peer is the rightmost.
    expect(resolveClientAddress({
      headers: { 'x-forwarded-for': `${OTHER}, ${CLIENT}` },
      remoteAddress: PROXY_HOP,
      trustProxy: NETWORKS,
    })).toBe(CLIENT);
    // Two declared hops in front of the client: both are skipped.
    expect(resolveClientAddress({
      headers: { 'x-forwarded-for': `${OTHER}, ${CLIENT}, ${INNER_HOP}` },
      remoteAddress: PROXY_HOP,
      trustProxy: NETWORKS,
    })).toBe(CLIENT);
  });

  it('control: a request through one declared proxy is the client that proxy reports', () => {
    expect(resolveClientAddress({
      headers: { 'x-forwarded-for': CLIENT },
      remoteAddress: PROXY_HOP,
      trustProxy: NETWORKS,
    })).toBe(CLIENT);
  });

  it('believes no forwarded header from a peer outside the declared networks', () => {
    expect(resolveClientAddress({
      headers: { 'x-forwarded-for': OTHER, 'x-real-ip': OTHER },
      remoteAddress: CLIENT,
      trustProxy: NETWORKS,
    })).toBe(CLIENT);
    // No peer at all: nothing is established, whatever the headers say.
    expect(resolveClientAddress({ headers: { 'x-forwarded-for': OTHER }, trustProxy: NETWORKS })).toBeUndefined();
  });

  it('every entry inside the declared networks: the leftmost of them is the client', () => {
    expect(resolveClientAddress({
      headers: { 'x-forwarded-for': `${INNER_HOP}, ${PROXY_HOP}` },
      remoteAddress: PROXY_HOP,
      trustProxy: NETWORKS,
    })).toBe(INNER_HOP);
  });

  it('a declared proxy that sent no forwarded header: the client is the peer itself', () => {
    expect(resolveClientAddress({ headers: {}, remoteAddress: PROXY_HOP, trustProxy: NETWORKS })).toBe(PROXY_HOP);
  });

  it('a trusted hop that reports an entry which is not an address establishes none', () => {
    expect(resolveClientAddress({
      headers: { 'x-forwarded-for': `${CLIENT}, unknown` },
      remoteAddress: PROXY_HOP,
      trustProxy: NETWORKS,
    })).toBeUndefined();
  });

  it('reads X-Real-IP only when the form names it, and then reads nothing else', () => {
    const xff = { 'x-forwarded-for': OTHER, 'x-real-ip': CLIENT };
    expect(resolveClientAddress({ headers: xff, remoteAddress: PROXY_HOP, trustProxy: NETWORKS })).toBe(OTHER);
    expect(resolveClientAddress({
      headers: { 'x-real-ip': CLIENT },
      remoteAddress: PROXY_HOP,
      trustProxy: NETWORKS,
    })).toBe(PROXY_HOP);
    const realIp: TrustedProxyNetworks = { networks: [PROXY_NETWORK], header: 'x-real-ip' };
    expect(resolveClientAddress({ headers: xff, remoteAddress: PROXY_HOP, trustProxy: realIp })).toBe(CLIENT);
  });

  it('matches an IPv6 network and an IPv4 peer reported in IPv4-mapped form', () => {
    const v6: TrustedProxyNetworks = { networks: ['2001:db8::/32', PROXY_NETWORK], header: 'x-forwarded-for' };
    expect(resolveClientAddress({
      headers: { 'x-forwarded-for': `${OTHER}, ${CLIENT}` },
      remoteAddress: '2001:db8::1',
      trustProxy: v6,
    })).toBe(CLIENT);
    expect(resolveClientAddress({
      headers: { 'x-forwarded-for': `${OTHER}, ${CLIENT}` },
      remoteAddress: `::ffff:${PROXY_HOP}`,
      trustProxy: v6,
    })).toBe(CLIENT);
  });
});

describe('the authored form reaches the rule as written, and is held to it there', () => {
  it('a form with no header reads X-Forwarded-For', () => {
    expect(resolveClientAddress({
      headers: { 'x-forwarded-for': `${OTHER}, ${CLIENT}`, 'x-real-ip': OTHER },
      remoteAddress: PROXY_HOP,
      trustProxy: { networks: [PROXY_NETWORK] },
    })).toBe(CLIENT);
  });

  it('a header outside the closed list, or a prefix-length-0 network, believes nothing', () => {
    expect(resolveClientAddress({
      headers: { forwarded: `for=${OTHER}`, 'x-forwarded-for': OTHER },
      remoteAddress: PROXY_HOP,
      trustProxy: { networks: [PROXY_NETWORK], header: 'forwarded' } as never,
    })).toBe(PROXY_HOP);
    expect(resolveClientAddress({
      headers: { 'x-forwarded-for': OTHER },
      remoteAddress: CLIENT,
      trustProxy: { networks: ['0.0.0.0/0', '::/0'] },
    })).toBe(CLIENT);
  });
});

describe('a forwarded header sent as several lines is read as one list', () => {
  it('the trusted-network form walks every line, the last line rightmost', () => {
    expect(resolveClientAddress({
      headers: { 'x-forwarded-for': [OTHER, CLIENT] },
      remoteAddress: PROXY_HOP,
      trustProxy: NETWORKS,
    })).toBe(CLIENT);
  });

  it('`true` still reads the leftmost entry of the merged list', () => {
    expect(resolveClientAddress({
      headers: { 'x-forwarded-for': [`${CLIENT}, ${PROXY_HOP}`, INNER_HOP] },
      remoteAddress: PROXY_HOP,
      trustProxy: true,
    })).toBe(CLIENT);
  });
});

describe('`server.trustProxy: true` and `false` read as before', () => {
  it('`true` believes the leftmost X-Forwarded-For entry, then X-Real-IP, then the peer', () => {
    expect(resolveClientAddress({ headers: { 'x-forwarded-for': CLIENT }, remoteAddress: PROXY_HOP, trustProxy: true }))
      .toBe(CLIENT);
    expect(resolveClientAddress({ headers: { 'x-real-ip': CLIENT }, remoteAddress: PROXY_HOP, trustProxy: true }))
      .toBe(CLIENT);
    expect(resolveClientAddress({ headers: {}, remoteAddress: PROXY_HOP, trustProxy: true })).toBe(PROXY_HOP);
  });

  it('`false` believes no forwarded header', () => {
    expect(resolveClientAddress({
      headers: { 'x-forwarded-for': OTHER, 'x-real-ip': OTHER },
      remoteAddress: CLIENT,
      trustProxy: false,
    })).toBe(CLIENT);
  });
});

describe('under `server.trustProxy: true` the rule warns once per process about a multi-entry X-Forwarded-For', () => {
  it('warns once, at the first multi-entry header, and not again', () => {
    const warn = vi.fn();
    const multi = { 'x-forwarded-for': `${CLIENT}, ${PROXY_HOP}` };
    resolveClientAddress({ headers: { 'x-forwarded-for': CLIENT }, remoteAddress: PROXY_HOP, trustProxy: true, warn });
    expect(warn).not.toHaveBeenCalled();
    resolveClientAddress({ headers: multi, remoteAddress: PROXY_HOP, trustProxy: true, warn });
    resolveClientAddress({ headers: multi, remoteAddress: PROXY_HOP, trustProxy: true, warn });
    const second = vi.fn();
    resolveClientAddress({ headers: multi, remoteAddress: PROXY_HOP, trustProxy: true, warn: second });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(LEGACY_TRUST_PROXY_WARNING);
    expect(second, 'the latch is per process, not per consumer').not.toHaveBeenCalled();
  });

  it('a multi-entry header made of several lines counts too', () => {
    const warn = vi.fn();
    resolveClientAddress({ headers: { 'x-forwarded-for': [CLIENT, PROXY_HOP] }, trustProxy: true, warn });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a consumer with no sink does not spend the warning', () => {
    const multi = { 'x-forwarded-for': `${CLIENT}, ${PROXY_HOP}` };
    resolveClientAddress({ headers: multi, trustProxy: true });
    const warn = vi.fn();
    resolveClientAddress({ headers: multi, trustProxy: true, warn });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('never warns under the trusted-network form or `false`', () => {
    const warn = vi.fn();
    const multi = { 'x-forwarded-for': `${CLIENT}, ${PROXY_HOP}` };
    resolveClientAddress({ headers: multi, remoteAddress: PROXY_HOP, trustProxy: NETWORKS, warn });
    resolveClientAddress({ headers: multi, remoteAddress: PROXY_HOP, trustProxy: false, warn });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('readTrustProxy is the one reading of the declaration', () => {
  it('reads `true`, the trusted-network form, and everything else as `false`', () => {
    expect(readTrustProxy(true)).toBe(true);
    for (const value of [false, undefined, null, 'true', 1]) expect(readTrustProxy(value), String(value)).toBe(false);
    expect(readTrustProxy({ networks: [PROXY_NETWORK, '2001:db8::/32', '192.0.2.7'] })).toEqual({
      networks: [PROXY_NETWORK, '2001:db8::/32', '192.0.2.7'],
      header: 'x-forwarded-for',
    });
    expect(readTrustProxy({ networks: [PROXY_NETWORK], header: 'x-real-ip' })).toEqual({
      networks: [PROXY_NETWORK],
      header: 'x-real-ip',
    });
  });

  it('refuses a malformed trusted-network form at the reading, naming the subject', () => {
    // The named subject is asserted, not the prose around it.
    const cases: Array<[unknown, RegExp]> = [
      [{}, /`networks`/],
      [{ networks: [] }, /`networks`/],
      [[PROXY_NETWORK], /`networks`/],
      [{ networks: [PROXY_NETWORK, 'proxy.internal'] }, /"proxy\.internal"/],
      [{ networks: ['10.0.0.0/33'] }, /"10\.0\.0\.0\/33"/],
      [{ networks: [PROXY_NETWORK], header: 'forwarded' }, /"forwarded"/],
      [{ networks: [PROXY_NETWORK], hops: 1 }, /"hops"/],
      [{ networks: ['0.0.0.0/0'] }, /"0\.0\.0\.0\/0"/],
      [{ networks: [PROXY_NETWORK, '::/0'] }, /"::\/0"/],
    ];
    for (const [value, message] of cases) {
      expect(() => readTrustProxy(value), JSON.stringify(value)).toThrow(message);
    }
  });
});
