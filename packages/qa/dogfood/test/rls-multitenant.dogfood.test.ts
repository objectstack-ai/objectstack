// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Org-scoped (#1994) cross-tenant gate — the faithful counterpart to the
// single-tenant smoke in `auto-verify-rls.dogfood.test.ts`.
//
// THE INVESTIGATION (why the single-tenant run showed all `member-visible`):
// `member_default` scopes rows with a wildcard `tenant_isolation` policy
// (`organization_id = current_user.organization_id`). When the org-scoping
// plugin is absent, SecurityPlugin.collectRLSPolicies STRIPS every policy whose
// predicate references `current_user.organization_id` (security-plugin.ts) — and
// `member_default` carries NO owner-scoped READ policy — so a fresh member can
// read every row. That is the `member-visible` verdict: not a broad-read default
// of the app, but the harness booting single-tenant. Apps like hotcrm (9 sharing
// files, `requires: ['sharing']`) rely on exactly this org boundary, so a
// single-tenant boot under-reports their authorization model.
//
// THE FIX: boot with `{ multiTenant: true }` so OrgScopingPlugin registers
// before SecurityPlugin and the wildcard `organization_id` policies APPLY. The
// dev admin is bound to the seeded default organization; a fresh `signUp` member
// is not in it, so the admin's org-scoped records are invisible to them — the
// real cross-tenant scenario. The runner then exercises the #1994 by-id-write
// invariant over org-scoped (not owner-scoped) RLS: member can't read AND the
// pre-image check denies the by-id write → `rls-consistent`.
//
// Empirically (CRM): single-tenant → every object `member-visible`; multi-tenant
// → `rls-consistent` with zero holes. This test asserts that faithful state.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crmStack from '@objectstack/example-crm';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { runRlsProofs, formatRlsReport, type RlsReport } from '@objectstack/verify';

// The multi-org runtime moved to the ENTERPRISE `@objectstack/organizations`
// package (ADR-0081 D2) — not part of this open workspace. Skip (loudly) when
// it isn't linked in; enterprise/cloud CI, which ships the package, runs this.
const organizationsPkg = '@objectstack/organizations';
const organizationsAvailable = await import(/* webpackIgnore: true */ organizationsPkg)
  .then(() => true)
  .catch(() => false);
if (!organizationsAvailable) {
  // eslint-disable-next-line no-console
  console.warn('[dogfood] @objectstack/organizations (enterprise) not installed — skipping the multi-org RLS gate');
}

describe.skipIf(!organizationsAvailable)('objectstack verify RLS: CRM multi-tenant (#1994 org-scoped)', () => {
  let stack: VerifyStack;
  let report: RlsReport;

  beforeAll(async () => {
    stack = await bootStack(crmStack as never, { multiTenant: true });
    const adminToken = await stack.signIn();
    const memberToken = await stack.signUp('member-mt@verify.test');
    report = await runRlsProofs(stack, adminToken, memberToken, crmStack);
    // eslint-disable-next-line no-console
    console.error(formatRlsReport(report));
  }, 90_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('org-scoping engaged: at least one object is rls-consistent (NOT member-visible)', () => {
    // The single-tenant run reports every object `member-visible`; under
    // multi-tenant the tenant policy applies, so cross-tenant objects flip to
    // `rls-consistent`. ≥1 consistent proves the org boundary is genuinely
    // exercised — the difference single-tenant could never show.
    expect(report.summary.consistent, formatRlsReport(report)).toBeGreaterThanOrEqual(1);
  });

  it('has ZERO by-id-write RLS holes across org boundaries (#1994 invariant)', () => {
    const holes = report.results.filter((r) => r.status === 'rls-hole');
    expect(holes, formatRlsReport(report)).toHaveLength(0);
  });
});
