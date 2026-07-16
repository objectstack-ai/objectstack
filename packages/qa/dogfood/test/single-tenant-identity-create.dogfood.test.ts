// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0057 — org-scoped identity objects must be creatable in SINGLE-TENANT.
 *
 * Single-tenant deployments have no auto-stamp (OrgScopingPlugin is
 * multi-tenant-only), so a `required` `organization_id` made
 * sys_business_unit / sys_team uncreatable (VALIDATION_FAILED). The field is
 * now optional; this proves the create path works single-tenant.
 *
 * ADR-0092 update: `sys_team` is `managedBy: 'better-auth'`, so its generic
 * data-API insert is now REJECTED fail-closed for user contexts by the
 * identity write guard. The canonical user surfaces are better-auth's team
 * endpoints (see sys_team.actions), which the schema itself gates to
 * multi-org mode — single-org hides every team-mutation affordance. The
 * ADR-0057 property (optional `organization_id`) therefore matters for the
 * writers that remain legitimate single-tenant: SYSTEM-context writes.
 * sys_business_unit is plugin-security's table (not better-auth-managed) and
 * keeps the generic create path.
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

  it('sys_team: generic insert is guarded for users; org_id stays optional for system writes', async () => {
    // ADR-0092 D2 — sys_team is managedBy:'better-auth', so a USER-context
    // insert through the generic data API is rejected fail-closed (the
    // canonical surfaces are better-auth's team endpoints, which the schema
    // gates to multi-org mode — in single-org the affordances are hidden).
    const direct = await stack.apiAs(token, 'POST', '/data/sys_team', { name: 'Tiger Team' });
    expect(direct.status).toBe(403);
    const denied: any = await direct.json();
    expect(denied.code).toBe('PERMISSION_DENIED');

    // ADR-0057's actual regression target — `organization_id` is OPTIONAL at
    // the schema level, so a single-tenant (no org row) write does not die
    // with VALIDATION_FAILED. System-context writes (org-structure sync,
    // seeding) are the writers that remain legitimate post-ADR-0092.
    const ql = await stack.kernel.getServiceAsync<any>('objectql');
    const row = await ql.insert(
      'sys_team',
      { name: 'Tiger Team' },
      { context: { isSystem: true } },
    );
    expect(row?.id).toBeTruthy();
    expect(row?.organization_id ?? null).toBeNull();
  });
});
