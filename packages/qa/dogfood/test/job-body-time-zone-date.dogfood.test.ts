// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#28898] A job `body` does time-zone date maths, end to end through the real
// stack: the declared job → the binder (`scheduleAppArtifactJobs`) → the job
// service → the QuickJS job body → `ctx.api` writes → the REST read a client
// makes.
//
// The reported job (duly#147) computes each duty's current period in that
// duty's own IANA zone, which needs `Intl.DateTimeFormat` with `timeZone`. The
// sandbox had no `Intl`, so the body threw `ReferenceError: 'Intl' is not
// defined` and the job could not leave the deprecated `handler`. This body
// writes, per zone, the calendar date of one fixed instant that falls on
// different days in the two zones, and the REST read must show both dates.
//
// The expected dates are computed with the host's `Intl` here, never written as
// literals: the claim is "the sandbox answers what the server answers".
//
// The composition pins (the whole DateTimeFormat API, errors, isolation, the
// hook and action faces) live in
// `packages/runtime/src/sandbox/sandbox-intl.test.ts`; this file is the one
// place the job runs on a booted stack.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { SCHEDULED_WORK_ENV } from '@objectstack/types';

const JOB = 'tzj_period_stamp';
const ZONES = ['America/New_York', 'Asia/Shanghai'];
// 2026-03-08T20:00Z: still the 8th in New York, already the 9th in Shanghai.
const INSTANT = Date.UTC(2026, 2, 8, 20);

const tzjStack = defineStack({
  manifest: {
    id: 'com.dogfood.job-body-time-zone-date',
    namespace: 'tzj',
    version: '0.0.0',
    type: 'app',
    name: 'Job Body Time-Zone Date Fixture',
    description: 'A job body that writes the calendar date of one instant in two IANA zones.',
  },
  objects: [
    ObjectSchema.create({
      name: 'tzj_period',
      label: 'Period',
      fields: {
        zone: Field.text({ label: 'Zone', required: true }),
        day: Field.text({ label: 'Day' }),
      },
    }),
  ],
  jobs: [
    {
      name: JOB,
      label: 'Stamp each zone\'s period',
      // An hour apart: the test fires the run itself, so no tick lands mid-test.
      schedule: { type: 'interval', intervalMs: 3_600_000 },
      body: {
        language: 'js',
        capabilities: ['api.write'],
        source: `
          const zones = ${JSON.stringify(ZONES)};
          for (const tz of zones) {
            const parts = {};
            for (const p of new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(${INSTANT})) parts[p.type] = p.value;
            await ctx.api.object('tzj_period').insert({ zone: tz, day: parts.year + '-' + parts.month + '-' + parts.day });
          }
          return { outcome: 'completed', reason: 'stamped ' + zones.length + ' zones' };
        `,
      },
    },
  ],
} as any);

function hostDay(tz: string): string {
  const parts: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(INSTANT)) {
    parts[p.type] = p.value;
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
}

describe('objectstack verify: a job body computes a calendar date in a named IANA zone (#28898)', () => {
  let stack: VerifyStack;
  let token: string;
  let priorSwitch: string | undefined;

  beforeAll(async () => {
    // [#17396] Package-authored jobs are scheduled only where the deployment
    // runs package scheduled work, OFF by default.
    priorSwitch = process.env[SCHEDULED_WORK_ENV];
    process.env[SCHEDULED_WORK_ENV] = 'true';
    stack = await bootStack(tzjStack);
    token = await stack.signIn();
  }, 60_000);

  afterAll(async () => {
    await stack?.stop();
    if (priorSwitch === undefined) delete process.env[SCHEDULED_WORK_ENV];
    else process.env[SCHEDULED_WORK_ENV] = priorSwitch;
  });

  it('the run writes each zone\'s own date, and REST reads both back', async () => {
    const jobs = stack.kernel.getService('job') as { listJobs?(): Promise<string[]>; trigger(name: string): Promise<void> };
    // Positive fact first: the body bound and was scheduled, so a green read
    // below cannot come from a job that never ran.
    if (jobs.listJobs) expect(await jobs.listJobs()).toContain(JOB);
    await jobs.trigger(JOB);

    // Anti-vacuity: the instant really is on different days in the two zones.
    const expected = Object.fromEntries(ZONES.map((tz) => [tz, hostDay(tz)]));
    expect(new Set(Object.values(expected)).size).toBe(2);

    let rows: Array<{ zone: string; day: string }> = [];
    for (let i = 0; i < 50 && rows.length < ZONES.length; i++) {
      const r = await stack.apiAs(token, 'GET', '/data/tzj_period');
      const body = (await r.json()) as any;
      expect(r.status, JSON.stringify(body)).toBe(200);
      rows = (body.data ?? body.records ?? body.value ?? []) as Array<{ zone: string; day: string }>;
      if (rows.length < ZONES.length) await new Promise((res) => setTimeout(res, 100));
    }
    expect(Object.fromEntries(rows.map((r) => [r.zone, r.day]))).toEqual(expected);
  }, 30_000);
});
