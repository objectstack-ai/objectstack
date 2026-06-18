// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Live RLS cross-owner smoke (#1994) over the framework example apps, with a
// real second user. The runner's hole-detection logic is unit-proven in
// `rls-runner.test.ts`; this exercises it end-to-end against real apps.
//
// SCOPE: this file is the single-tenant SMOKE over real apps. Single-tenant
// strips the org `tenant_isolation` policy and a fresh member falls back to
// `member_default` (broad read), so every object reports `member-visible` and
// the by-id-write path isn't exercised HERE. That gap is now closed by two
// sibling tests, so the hard gate lives there, not here:
//   • rls-fixture.dogfood.test.ts     — owner-scoped fixture; green gate +
//     automated red proof + a documented manual #1994 revert proof (README).
//   • rls-multitenant.dogfood.test.ts — `{ multiTenant: true }`; org-scoped
//     (organization_id) isolation, the model real apps like hotcrm use.
// The invariant asserted here (zero holes) still guards against a regression
// that makes a member able to mutate a record it cannot read.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crmStack from '@objectstack/example-crm';
import showcaseStack from '@objectstack/example-showcase';
import { bootDogfoodStack, type DogfoodStack } from '../src/harness.js';
import { runRlsProofs, formatRlsReport, type RlsReport } from '../src/rls.js';

const APPS: Array<[string, unknown]> = [
  ['crm', crmStack],
  ['showcase', showcaseStack],
];

for (const [name, config] of APPS) {
  describe(`objectstack verify RLS: ${name} (#1994 cross-owner)`, () => {
    let stack: DogfoodStack;
    let report: RlsReport;

    beforeAll(async () => {
      stack = await bootDogfoodStack(config as never);
      const adminToken = await stack.signIn();
      const memberToken = await stack.signUp(`member-${name}@verify.test`);
      report = await runRlsProofs(stack, adminToken, memberToken, config);
      // eslint-disable-next-line no-console
      console.error(formatRlsReport(report));
    }, 60_000);

    afterAll(async () => {
      await stack?.stop();
    });

    it('boots with two distinct users and runs cross-owner proofs', () => {
      expect(report.summary.objects).toBeGreaterThan(0);
    });

    it('has ZERO by-id-write RLS holes (#1994 invariant)', () => {
      const holes = report.results.filter((r) => r.status === 'rls-hole');
      expect(holes, formatRlsReport(report)).toHaveLength(0);
    });
  });
}
