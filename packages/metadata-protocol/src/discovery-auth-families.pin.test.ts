// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21046] Discovery reports which optional `/auth` route families are
 * mounted — the `getDiscovery()` producer's half. This is the builder
 * `@objectstack/rest`'s `GET /api/v1/discovery` composes over and passes
 * `authFamilies` through from, i.e. the document an SDK connects through.
 *
 * Same contract as the dispatcher's sibling pin
 * (`packages/runtime/src/discovery-auth-families.pin.test.ts`): the answer is
 * the registered auth service's own public config — what `GET /auth/config`
 * serves — read through `readAuthFamilies`, with no second derivation of "is
 * the admin plugin on". Pinned from the service's answer outward, both values,
 * so a hard-coded `false` (today's stock answer) or `true` cannot pass.
 */

import { describe, it, expect, vi } from 'vitest';
import { DiscoverySchema, readAuthFamilies } from '@objectstack/spec/api';
import { ObjectStackProtocolImplementation } from './index.js';

/** Same minimal engine `discovery-schema-conformance.test.ts` uses. */
function makeImpl(services: Map<string, any>) {
  const engine = {
    registry: { getObject: (_n: string) => undefined, getRegisteredTypes: () => [] },
  };
  return new ObjectStackProtocolImplementation(engine as any, () => services);
}

/** An auth service whose public config — the `/auth/config` body — says `admin`. */
function authAnswering(admin: boolean) {
  return {
    handleRequest: async () => new Response(null, { status: 404 }),
    verify: async () => ({ success: false }),
    getPublicConfig: vi.fn(() => ({
      emailPassword: { enabled: true },
      socialProviders: [],
      features: { admin, organization: true, twoFactor: false },
    })),
  };
}

describe('[#21046] getDiscovery() reports the auth families the auth service says it mounts', () => {
  for (const admin of [false, true]) {
    it(`reports authFamilies.admin: ${admin} when /auth/config's source says ${admin}`, async () => {
      const auth = authAnswering(admin);
      const discovery: any = await makeImpl(new Map([['auth', auth]])).getDiscovery();

      expect(discovery.authFamilies).toEqual({ admin });
      expect(auth.getPublicConfig).toHaveBeenCalled();
      expect(discovery.authFamilies).toEqual(readAuthFamilies(auth));
      expect(discovery.routes.auth).toBe('/api/v1/auth');

      const parsed = DiscoverySchema.safeParse(discovery);
      expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
      expect(parsed.success && parsed.data.authFamilies).toEqual({ admin });
    });
  }

  it('emits no `authFamilies` when no auth service is registered (no auth surface either)', async () => {
    const discovery: any = await makeImpl(new Map()).getDiscovery();

    expect(Object.prototype.hasOwnProperty.call(discovery, 'authFamilies')).toBe(false);
    expect(discovery.routes.auth).toBeUndefined();
  });

  it('emits no `authFamilies` when the auth service publishes no public config — it cannot say, so it does not guess', async () => {
    const { getPublicConfig: _omitted, ...withoutConfig } = authAnswering(true);
    const discovery: any = await makeImpl(new Map([['auth', withoutConfig]])).getDiscovery();

    expect(Object.prototype.hasOwnProperty.call(discovery, 'authFamilies')).toBe(false);
    expect(discovery.routes.auth).toBe('/api/v1/auth');
  });
});
