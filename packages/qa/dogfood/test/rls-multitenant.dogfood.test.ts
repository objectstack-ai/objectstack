// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Org-scoped (#1994) cross-tenant gate — the faithful counterpart to the
// single-tenant smoke in `auto-verify-rls.dogfood.test.ts`.
//
// THE INVESTIGATION (why the single-tenant run showed all `member-visible`),
// stated in the mechanism of its time: `member_default` THEN scoped rows with a
// wildcard `tenant_isolation` policy (`organization_id =
// current_user.organization_id`), and when the org-scoping plugin was absent
// SecurityPlugin.collectRLSPolicies STRIPPED every policy whose predicate
// referenced `current_user.organization_id` (security-plugin.ts) — and
// `member_default` carries NO owner-scoped READ policy — so a fresh member read
// every row. That is the `member-visible` verdict: not a broad-read default of
// the app, but the harness booting single-tenant.
//
// [#6964] Both halves have since moved; the conclusion has not. ADR-0095 D1
// RETIRED that wildcard policy — the tenant scope is now the Layer 0 wall
// (`plugin-security/tenant-layer.ts`), which is inert under the `single` posture
// by construction (`computeTenantLayer0Filter` returns `null` when
// `postureEnforcesWall` is false) rather than by policy stripping. And #5491
// removed `member_default`'s `'*'` grant, so on an app object a fresh member is
// now refused at the CRUD gate before any row scope is consulted. What survives
// is the fact this file is built on: a single-tenant boot applies NO org row
// scope to reads, and `member_default` still carries no owner-scoped READ policy
// (its `owner_only_*` policies are `update`/`delete` only). Apps like hotcrm
// (9 sharing files, `requires: ['sharing']`) rely on exactly this org boundary,
// so a single-tenant boot under-reports their authorization model.
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
//
// ADR-0056 D10 — the authz-conformance matrix row this file is the cited proof
// for; `authz-conformance.test.ts` asserts the pairing is mutual (#7976).
// ⚠️ The claim is CONDITIONAL by construction: the suite is
// `describe.skipIf(!organizationsAvailable)`, so in the open workspace it does
// not run at all and only enterprise/cloud CI (which ships
// `@objectstack/organizations`) actually exercises the row. The marker records
// what this file proves WHERE IT RUNS — it is not an assertion that open-core CI
// proved it. `OS_TEST_MULTI_ORG_ENABLED=1` turns an unexpected skip into a
// failure, which is the mechanism that keeps the skip honest (#4700).
// authz-row: multi-tenant

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crmStack from '@objectstack/example-crm';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { runRlsProofs, formatRlsReport, type RlsReport } from '@objectstack/verify';

// The multi-org runtime moved to the ENTERPRISE `@objectstack/organizations`
// package (ADR-0081 D2) — not part of this open workspace. Skip (loudly) when
// it isn't linked in; enterprise/cloud CI, which ships the package, runs this.
//
// #4700: the probe used to be a bare `import()`, which Node ESM resolves against
// this file's own realpath in the framework workspace — so it answered "not
// installed" unconditionally, everywhere, and this gate had never once run while
// the suite reported green. It now resolves from the host app like the runtime
// does, and `OS_TEST_MULTI_ORG_ENABLED=1` turns an unexpected skip into a
// failure.
import { organizationsAvailable, warnIfUnavailable } from './enterprise-organizations.js';

warnIfUnavailable('multi-org RLS gate');

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
