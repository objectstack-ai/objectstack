// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#4828] The dispatcher's half of the discovery conformance gate. See the
// sibling file in `packages/metadata-protocol` for the full reasoning; in short,
// `GetDiscoveryResponseSchema` is `DiscoverySchema.partial()` and zod strips
// unknown keys, so the ONLY schema the protocol layer referenced could see
// neither a missing required key nor an undeclared emitted one. This dispatcher
// shape was the worst case of both: it emitted `features` and `endpoints`
// (declared nowhere) and passed `NODE_ENV` through raw into a field the spec
// declares as an ENUM.
//
// The `NODE_ENV` half is self-demonstrating here: vitest sets `NODE_ENV=test`,
// which is not a member of `production|sandbox|development`. Before the fix the
// `environment` assertion below fails **in the very run that proves it** — no
// contrived fixture needed.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ApiRoutesSchema,
  DiscoverySchema,
  GetDiscoveryResponseSchema,
  WELL_KNOWN_CAPABILITY_KEYS,
} from '@objectstack/spec/api';
import { HttpDispatcher } from './http-dispatcher.js';

/** The keys the protocol declares for a discovery response (canonical + declared alias). */
function declaredResponseKeys(): Set<string> {
  return new Set(Object.keys((GetDiscoveryResponseSchema as any).shape));
}

/**
 * [#5679] The keys `ApiRoutesSchema` declares INSIDE `routes` — the same gate
 * one level down, where `routes.mcp` had been hiding.
 *
 * This producer emits `mcp` too, contrary to what #5679's issue body assumed:
 * the routes literal below carries `mcp: isMcpServerEnabled() && hasMcp ? … :
 * undefined`, so the KEY is always present (value `undefined` when the service
 * is absent — `JSON.stringify` drops it on the wire, which is why it read as
 * "not emitted"). `Object.keys()` sees it either way, so this gate covers this
 * producer as squarely as the REST one.
 */
function declaredRouteKeys(): Set<string> {
  return new Set(Object.keys((ApiRoutesSchema as any).shape));
}

/** [#5672] The capability vocabulary, derived from the spec — never hand-listed. */
function declaredCapabilityKeys(): Set<string> {
  return new Set(WELL_KNOWN_CAPABILITY_KEYS as readonly string[]);
}

