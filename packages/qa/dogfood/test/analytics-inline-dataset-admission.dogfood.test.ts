// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// END-TO-END equivalence gate: `POST /analytics/dataset/query` with an INLINE
// dataset and `GET /data/<object>` must reach the SAME admission verdict, for
// the same principal, ON BOTH DRIVERS.
//
// ## The defect
//
// The analytics route accepts an inline dataset definition (`body.dataset`)
// from any authenticated caller and compiled it straight to SQL. On a SQL
// driver `NativeSQLStrategy` ran that statement through the driver's raw
// `execute()`, which is documented as a tenant-isolation bypass and which no
// middleware sits in front of — so the request reached the database having
// passed exactly ONE of the three read layers (the row scope, threaded since
// ADR-0021 D-C). A job seeker with NO grant on `ats_employer_member` was
// answered `200 {"rows":[{"cnt":24}]}` where `GET /data/ats_employer_member`
// answered `403 PERMISSION_DENIED`. On the memory driver the same request went
// through the ObjectQL engine, which applies all three layers in one place, and
// was refused. Two strategies, two answers about the security boundary, and the
// permissive one was the default driver's.
//
// ## Why this file boots TWICE
//
// The two drivers reach the analytics service through DIFFERENT strategies —
// `NativeSQLStrategy` on `sqlite-wasm`, `ObjectQLStrategy` on `memory` (which
// cannot run raw SQL) — and the defect was precisely that the two disagreed. A
// gate written against one driver cannot see that class of divergence at all,
// which is how it shipped. Every case below therefore runs from one table
// against both boots, and the verdicts are compared to `/data`'s rather than to
// a hard-coded expectation: the assertion is AGREEMENT, so it stays honest if
// the platform's own answer for a persona ever changes.
//
// ## The negative controls, which are the easy thing to lose
//
// An implementation where the native strategy simply refuses makes the
// equivalence green while deleting the SQL analytics path. So the table also
// carries the ADMITTED rows — an administrator's totals and a member's
// RLS-scoped count — and asserts the analytics number equals the `/data`
// number rather than merely that both were 200.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import {
  admissionFixtureStack,
  admissionFixtureSecurity,
} from './fixtures/analytics-admission-fixture.js';

const ADMIN_OPEN_ROWS = 3;
/** Deliberately DIFFERENT from the open count, so the two objects' totals cannot be confused. */
const ADMIN_WALLED_ROWS = 4;
const MEMBER_ROWS = 2;

/** The smallest dataset query there is — the exact shape the reported probe posted. */
const inlineCount = (object: string) => ({
  name: `probe_${object}`,
  label: 'probe',
  object,
  dimensions: [],
  measures: [{ name: 'cnt', label: 'Count', aggregate: 'count' }],
});

/** …and the grouped form, which is the expressive half of the oracle. */
const inlineGrouped = (object: string) => ({
  name: `probe_grouped_${object}`,
  label: 'probe grouped',
  object,
  dimensions: [{ name: 'region', label: 'Region', field: 'region', type: 'string' }],
  measures: [{ name: 'cnt', label: 'Count', aggregate: 'count' }],
});

/** `403` / `200` / `<other status>` — the admission verdict, nothing finer. */
type Verdict = string;

const DRIVERS = ['sqlite-wasm', 'memory'] as const;

interface Boot {
  stack: VerifyStack;
  adminToken: string;
  memberToken: string;
}

const boots = new Map<string, Boot>();

async function bootFor(driver: (typeof DRIVERS)[number]): Promise<Boot> {
  const stack = await bootStack(admissionFixtureStack as never, {
    security: admissionFixtureSecurity(),
    databaseDriver: driver,
  });
  const adminToken = await stack.signIn();
  const memberToken = await stack.signUp(`admission-${driver}@verify.test`);

  // Author through HTTP as each principal so `created_by` carries the real
  // caller — the owner policy on `admission_open` is what makes the member's
  // admitted count a scoped number rather than the table total.
  for (let i = 0; i < ADMIN_OPEN_ROWS; i++) {
    const r = await stack.apiAs(adminToken, 'POST', '/data/admission_open', {
      name: `admin-open-${i}`,
      region: i % 2 === 0 ? 'west' : 'east',
    });
    expect(r.status).toBeLessThan(300);
  }
  for (let i = 0; i < ADMIN_WALLED_ROWS; i++) {
    const w = await stack.apiAs(adminToken, 'POST', '/data/admission_walled', {
      name: `admin-walled-${i}`,
      region: 'west',
    });
    expect(w.status).toBeLessThan(300);
  }
  for (let i = 0; i < MEMBER_ROWS; i++) {
    const r = await stack.apiAs(memberToken, 'POST', '/data/admission_open', {
      name: `member-open-${i}`,
      region: 'west',
    });
    expect(r.status).toBeLessThan(300);
  }
  return { stack, adminToken, memberToken };
}

