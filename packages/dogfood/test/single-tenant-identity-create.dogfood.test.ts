// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0057 — org-scoped identity objects must be creatable in SINGLE-TENANT.
 *
 * Single-tenant deployments have no `sys_organization` row and no auto-stamp
 * (OrgScopingPlugin is multi-tenant-only), so a `required` `organization_id`
 * made sys_business_unit / sys_team uncreatable (VALIDATION_FAILED). The field
 * is now optional; this proves the create path works with no org.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';

describe('ADR-0057: org-scoped identity creatable single-tenant', () => {
  let stack: VerifyStack;
  let token: string;

  beforeAll(async () => {
    stack = await bootStack(showcaseStack, {}); // single-tenant: no org-scoping, no org row
    token = await stack.signIn();
  }, 120_000);

  afterAll(async () => { await stack?.stop?.(); });

  it('creates a sys_business_unit with no organization_id', async () => {
    const res = await stack.apiAs(token, 'POST', '/data/sys_business_unit', { name: 'Engineering', kind: 'department' });
    expect(res.status).toBe(201);
    const body: any = await res.json();
    expect(body.record?.organization_id ?? null).toBeNull();
  });

  it('creates a sys_team with no organization_id', async () => {
    const res = await stack.apiAs(token, 'POST', '/data/sys_team', { name: 'Tiger Team' });
    expect(res.status).toBe(201);
  });
});
