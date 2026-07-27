// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// END-TO-END gate for #3597 — "analytics aggregates are scoped to the caller",
// proven through the REAL stack: HTTP → REST execution context → SecurityPlugin
// → the AnalyticsServicePlugin auto-bridges → ObjectQL/NativeSQL strategies.
//
// #3597 was a cross-tenant disclosure: ObjectQLStrategy never consumed
// `getReadScope`, and the `executeAggregate` bridge passes no ExecutionContext,
// so plugin-security's principal-less fall-open skipped its own RLS injection
// too. Both belts were off at once and an authenticated non-admin received
// aggregates computed over every row in the table.
//
// Every pre-existing analytics RLS test injects `getReadScope` as a fake into a
// hand-built AnalyticsService. NONE booted the real plugin, so the
// `getReadScope → security.getReadFilter` auto-bridge (plugin.ts:291-305) had
// zero coverage — which is how the gap shipped. This test closes that: it
// asserts on ROWS RETURNED to a real non-admin over HTTP, not on a filter object.
//
// Owner-scoped (`created_by`), not org-scoped, on purpose: a wildcard
// `organization_id` policy is STRIPPED when the enterprise `org-scoping` service
// is absent, which it is in this OSS workspace. An owner policy references
// `current_user.id` and survives single-tenant boots — so this gate actually
// bites on every CI run instead of silently passing.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import {
  rlsFixtureStack,
  ownerScopedMemberSet,
  rlsFixtureSecurity,
} from './fixtures/rls-owner-fixture.js';

const ADMIN_NOTES = 3;
const MEMBER_NOTES = 2;

/**
 * Date-bucketed dataset. The granularity is what makes this interesting:
 * `NativeSQLStrategy.canHandle` DECLINES any query carrying a
 * `dateGranularity` (native-sql-strategy.ts:30), so this routes to
 * ObjectQLStrategy — the leaking path — even on a SQL-capable driver.
 */
const notesByDay = {
  name: 'notes_by_day',
  label: 'Notes by day',
  object: 'rls_note',
  dimensions: [
    { name: 'created', label: 'Created', field: 'created_at', type: 'date', dateGranularity: 'day' },
  ],
  measures: [{ name: 'cnt', label: 'Count', aggregate: 'count' }],
};

/** Same object, NO granularity → stays on NativeSQLStrategy. The control. */
const notesTotal = {
  name: 'notes_total',
  label: 'Notes total',
  object: 'rls_note',
  dimensions: [],
  measures: [{ name: 'cnt', label: 'Count', aggregate: 'count' }],
};

describe('dogfood: analytics aggregates are RLS-scoped to the caller (#3597)', () => {
  let stack: VerifyStack;
  let adminToken: string;
  let memberToken: string;

  beforeAll(async () => {
    stack = await bootStack(rlsFixtureStack as never, {
      security: rlsFixtureSecurity(ownerScopedMemberSet),
    });

    // First user is the seeded dev admin; every later sign-up is a plain member
    // that falls back to the owner-scoped fixture permission set.
    adminToken = await stack.signIn();
    memberToken = await stack.signUp('analytics-rls@verify.test');

    // Author through HTTP as each principal so `created_by` is stamped with the
    // real caller — the whole point of an owner policy.
    for (let i = 0; i < ADMIN_NOTES; i++) {
      const r = await stack.apiAs(adminToken, 'POST', '/data/rls_note', {
        name: `admin-note-${i}`,
        body: 'owned by admin',
      });
      expect(r.status).toBeLessThan(300);
    }
    for (let i = 0; i < MEMBER_NOTES; i++) {
      const r = await stack.apiAs(memberToken, 'POST', '/data/rls_note', {
        name: `member-note-${i}`,
        body: 'owned by member',
      });
      expect(r.status).toBeLessThan(300);
    }

    // Premise check — if the owner policy is not actually biting on the plain
    // read path, an analytics assertion below would pass for the wrong reason.
    const list = await stack.apiAs(memberToken, 'GET', '/data/rls_note');
    const listed = (await list.json()) as { records?: Array<{ name: string }> };
    expect(listed.records ?? []).toHaveLength(MEMBER_NOTES);
    expect((listed.records ?? []).every((r) => r.name.startsWith('member-note'))).toBe(true);
  }, 90_000);

  afterAll(async () => {
    await stack?.stop();
  });

  async function totalFor(token: string, dataset: unknown, dimensions: string[]): Promise<number> {
    const res = await stack.apiAs(token, 'POST', '/analytics/dataset/query', {
      dataset,
      selection: { dimensions, measures: ['cnt'] },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows?: Array<Record<string, number>> };
    return (body.rows ?? []).reduce((sum, row) => sum + Number(row.cnt ?? 0), 0);
  }

  it('ObjectQL path (date-bucketed): a member counts ONLY their own rows', async () => {
    // Before #3601 this returned ADMIN_NOTES + MEMBER_NOTES — the member saw a
    // count over rows RLS forbids them from reading.
    const seen = await totalFor(memberToken, notesByDay, ['created']);
    expect(seen).toBe(MEMBER_NOTES);
  });

  it('NativeSQL path (no granularity): a member counts ONLY their own rows', async () => {
    const seen = await totalFor(memberToken, notesTotal, []);
    expect(seen).toBe(MEMBER_NOTES);
  });

  it('the two strategies agree for the same principal', async () => {
    const viaObjectql = await totalFor(memberToken, notesByDay, ['created']);
    const viaNativeSql = await totalFor(memberToken, notesTotal, []);
    expect(viaObjectql).toBe(viaNativeSql);
  });

  it('the rows the member cannot see DO exist — scoping, not an empty table', async () => {
    // Ground truth straight from the engine under a system context: the table
    // really holds every note. Without this, "member counts 2" would also pass
    // on a broken setup that simply never persisted the admin's rows.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ql = await stack.kernel.getServiceAsync<any>('objectql');
    const all = (await ql.find('rls_note', { context: { isSystem: true } })) as unknown[];
    expect(all).toHaveLength(ADMIN_NOTES + MEMBER_NOTES);

    const memberSees = await totalFor(memberToken, notesByDay, ['created']);
    expect(memberSees).toBe(MEMBER_NOTES);
    expect(memberSees).toBeLessThan(all.length);
  });
});