/** The `/data` door's verdict, and its count when it admits. */
async function restProbe(
  boot: Boot,
  token: string,
  object: string,
): Promise<{ verdict: Verdict; count: number | undefined }> {
  const res = await boot.stack.apiAs(token, 'GET', `/data/${object}?$top=200&$count=true`);
  if (res.status !== 200) return { verdict: String(res.status), count: undefined };
  const body = (await res.json()) as { records?: unknown[]; total?: number; count?: number };
  const count = body.total ?? body.count ?? body.records?.length ?? 0;
  return { verdict: '200', count: Number(count) };
}

/** The analytics door's verdict for an INLINE dataset, and its count when it admits. */
async function analyticsProbe(
  boot: Boot,
  token: string,
  dataset: unknown,
  selection: { dimensions?: string[]; measures: string[] },
): Promise<{ verdict: Verdict; count: number | undefined }> {
  const res = await boot.stack.apiAs(token, 'POST', '/analytics/dataset/query', {
    dataset,
    selection,
  });
  if (res.status !== 200) return { verdict: String(res.status), count: undefined };
  const body = (await res.json()) as { rows?: Array<Record<string, unknown>> };
  const count = (body.rows ?? []).reduce((sum, row) => sum + Number(row.cnt ?? 0), 0);
  return { verdict: '200', count };
}

describe.each(DRIVERS)(
  'dogfood: inline analytics and /data reach ONE admission verdict [driver=%s]',
  (driver) => {
    beforeAll(async () => {
      boots.set(driver, await bootFor(driver));
    }, 120_000);

    afterAll(async () => {
      await boots.get(driver)?.stack.stop();
      boots.delete(driver);
    });

    it('the app declares ZERO datasets — the surface under test is the INLINE slot', async () => {
      // The premise the independent reproduction established: a deployment that
      // ships no analytics at all has the identical exposure, because
      // `body.dataset` is the reachable slot. A named dataset must 404, which is
      // what proves the refusals below are not "the dataset was not found".
      const boot = boots.get(driver)!;
      const named = await boot.stack.apiAs(boot.memberToken, 'POST', '/analytics/dataset/query', {
        datasetName: 'admission_walled_metrics',
        selection: { measures: ['cnt'] },
      });
      expect(named.status).toBe(404);
    });

    it('a member with NO grant is refused by BOTH doors, with the same status', async () => {
      const boot = boots.get(driver)!;
      const rest = await restProbe(boot, boot.memberToken, 'admission_walled');
      const analytics = await analyticsProbe(
        boot,
        boot.memberToken,
        inlineCount('admission_walled'),
        { measures: ['cnt'] },
      );

      // The premise: `/data` really does refuse here. Without this the
      // equivalence below could hold for the wrong reason.
      expect(rest.verdict).toBe('403');
      expect(analytics.verdict).toBe(rest.verdict);
    });

    it('the GROUPED form of the same request is refused too (the expressive oracle)', async () => {
      const boot = boots.get(driver)!;
      const rest = await restProbe(boot, boot.memberToken, 'admission_walled');
      const analytics = await analyticsProbe(
        boot,
        boot.memberToken,
        inlineGrouped('admission_walled'),
        { dimensions: ['region'], measures: ['cnt'] },
      );
      expect(analytics.verdict).toBe(rest.verdict);
    });

    // ── Negative controls ───────────────────────────────────────────────────
    it('a member WITH the grant is admitted by both doors, and gets the SAME number', async () => {
      const boot = boots.get(driver)!;
      const rest = await restProbe(boot, boot.memberToken, 'admission_open');
      const analytics = await analyticsProbe(
        boot,
        boot.memberToken,
        inlineCount('admission_open'),
        { measures: ['cnt'] },
      );

      expect(rest.verdict).toBe('200');
      expect(analytics.verdict).toBe('200');
      // The owner policy is live, so this is the RLS-scoped number — the
      // control that a fix must not break while adding the object-level layer.
      expect(rest.count).toBe(MEMBER_ROWS);
      expect(analytics.count).toBe(rest.count);
    });

    it('an administrator is admitted on both objects, and gets the SAME numbers', async () => {
      const boot = boots.get(driver)!;
      // The expected totals are the administrator's OWN rows on each object,
      // not the table totals: the platform's ownership floor scopes this
      // principal on these public fixture objects. That is `/data`'s answer, so
      // it must be the analytics answer too — which is the whole assertion. The
      // two objects carry deliberately different counts so a number arriving
      // from the wrong table cannot pass.
      for (const [object, expected] of [
        ['admission_open', ADMIN_OPEN_ROWS],
        ['admission_walled', ADMIN_WALLED_ROWS],
      ] as const) {
        const rest = await restProbe(boot, boot.adminToken, object);
        const analytics = await analyticsProbe(boot, boot.adminToken, inlineCount(object), {
          measures: ['cnt'],
        });
        expect(rest.verdict).toBe('200');
        expect(analytics.verdict).toBe('200');
        expect(rest.count).toBe(expected);
        expect(analytics.count).toBe(rest.count);
      }
    });
  },
);
