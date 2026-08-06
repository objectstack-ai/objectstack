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
import { DiscoverySchema, GetDiscoveryResponseSchema } from '@objectstack/spec/api';
import { HttpDispatcher } from './http-dispatcher.js';

/** The keys the protocol declares for a discovery response (canonical + declared alias). */
function declaredResponseKeys(): Set<string> {
  return new Set(Object.keys((GetDiscoveryResponseSchema as any).shape));
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
