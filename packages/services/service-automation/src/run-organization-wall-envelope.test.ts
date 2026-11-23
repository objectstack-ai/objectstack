// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A `runAs: 'system'` run's data context carries what the organization wall
 * reads about the user it runs for (ADR-0095 D1, ADR-0123 D2): that user's
 * membership set and posture rung when the run context carries them, and — on
 * a segment a human decision switched to its decider — the user the run began
 * for, or that it began for no one. The wall itself is plugin-security's
 * (`app-automation-organization-wall.ts`); the real-stack half is
 * `packages/plugins/organizations/src/elevated-organization-wall*.wall.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { runCallerOf } from '@objectstack/core';
import type { AutomationContext } from '@objectstack/spec/contracts';

import { resolveRunDataContext } from './runtime-identity.js';

const system = (extra: Record<string, unknown>): AutomationContext =>
  ({ runAs: 'system', flowName: 'sweep', flowRunId: 'run_1', ...extra }) as unknown as AutomationContext;

describe('a system run carries what the organization wall reads about its caller', () => {
  it('the caller’s membership set and posture rung ride the run’s data context', () => {
    const ctx = resolveRunDataContext(
      system({ userId: 'u_alice', tenantId: 'org_a', accessible_org_ids: ['org_a', 'org_b'], posture: 'PLATFORM_ADMIN' }),
    ) as unknown as Record<string, unknown>;
    expect(ctx).toMatchObject({
      isSystem: true,
      userId: 'u_alice',
      tenantId: 'org_a',
      accessible_org_ids: ['org_a', 'org_b'],
      posture: 'PLATFORM_ADMIN',
      flowRunId: 'run_1',
    });
    // The run's own grants stay absent, as the hook seed rule has them.
    expect(ctx.permissions).toBeUndefined();
    expect(ctx.positions).toBeUndefined();
  });

  it('an empty membership set is carried as such: it is the answer the wall reads', () => {
    const ctx = resolveRunDataContext(system({ userId: 'u_alice', accessible_org_ids: [] })) as unknown as Record<string, unknown>;
    expect(ctx.accessible_org_ids).toEqual([]);
  });

  it('a run for no caller carries none of them', () => {
    const ctx = resolveRunDataContext(system({ accessible_org_ids: ['org_a'], posture: 'PLATFORM_ADMIN' })) as unknown as Record<string, unknown>;
    expect(ctx.accessible_org_ids).toBeUndefined();
    expect(ctx.posture).toBeUndefined();
  });

  it('a segment no decision switched carries no run-caller mark: its userId is the caller', () => {
    expect(runCallerOf(resolveRunDataContext(system({ userId: 'u_alice' })))).toBeUndefined();
    expect(runCallerOf(resolveRunDataContext(system({})))).toBeUndefined();
  });

  it('a decided segment of a run that began for no caller is marked as having none', () => {
    const ctx = resolveRunDataContext(system({ userId: 'u_decider', triggerUserId: null }));
    expect((ctx as unknown as Record<string, unknown>).userId).toBe('u_decider');
    expect(runCallerOf(ctx)).toBeNull();
  });

  it('a run that began for no caller though it names a user carries none of that user’s organization facts, and is marked as having no caller', () => {
    const ctx = resolveRunDataContext(
      system({ userId: 'u_writer', tenantId: 'org_x', accessible_org_ids: ['org_c'], posture: 'MEMBER', beganForNoCaller: true }),
    ) as unknown as Record<string, unknown>;
    expect(ctx).toMatchObject({ isSystem: true, userId: 'u_writer', tenantId: 'org_x' });
    expect(ctx.accessible_org_ids).toBeUndefined();
    expect(ctx.posture).toBeUndefined();
    expect(runCallerOf(ctx)).toBeNull();
    // …after a decision too, whoever decides.
    expect(runCallerOf(resolveRunDataContext(system({ userId: 'u_decider', triggerUserId: 'u_writer', beganForNoCaller: true })))).toBeNull();
  });

  it('a run whose user is not its caller carries none of that user’s organization facts', () => {
    for (const triggerUserId of [null, 'u_alice']) {
      const ctx = resolveRunDataContext(
        system({ userId: 'u_decider', triggerUserId, accessible_org_ids: ['org_c'], posture: 'MEMBER' }),
      ) as unknown as Record<string, unknown>;
      expect(ctx.accessible_org_ids).toBeUndefined();
      expect(ctx.posture).toBeUndefined();
    }
  });

  it('a decided segment of a run that began for a caller names that caller, not the decider', () => {
    const ctx = resolveRunDataContext(system({ userId: 'u_decider', triggerUserId: 'u_alice' }));
    expect((ctx as unknown as Record<string, unknown>).userId).toBe('u_decider');
    expect(runCallerOf(ctx)).toBe('u_alice');
  });
});
