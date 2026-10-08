// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0057 — org-scoped identity objects must be creatable in SINGLE-TENANT.
 *
 * Single-tenant deployments have no auto-stamp (OrgScopingPlugin is
 * multi-tenant-only), so a `required` `organization_id` made
 * sys_business_unit / sys_team uncreatable (VALIDATION_FAILED). The field is
 * now optional; this proves the create path works single-tenant. Since
 * ADR-0131 D3 the row is owned by the Default Organization the boot creates.
 *
 * ADR-0092 update: `sys_team` is `managedBy: 'better-auth'`, so its generic
 * data-API insert is now REJECTED fail-closed for user contexts. As of #1591
 * `sys_team.enable.apiMethods` no longer advertises `create`, so the rejection
 * lands at the HTTP exposure gate (ADR-0049) as a clean 405 — before the
 * engine's identity-write-guard 403 backstop even runs. The canonical user
 * surfaces are better-auth's team endpoints (see sys_team.actions), which the
 * schema itself gates to multi-org mode — single-org hides every
 * team-mutation affordance. The ADR-0057 property (optional `organization_id`)
 * therefore matters for the writers that remain legitimate single-tenant:
 * SYSTEM-context writes. sys_business_unit is plugin-security's table (not
 * better-auth-managed) and keeps the generic create path.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';

describe('ADR-0057: org-scoped identity creatable single-tenant', () => {
  let stack: VerifyStack;
  let token: string;

  beforeAll(async () => {
    stack = await bootStack(showcaseStack, {}); // single-tenant: no org-scoping; the Default Organization exists from the boot
    token = await stack.signIn();
  }, 120_000);

  afterAll(async () => { await stack?.stop?.(); });

  it('creates a sys_business_unit, owned by the Default Organization', async () => {
    // ADR-0057's property — creatable single-tenant, no VALIDATION_FAILED —
    // still holds. [ADR-0131 D3 / D11] What changed is who owns the row: under
    // `single` the Default Organization exists from the boot and the admin's
    // session carries it, so the business unit is that organization's, never
    // organization-less.
    const res = await stack.apiAs(token, 'POST', '/data/sys_business_unit', { name: 'Engineering', kind: 'department' });
    expect(res.status).toBe(201);
    const body: any = await res.json();
    const ql = await stack.kernel.getServiceAsync<any>('objectql');
    const orgs = await ql.find('sys_organization', { where: { slug: 'default' }, limit: 1, context: { isSystem: true } });
    const org = (Array.isArray(orgs) ? orgs : orgs?.records ?? [])[0];
    expect(org?.id, 'the boot created the Default Organization').toBeTruthy();
    expect(body.record?.organization_id).toBe(org.id);
  });

  it('sys_team: generic insert is guarded for users; org_id stays optional for system writes', async () => {
    // #1591 — sys_team is managedBy:'better-auth' and no longer advertises
    // `create` in enable.apiMethods, so a USER-context insert through the
    // generic data API is refused at the HTTP exposure gate (ADR-0049) with a
    // clean 405, before the engine's identity-write-guard 403 backstop runs.
    // The canonical surfaces are better-auth's team endpoints, which the
    // schema gates to multi-org mode — in single-org the affordances are hidden.
    const direct = await stack.apiAs(token, 'POST', '/data/sys_team', { name: 'Tiger Team' });
    expect(direct.status).toBe(405);
    const denied: any = await direct.json();
    expect(denied.code).toBe('OBJECT_API_METHOD_NOT_ALLOWED');

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
