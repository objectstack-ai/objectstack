// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20281 stage ③ — `JobSchema.pull` (ruling Q1-B) and `JobSchema.organization`
 * (ruling Q2-O1), the contract half.
 *
 * - `pull: { mapping }` is a third run form, closed, and exclusive with `body`
 *   and `handler` — writing it beside either is refused at parse, located at
 *   `pull`. `body` + `handler` stays legal (the body wins), so the rule is
 *   pinned for both pairs and the old pair is pinned unchanged.
 * - `defineStack` (and so `os validate`, whose config load runs it) refuses a
 *   `pull` naming a mapping the stack does not declare, or one with no
 *   `connectorSource`, with the cross-reference envelope.
 * - `organization` is the scheduled flow's value shape, reused: a non-empty
 *   `sys_organization.id`. Its POSTURE rule is judged at bind, never here —
 *   pinned by the binder's suite (`packages/runtime`), not this one.
 */

import { describe, expect, it } from 'vitest';

import { JobSchema, defineJob, type Job } from './job.zod';
import { ScheduleOrganizationSchema } from '../automation/schedule-organization.zod';
import { defineStack } from '../stack.zod';

const base = { name: 'orders_pull_hourly', schedule: { type: 'interval' as const, intervalMs: 60000 } };
const body = { language: 'js' as const, source: "await ctx.api.object('task').find({});", capabilities: ['api.read' as const] };
const pull = { mapping: 'orders_pull' };

const issueAt = (value: unknown, path: string) => {
  const r = JobSchema.safeParse(value);
  return r.success ? undefined : r.error.issues.find((i) => i.path.join('.') === path);
};

describe('JobSchema.pull — the declarative run form', () => {
  it('accepts a job whose only run form is `pull` — it satisfies "something to run"', () => {
    const r = JobSchema.safeParse({ ...base, pull });
    expect(r.success).toBe(true);
    expect(r.success && r.data.pull).toEqual(pull);
    expect(r.success && r.data.body).toBeUndefined();
    expect(r.success && r.data.handler).toBeUndefined();
  });

  it('refuses `pull` beside `body`, located at `pull`', () => {
    const issue = issueAt({ ...base, pull, body }, 'pull');
    expect(issue?.code).toBe('custom');
    expect(issue?.message).toContain('`pull`');
  });

  it('refuses `pull` beside `handler`, located at `pull`', () => {
    const issue = issueAt({ ...base, pull, handler: 'sweep' }, 'pull');
    expect(issue?.code).toBe('custom');
  });

  it('keeps `body` + `handler` legal — the exclusion is the pull\'s, not a new rule on the old pair', () => {
    expect(JobSchema.safeParse({ ...base, body, handler: 'sweep' }).success).toBe(true);
  });

  it('refuses a job with none of the three, located at `body`, naming all three keys', () => {
    const issue = issueAt(base, 'body');
    expect(issue?.code).toBe('custom');
    for (const key of ['`body`', '`pull`', '`handler`']) expect(issue?.message).toContain(key);
  });

  it('is closed: an unrecognized key inside `pull` is refused, not stripped', () => {
    const issue = issueAt({ ...base, pull: { ...pull, connector: 'orders_api' } }, 'pull');
    expect(issue?.code).toBe('unrecognized_keys');
  });

  it('requires `mapping`, as a snake_case mapping name', () => {
    expect(issueAt({ ...base, pull: {} }, 'pull.mapping')?.code).toBe('invalid_type');
    expect(issueAt({ ...base, pull: { mapping: 'OrdersPull' } }, 'pull.mapping')?.code).toBe('invalid_format');
  });

  it('a bare top-level `mapping` is refused and pointed at `pull`', () => {
    const r = JobSchema.safeParse({ ...base, mapping: 'orders_pull' });
    expect(r.success).toBe(false);
    const issue = r.error!.issues.find((i) => i.code === 'unrecognized_keys');
    expect(issue?.message).toContain('`pull`');
  });

  it('types `pull` on the authoring input', () => {
    const job: Job = { ...base, pull };
    expect(defineJob(job).pull?.mapping).toBe('orders_pull');
  });
});