describe('[#4828] getDiscoveryInfo() conforms to DiscoverySchema', () => {
  let dispatcher: HttpDispatcher;

  beforeEach(() => {
    const kernel = {
      context: {
        getService: (name: string) => {
          if (name === 'objectql') {
            return {
              registry: {
                getObject: vi.fn().mockReturnValue({ name: 'test_obj' }),
                getRegisteredTypes: vi.fn().mockReturnValue([]),
                getAllPackages: vi.fn().mockReturnValue([]),
              },
            };
          }
          return null;
        },
      },
    } as any;
    dispatcher = new HttpDispatcher(kernel);
  });

  it('satisfies the canonical DiscoverySchema', async () => {
    const info = await dispatcher.getDiscoveryInfo('/api/v1');

    const result = DiscoverySchema.safeParse(info);
    expect(
      result.success ? [] : result.error.issues.map(i => `${i.path.join('.')}: ${i.code}`),
      'getDiscoveryInfo() must satisfy the canonical DiscoverySchema',
    ).toEqual([]);
  });

  it('emits NO key the protocol does not declare', async () => {
    const info = await dispatcher.getDiscoveryInfo('/api/v1');

    const declared = declaredResponseKeys();
    const undeclared = Object.keys(info).filter(k => !declared.has(k));
    expect(undeclared, 'undeclared top-level keys on the getDiscoveryInfo() shape').toEqual([]);
  });

  it('[#5679] emits NO `routes` key the schema does not declare', async () => {
    const info: any = await dispatcher.getDiscoveryInfo('/api/v1');

    const declared = declaredRouteKeys();
    const undeclared = Object.keys(info.routes).filter(k => !declared.has(k));
    expect(undeclared, 'undeclared keys inside `routes` on the getDiscoveryInfo() shape').toEqual([]);
  });

  it('[#5679] advertises `routes.mcp` when the mcp service is registered and shaped', async () => {
    // Anti-vacuity for the gate above, and the fact the issue body got wrong:
    // this producer DOES emit `routes.mcp`. Gated on the handler's own
    // predicate (`typeof mcp.handleHttpRequest === 'function'`, #4024) — the
    // key is present either way, carrying the path or `undefined`.
    const kernel = {
      context: {
        getService: (name: string) => {
          if (name === 'objectql') {
            return {
              registry: {
                getObject: vi.fn().mockReturnValue({ name: 'test_obj' }),
                getRegisteredTypes: vi.fn().mockReturnValue([]),
                getAllPackages: vi.fn().mockReturnValue([]),
              },
            };
          }
          if (name === 'mcp') return { handleHttpRequest: () => undefined };
          return null;
        },
      },
    } as any;
    const info: any = await new HttpDispatcher(kernel).getDiscoveryInfo('/api/v1');

    expect(info.routes.mcp).toBe('/api/v1/mcp');
    expect(declaredRouteKeys().has('mcp')).toBe(true);
    expect(DiscoverySchema.safeParse(info).success).toBe(true);

    // …and with no mcp service the key stays present but empty, which is the
    // shape `optional` (not `nullable`) declares.
    const withoutMcp: any = await dispatcher.getDiscoveryInfo('/api/v1');
    expect(Object.prototype.hasOwnProperty.call(withoutMcp.routes, 'mcp')).toBe(true);
    expect(withoutMcp.routes.mcp).toBeUndefined();
  });

  // ═════════════════════════════════════════════════════════════════════════
  // [#5672] Fullness: the vocabulary, whole, from every producer
  // ═════════════════════════════════════════════════════════════════════════
  //
  // The sibling gate in `packages/metadata-protocol` carries the full reasoning.
  // This producer is the one that owned the OTHER half of the split: before
  // ruling A it emitted `search`/`websockets`/`files`/`analytics`/`ai`/
  // `notifications`/`i18n` and nothing else, so `client.capabilities
  // .transactionalBatch` was statically `boolean` and actually `undefined`
  // against any dispatcher-served host.
  describe('[#5672] the capability vocabulary is emitted in full', () => {
    it('emits EVERY declared capability key — undelivered means `enabled: false`, never absent', async () => {
      const info: any = await dispatcher.getDiscoveryInfo('/api/v1');

      const missing = [...declaredCapabilityKeys()].filter(
        k => !Object.prototype.hasOwnProperty.call(info.capabilities, k),
      );
      expect(missing, 'capability keys the getDiscoveryInfo() shape fails to emit').toEqual([]);
    });

    it('reports every capability with a boolean `enabled`', async () => {
      const info: any = await dispatcher.getDiscoveryInfo('/api/v1');

      const nonBoolean = Object.entries(info.capabilities as Record<string, any>)
        .filter(([, v]) => typeof v?.enabled !== 'boolean')
        .map(([k, v]) => `${k}: ${typeof v?.enabled}`);
      expect(nonBoolean, 'capability entries whose `enabled` is not a boolean').toEqual([]);
    });

    it('emits NO capability key the vocabulary does not declare', async () => {
      const info: any = await dispatcher.getDiscoveryInfo('/api/v1');

      const declared = declaredCapabilityKeys();
      const undeclared = Object.keys(info.capabilities).filter(k => !declared.has(k));
      expect(undeclared, 'undeclared keys inside `capabilities` on the getDiscoveryInfo() shape').toEqual([]);
    });

    it('anti-vacuity: the six keys this producer never used to emit are really answered', async () => {
      const info: any = await dispatcher.getDiscoveryInfo('/api/v1');

      // The metadata-protocol half of the old split, measured on THIS producer.
      for (const key of ['comments', 'automation', 'cron', 'export', 'chunkedUpload', 'transactionalBatch'] as const) {
        expect(info.capabilities[key], `capabilities.${key}`).toBeDefined();
        expect(typeof info.capabilities[key].enabled, `capabilities.${key}.enabled`).toBe('boolean');
      }

      // `comments` is TRUE here, and that is the anti-vacuity that matters:
      // this suite's kernel stubs `registry.getObject` to answer every name, so
      // `sys_comment` resolves. A hardcoded `false` — the shape ruling A allows
      // for a capability a producer cannot deliver — would read `false` here,
      // so this one assertion is what proves the key is MEASURED rather than
      // stamped. Its `false` counterpart is the dedicated test below.
      expect(info.capabilities.comments.enabled).toBe(true);

      // The rest are genuinely absent on a kernel with no services registered.
      for (const key of ['automation', 'cron', 'export', 'chunkedUpload', 'transactionalBatch'] as const) {
        expect(info.capabilities[key].enabled, `capabilities.${key}.enabled`).toBe(false);
      }
    });

    it('answers `comments` from the registry it can actually reach, not from a hardcoded false', async () => {
      // Ruling A point 3 says an undeliverable capability is `false` — but it
      // does NOT license answering `false` for a capability the producer CAN
      // compute. This dispatcher resolves `objectql` for its own data domain,
      // and `/data/sys_comment` is exactly how comments are served (ADR-0052
      // §5), so the honest answer tracks the object's presence — the same
      // derivation `getDiscovery()` uses, from this producer's own kernel face.
      const kernel = {
        context: {
          getService: (name: string) => {
            if (name === 'objectql') {
              return {
                registry: {
                  getObject: (n: string) => (n === 'sys_comment' ? { name: 'sys_comment' } : undefined),
                  getRegisteredTypes: () => [],
                  getAllPackages: () => [],
                },
              };
            }
            return null;
          },
        },
      } as any;

      const info: any = await new HttpDispatcher(kernel).getDiscoveryInfo('/api/v1');
      expect(info.capabilities.comments.enabled).toBe(true);
      expect(DiscoverySchema.safeParse(info).success).toBe(true);

      // …and the other direction: a registry WITHOUT `sys_comment` answers
      // false. Both halves, so neither a stamped `true` nor a stamped `false`
      // could pass this pair.
      const withoutComments = {
        context: {
          getService: (name: string) => (name === 'objectql'
            ? { registry: { getObject: () => undefined, getRegisteredTypes: () => [], getAllPackages: () => [] } }
            : null),
        },
      } as any;
      const bare: any = await new HttpDispatcher(withoutComments).getDiscoveryInfo('/api/v1');
      expect(bare.capabilities.comments.enabled).toBe(false);
    });
  });

  it('has retired `features` and `endpoints` (ADR-0049 enforce-or-remove)', async () => {
    const info: any = await dispatcher.getDiscoveryInfo('/api/v1');

    // `features` → the canonical `capabilities`; the flags themselves survive.
    expect(info).not.toHaveProperty('features');
    expect(info.capabilities.search.enabled).toBe(false);
    expect(info.capabilities.websockets.enabled).toBe(false);

    // `endpoints` was a verbatim duplicate of `routes` with no measured reader.
    expect(info).not.toHaveProperty('endpoints');
    expect(info.routes).toBeDefined();
  });

  describe('maps NODE_ENV into the declared enum instead of passing it through', () => {
    const OLD_NODE_ENV = process.env.NODE_ENV;
    afterEach(() => {
      if (OLD_NODE_ENV === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = OLD_NODE_ENV;
    });

    // The two out-of-enum spellings named in the issue, driven through the REAL
    // producer — `test` is what vitest itself sets, so the raw passthrough was
    // advertising an undeclared value in every test run of this repo.
    it.each([
      ['test', 'development'],
      ['staging', 'sandbox'],
      ['production', 'production'],
      ['qa', 'development'],
    ])('NODE_ENV=%s advertises %s', async (nodeEnv, expected) => {
      process.env.NODE_ENV = nodeEnv;

      const info: any = await dispatcher.getDiscoveryInfo('/api/v1');

      expect(info.environment).toBe(expected);
      // …and the whole body still satisfies the schema with that value in place.
      expect(DiscoverySchema.safeParse(info).success).toBe(true);
    });
  });

  it('emits the canonical `name`, never the deprecated `apiName` alias', async () => {
    const info: any = await dispatcher.getDiscoveryInfo('/api/v1');

    expect(info.name).toBe('ObjectOS');
    // This producer was already canonical-only; pin it so the alias cannot be
    // reintroduced here while it is being retired on the other producer.
    expect(info).not.toHaveProperty('apiName');
  });
});
