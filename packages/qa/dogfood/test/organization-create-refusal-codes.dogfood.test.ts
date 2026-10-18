// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24243, ADR-0112] `POST /auth/organization/create`'s two refusals answer with
 * their codes on the real door, on the production `single` posture.
 *
 * `beforeCreateOrganization` refuses in this order:
 *
 *  1. the reserved `__global__` id or slug (ADR-0120 D3): 400 with the standard
 *     `VALIDATION_ERROR`, judged first, on every posture;
 *  2. a deployment whose effective tenancy posture enforces no organization
 *     wall: 403 with the registered `ORGANIZATION_CREATION_DISABLED`, the same
 *     derivation `/auth/config` publishes as `features.multiOrgEnabled`.
 *
 * Both used to answer `message` alone, so a client could only match prose. The
 * plain showcase boot IS that posture, so this file reads each answer's status,
 * its `code`, and the absence of a row. The in-package halves are
 * plugin-auth's `org-create-posture-gate.test.ts` (the gate on every posture,
 * through the real better-auth route) and `auth-manager.test.ts` (the
 * reservation).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const SYSTEM_CTX = { isSystem: true };

describe('#24243: organization/create refusals carry their ADR-0112 codes on a single-organization deployment', () => {
  let stack: VerifyStack;
  let token: string;
  let ql: any;

  /** Rows read in system context: the refusal must have written nothing. */
  const organizationsWithSlug = async (slug: string): Promise<any[]> => {
    const rows = await ql.find('sys_organization', { where: { slug }, limit: 5 }, { context: SYSTEM_CTX });
    return Array.isArray(rows) ? rows : (rows?.records ?? []);
  };

  beforeAll(async () => {
    stack = await bootShowcase({});
    token = await stack.signIn();
    ql = await stack.kernel.getServiceAsync<any>('objectql');
  }, 120_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('boots the posture it asserts: no organization wall, as /auth/config publishes it', async () => {
    // Guard the guard: were the boot ever to open the route, the refusal below
    // would read as a regression in the gate rather than a changed fixture.
    const cfg = await stack.api('/auth/config');
    expect(cfg.status).toBe(200);
    const body = (await cfg.json()) as { data?: { features?: Record<string, unknown> } };
    const features = body.data?.features;
    expect(features, `no features in /auth/config: ${JSON.stringify(body)}`).toBeDefined();
    expect(features!.multiOrgEnabled).toBe(false);
  });

  it('a new organization is refused 403 ORGANIZATION_CREATION_DISABLED, and none is created', async () => {
    const res = await stack.apiAs(token, 'POST', '/auth/organization/create', {
      name: 'Second Org 24243',
      slug: 'second-org-24243',
    });

    const body = await res.clone().json();
    expect(res.status, JSON.stringify(body)).toBe(403);
    expect(body?.code).toBe('ORGANIZATION_CREATION_DISABLED');
    expect(await organizationsWithSlug('second-org-24243')).toHaveLength(0);
  });

  it("the reserved '__global__' slug is refused 400 VALIDATION_ERROR, ahead of the posture's refusal", async () => {
    const res = await stack.apiAs(token, 'POST', '/auth/organization/create', {
      name: 'Global 24243',
      slug: '__global__',
    });

    const body = await res.clone().json();
    expect(res.status, JSON.stringify(body)).toBe(400);
    expect(body?.code).toBe('VALIDATION_ERROR');
    expect(await organizationsWithSlug('__global__')).toHaveLength(0);
  });
});