describe('JobSchema.organization — the scheduled flow\'s value shape, reused', () => {
  it('accepts a non-empty organization id on every run form', () => {
    for (const form of [{ pull }, { body }, { handler: 'sweep' }]) {
      const r = JobSchema.safeParse({ ...base, ...form, organization: 'org_a' });
      expect(r.success).toBe(true);
      expect(r.success && r.data.organization).toBe('org_a');
    }
  });

  it('agrees with ScheduleOrganizationSchema on what counts as declared — one value shape, not a second', () => {
    for (const value of ['org_a', 'x', '', 7, null]) {
      const job = JobSchema.safeParse({ ...base, pull, organization: value });
      expect(job.success, JSON.stringify(value)).toBe(ScheduleOrganizationSchema.safeParse(value).success);
    }
  });

  it('is optional at parse — whether it is required is the deployment\'s posture, read at bind', () => {
    expect(JobSchema.safeParse({ ...base, pull }).success).toBe(true);
  });

  it('a near-miss spelling is refused at parse and pointed at `organization`', () => {
    // `organization_id` has no entry of its own: the alias probe folds case and `_`.
    for (const key of ['organizationId', 'organization_id', 'orgId', 'tenantId']) {
      const r = JobSchema.safeParse({ ...base, pull, [key]: 'org_a' });
      expect(r.success, key).toBe(false);
      const issue = r.error!.issues.find((i) => i.code === 'unrecognized_keys');
      expect(issue?.message, key).toContain('`organization`');
    }
  });
});

describe('defineStack refuses a job pull its stack cannot resolve — the cross-reference envelope', () => {
  const manifest = { id: 'com.example.jobpull', name: 'job-pull-test', version: '1.0.0', type: 'app' as const };
  const order = { name: 'order', label: 'Order', fields: { external_id: { type: 'text' as const } } };
  const mapping = {
    name: 'orders_pull',
    targetObject: 'order',
    fieldMapping: [{ source: 'id', target: 'external_id' }],
    mode: 'upsert' as const,
    upsertKey: ['external_id'],
    connectorSource: { connector: 'orders_api', action: 'request' },
  };
  type Envelope = Error & { code?: string; status?: number; issues?: readonly string[] };
  const refusal = (extra: Record<string, unknown>): Envelope | null => {
    try {
      defineStack({ manifest, objects: [order], ...extra } as unknown as Parameters<typeof defineStack>[0]);
      return null;
    } catch (e) {
      return e as Envelope;
    }
  };

  it('accepts a pull naming a declared mapping with a connectorSource (control)', () => {
    expect(refusal({ mappings: [mapping], jobs: [{ ...base, pull }] })).toBeNull();
  });

  it('refuses a pull naming a mapping the stack does not declare', () => {
    const refused = refusal({ mappings: [mapping], jobs: [{ ...base, pull: { mapping: 'orders_pul' } }] });
    expect(refused?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(refused?.status).toBe(422);
    expect(refused?.issues).toHaveLength(1);
    expect(refused?.issues?.[0]).toContain("'orders_pull_hourly'");
    expect(refused?.issues?.[0]).toContain("'orders_pul'");
  });

  it('refuses a pull naming a mapping with no connectorSource — there is nothing to pull', () => {
    const { connectorSource: _dropped, ...importOnly } = mapping;
    const refused = refusal({ mappings: [importOnly], jobs: [{ ...base, pull }] });
    expect(refused?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(refused?.issues).toHaveLength(1);
    expect(refused?.issues?.[0]).toContain('connectorSource');
  });

  it('judges the reference on a stack that declares no object — it resolves against mappings alone', () => {
    const refused = (() => {
      try {
        defineStack({ manifest, jobs: [{ ...base, pull }] } as unknown as Parameters<typeof defineStack>[0]);
        return null;
      } catch (e) {
        return e as Envelope;
      }
    })();
    expect(refused?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
  });

  it('judges a disabled job too — `enabled: false` turns a job off, it does not make a dangling name correct', () => {
    const refused = refusal({ mappings: [mapping], jobs: [{ ...base, enabled: false, pull: { mapping: 'gone' } }] });
    expect(refused?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
  });
});
