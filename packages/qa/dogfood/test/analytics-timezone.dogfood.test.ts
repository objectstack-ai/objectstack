// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// GOLDEN REGRESSION for #1982 / #2018 — "organization timezone drives analytics
// date bucketing", exercised end-to-end through the real HTTP + service stack.
//
// @proof: analytics-tz-bucketing
// ADR-0054 runtime proof for the analytics high-risk class. Registered in
// proof-registry.mts but NOT yet ledger-bound: the authorable surface
// (dataset/report dimensions+measures) is not a GOVERNED liveness type yet, so
// there is no entry to carry the proof. Binds once dataset/report are governed.
//
// This is the test that would have caught #2018 before merge. That bug passed
// every static gate: it lived in the *integration* of NativeSQLStrategy routing
// + in-memory count + REST execution-context resolution. Only booting the app
// and comparing UTC vs non-UTC buckets surfaces it.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crmStack from '@objectstack/example-crm';
import { bootStack, type VerifyStack } from '@objectstack/verify';

// 03:00 UTC on 2024-03-01 is still 2024-02-29 (19:00) in America/Los_Angeles
// (PST = UTC-8, before DST). So a *day* bucket labels this instant 2024-03-01
// under UTC but 2024-02-29 under LA — the exact boundary behavior #2018 fixed.
const BOUNDARY = '2024-03-01T03:00:00.000Z';
const N_LEADS = 3;

const leadByDay = {
  name: 'lead_by_day',
  label: 'Leads by day',
  object: 'crm_lead',
  dimensions: [
    { name: 'created', label: 'Created', field: 'created_at', type: 'date', dateGranularity: 'day' },
  ],
  measures: [{ name: 'cnt', label: 'Count', aggregate: 'count' }],
};

describe('dogfood: org timezone drives analytics date bucketing (#1982/#2018)', () => {
  let stack: VerifyStack;
  let token: string;

  beforeAll(async () => {
    stack = await bootStack(crmStack);

    // Deterministic fixture: N leads pinned to the tz-boundary instant, inserted
    // as system so the write path's defaults/validation don't fight the setup.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ql = await stack.kernel.getServiceAsync<any>('objectql');
    for (let i = 0; i < N_LEADS; i++) {
      await ql.insert(
        'crm_lead',
        { name: `tz-lead-${i}`, status: 'new', created_at: BOUNDARY },
        { context: { isSystem: true } },
      );
    }
    // Sanity: confirm created_at actually persisted as the boundary instant
    // (if a stamp hook overrode it the whole premise is void — fail loudly).
    const mine = (await ql.find('crm_lead', {
      where: { name: { $in: ['tz-lead-0', 'tz-lead-1', 'tz-lead-2'] } },
      context: { isSystem: true },
    })) as Array<Record<string, unknown>>;
    expect(mine).toHaveLength(N_LEADS);
    for (const r of mine) {
      expect(new Date(r.created_at as string).toISOString()).toBe(BOUNDARY);
    }

    token = await stack.signIn();
  }, 60_000);

  afterAll(async () => {
    await stack?.stop();
  });

  // Set the org-wide timezone via the real settings route (NO explicit per-query
  // tz), then bucket — exercising settings → REST exec-context → analytics.
  async function bucketsForOrgTz(tz: string): Promise<Record<string, number>> {
    const put = await stack.raw('/api/settings/localization', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ timezone: tz }),
    });
    expect(put.status).toBe(200);

    const res = await stack.apiAs(token, 'POST', '/analytics/dataset/query', {
      dataset: leadByDay,
      selection: { dimensions: ['created'], measures: ['cnt'] },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows?: Array<{ created: string; cnt: number }> };
    const out: Record<string, number> = {};
    for (const row of body.rows ?? []) out[row.created] = row.cnt;
    return out;
  }

  it('buckets the boundary instant on the UTC calendar day with the correct count', async () => {
    const utc = await bucketsForOrgTz('UTC');
    // The 3 boundary leads land on 2024-03-01; cnt must be 3 (not 0 — the
    // count-all `*` in-memory bug), and not split across raw timestamps.
    expect(utc['2024-03-01']).toBe(N_LEADS);
    expect(utc['2024-02-29']).toBeUndefined();
  });

  it('shifts the bucket to the previous day under America/Los_Angeles', async () => {
    const la = await bucketsForOrgTz('America/Los_Angeles');
    // The regression: before #2018 this stayed on 2024-03-01 (tz dropped) or
    // returned cnt 0. The org timezone must move it to 2024-02-29.
    expect(la['2024-02-29']).toBe(N_LEADS);
    expect(la['2024-03-01']).toBeUndefined();
  });
});
