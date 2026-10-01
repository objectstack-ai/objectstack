// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21046] `DiscoverySchema.authFamilies` and its one reader,
 * `readAuthFamilies`.
 *
 * Two facts are pinned here; the producers' use of them is pinned in
 * `packages/runtime` and `packages/metadata-protocol`, and the boot-level
 * agreement with `GET /auth/config` and the wire in
 * `packages/qa/dogfood/test/discovery-auth-families.dogfood.test.ts`.
 *
 * 1. The key is DECLARED — a consumer that parses discovery through the spec
 *    keeps it (an undeclared key is stripped silently, the `routes.mcp` lesson)
 *    — closed, and optional (a producer that cannot read the answer emits
 *    nothing).
 * 2. The reader answers from the auth service's own `getPublicConfig()` and
 *    from nothing else, and says `undefined` — never a guessed `false` —
 *    whenever it cannot read a boolean there.
 */

import { describe, it, expect } from 'vitest';
import {
  AuthFamiliesSchema,
  DiscoverySchema,
  GetDiscoveryResponseSchema,
  WELL_KNOWN_CAPABILITY_KEYS,
  readAuthFamilies,
  type DiscoveryResponse,
} from './index';

const base: DiscoveryResponse = {
  name: 'ObjectStack',
  version: '1.0.0',
  environment: 'development',
  routes: { data: '/api/v1/data', metadata: '/api/v1/meta', auth: '/api/v1/auth' },
  locale: { default: 'en', supported: ['en'], timezone: 'UTC' },
  services: {},
  capabilities: Object.fromEntries(
    WELL_KNOWN_CAPABILITY_KEYS.map(key => [key, { enabled: false }]),
  ) as DiscoveryResponse['capabilities'],
};

describe('[#21046] DiscoverySchema.authFamilies — declared, closed, optional', () => {
  it('is kept by the canonical schema AND by the consumer parse', () => {
    for (const admin of [false, true]) {
      expect(DiscoverySchema.parse({ ...base, authFamilies: { admin } }).authFamilies).toEqual({ admin });
      expect(GetDiscoveryResponseSchema.parse({ ...base, authFamilies: { admin } }).authFamilies)
        .toEqual({ admin });
    }
  });

  it('is optional — a producer that cannot read the answer emits nothing', () => {
    expect(DiscoverySchema.parse(base).authFamilies).toBeUndefined();
  });

  it('requires `admin` to be a boolean when the block is present', () => {
    expect(DiscoverySchema.safeParse({ ...base, authFamilies: {} }).success).toBe(false);
    expect(DiscoverySchema.safeParse({ ...base, authFamilies: { admin: 'yes' } }).success).toBe(false);
  });

  it('declares exactly the families both producers answer (a new one is a contract change)', () => {
    expect(Object.keys((AuthFamiliesSchema as any).shape)).toEqual(['admin']);
  });
});

describe('[#21046] readAuthFamilies — the auth service\'s own public config, nothing else', () => {
  const answering = (features: unknown) => ({ getPublicConfig: () => ({ features }) });

  it('reads features.admin off getPublicConfig(), in both directions', () => {
    expect(readAuthFamilies(answering({ admin: false }))).toEqual({ admin: false });
    expect(readAuthFamilies(answering({ admin: true }))).toEqual({ admin: true });
  });

  it('carries only the declared families, whatever else the public config says', () => {
    expect(readAuthFamilies(answering({ admin: true, organization: true, sso: true, twoFactor: false })))
      .toEqual({ admin: true });
  });

  it('calls getPublicConfig on the service itself (an AuthManager method reads `this`)', () => {
    const svc = {
      adminOn: true,
      getPublicConfig(this: { adminOn: boolean }) {
        return { features: { admin: this.adminOn } };
      },
    };
    expect(readAuthFamilies(svc)).toEqual({ admin: true });
  });

  it('answers undefined, never a guessed false, whenever it cannot read a boolean', () => {
    expect(readAuthFamilies(undefined)).toBeUndefined();
    expect(readAuthFamilies(null)).toBeUndefined();
    expect(readAuthFamilies('auth')).toBeUndefined();
    expect(readAuthFamilies({})).toBeUndefined();
    expect(readAuthFamilies({ getPublicConfig: 'not a function' })).toBeUndefined();
    expect(readAuthFamilies({ getPublicConfig: () => undefined })).toBeUndefined();
    expect(readAuthFamilies(answering(undefined))).toBeUndefined();
    expect(readAuthFamilies(answering({}))).toBeUndefined();
    expect(readAuthFamilies(answering({ admin: 'true' }))).toBeUndefined();
    expect(readAuthFamilies({
      getPublicConfig: () => {
        throw new Error('auth config unreadable');
      },
    })).toBeUndefined();
  });
});
