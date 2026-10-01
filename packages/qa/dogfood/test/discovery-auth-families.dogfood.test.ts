// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Discovery answers "does this deployment mount the better-auth admin family",
// on the wire, from the same source `/auth/config` answers it.
//
// ── Why this is a door pin and not only a unit pin ───────────────────────────
//
// The #15920 ruling (maintainer 「同意」, 2026-09-07) kept the plain 404 an
// unmounted `/auth/admin/*` route answers and named discovery as the place an
// SDK caller asks before building those URLs. #21046 measured that discovery
// did not answer: only `routes.auth`, identical with the admin plugin off and
// on, while `GET /auth/config` carried `features.admin`. The unit pins
// (`packages/runtime`, `packages/metadata-protocol`) prove each producer reads
// the auth service's own public config; only a real boot proves the three
// readings a caller can take of one deployment agree:
//
//   1. `GET /api/v1/discovery`            — the REST producer (`getDiscovery()`),
//                                            the one an SDK connects through;
//   2. `GET /.well-known/objectstack`     — the dispatcher producer
//                                            (`getDiscoveryInfo()`), dispatcher-owned
//                                            on every composition;
//   3. `GET /api/v1/auth/config`          — `features.admin`, the source both read.
//
// …and that the answer is TRUE of the wire, not merely of a config object: the
// control leg fires an admin-family route anonymously and reads 404 exactly
// when discovery says the family is absent. A discovery bit that agreed with
// `/auth/config` while the route disagreed with both would be the
// `declared ≠ enforced` lie AGENTS.md "Route & surface ownership" #4 forbids.
//
// ── How the admin family is switched on ──────────────────────────────────────
//
// `bootStack` exposes no auth-plugin override. `OS_SCIM_ENABLED` is the one env
// knob that reaches it — `admin: pluginConfig.admin ?? scimEffective`
// (ADR-0134: SCIM forces the admin plugin on), the derivation
// `admin-route-nonadmin-refusal.dogfood.test.ts` uses. `getPublicConfig()`
// re-reads it per call, so the variable is held for the whole life of the
// admin-on stack and the stock stack is measured with it unset — never flipped
// under a running stack.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';

/** One deployment's three readings of "is the admin family mounted", plus the wire. */
interface Readings {
  /** `authFamilies` off `GET /api/v1/discovery` (REST producer). */
  restDiscovery: unknown;
  /** `authFamilies` off `GET /.well-known/objectstack` (dispatcher producer). */
  wellKnown: unknown;
  /** `features.admin` off `GET /api/v1/auth/config`. */
  authConfigAdmin: unknown;
  /** Status of an anonymous `GET /api/v1/auth/admin/list-users`. */
  adminRouteStatus: number;
}

async function readJson(res: Response, what: string): Promise<any> {
  expect(res.status, `${what} answers 200`).toBe(200);
  return res.json();
}

async function measure(stack: VerifyStack): Promise<Readings> {
  const discovery = await readJson(await stack.api('/discovery'), 'GET /api/v1/discovery');
  const wellKnown = await readJson(await stack.raw('/.well-known/objectstack'), 'GET /.well-known/objectstack');
  const authConfig = await readJson(await stack.api('/auth/config'), 'GET /api/v1/auth/config');
  const adminRoute = await stack.api('/auth/admin/list-users');

  // The two discovery bodies are framed differently, as recorded in
  // `packages/rest/src/rest-route-ledger.ts` (`GET /api/v1/discovery`: "Answers
  // BARE"): the REST one is the document itself, the dispatcher one sits in the
  // `{ success, data }` envelope. Asserted, not tolerated, so a framing change
  // fails here by name instead of reading as an absent key.
  expect(discovery.success, 'REST discovery answers bare (no envelope)').toBeUndefined();
  expect(typeof discovery.routes?.auth, 'REST discovery advertises routes.auth').toBe('string');
  expect(wellKnown.success, '.well-known discovery is enveloped').toBe(true);
  expect(typeof wellKnown.data?.routes?.auth, '.well-known discovery advertises routes.auth').toBe('string');
  expect(authConfig.success, '/auth/config is enveloped').toBe(true);

  return {
    restDiscovery: discovery.authFamilies,
    wellKnown: wellKnown.data.authFamilies,
    authConfigAdmin: authConfig.data.features.admin,
    adminRouteStatus: adminRoute.status,
  };
}

describe('discovery reports the better-auth admin family — stock composition (admin plugin off)', () => {
  let stack: VerifyStack;
  let readings: Readings;
  let priorScim: string | undefined;

  beforeAll(async () => {
    priorScim = process.env.OS_SCIM_ENABLED;
    delete process.env.OS_SCIM_ENABLED;
    stack = await bootStack(showcaseStack);
    readings = await measure(stack);
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (priorScim === undefined) delete process.env.OS_SCIM_ENABLED;
    else process.env.OS_SCIM_ENABLED = priorScim;
  });

  it('/auth/config says the family is off (the source both producers read)', () => {
    expect(readings.authConfigAdmin).toBe(false);
  });

  it('the wire agrees: an admin-family route is not mounted (404)', () => {
    expect(readings.adminRouteStatus).toBe(404);
  });

  it('GET /api/v1/discovery reports `authFamilies.admin: false`', () => {
    expect(readings.restDiscovery).toEqual({ admin: false });
  });

  it('GET /.well-known/objectstack reports the same answer', () => {
    expect(readings.wellKnown).toEqual({ admin: false });
  });
});

describe('discovery reports the better-auth admin family — admin plugin on (OS_SCIM_ENABLED=true)', () => {
  let stack: VerifyStack;
  let readings: Readings;
  let priorScim: string | undefined;

  beforeAll(async () => {
    priorScim = process.env.OS_SCIM_ENABLED;
    process.env.OS_SCIM_ENABLED = 'true';
    stack = await bootStack(showcaseStack);
    readings = await measure(stack);
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (priorScim === undefined) delete process.env.OS_SCIM_ENABLED;
    else process.env.OS_SCIM_ENABLED = priorScim;
  });

  it('/auth/config says the family is on (the source both producers read)', () => {
    expect(readings.authConfigAdmin).toBe(true);
  });

  it('the wire agrees: the admin-family route is mounted (refuses, never 404)', () => {
    expect(readings.adminRouteStatus).not.toBe(404);
  });

  it('GET /api/v1/discovery reports `authFamilies.admin: true`', () => {
    expect(readings.restDiscovery).toEqual({ admin: true });
  });

  it('GET /.well-known/objectstack reports the same answer', () => {
    expect(readings.wellKnown).toEqual({ admin: true });
  });
});
