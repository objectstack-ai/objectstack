// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An app-authored elevation sees through the organization wall what its
 * caller's plain door sees — the module's own pins. The real-stack half (an
 * action body, a system hook and a system flow on a walled boot) is
 * `packages/plugins/organizations/src/elevated-organization-wall.wall.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { markAppAutomationElevation } from '@objectstack/core';
import type { TenantLayer0Verdict } from '@objectstack/spec/security';

import {
  appAutomationWallCaller,
  applyAppAutomationOrganizationWall,
  callerMayLackOrganization,
  type CallerLayer0,
} from './app-automation-organization-wall.js';
import { RLS_DENY_FILTER } from './rls-compiler.js';

const DENY: TenantLayer0Verdict = { kind: 'deny' };
const ORG_A: TenantLayer0Verdict = { kind: 'organization', organizationId: 'org_a' };

const callerLayer0 = (verdict: TenantLayer0Verdict) =>
  vi.fn<CallerLayer0>(async () => ({ layer0: verdict.kind === 'deny' ? RLS_DENY_FILTER : null, tenantLayer0Verdict: verdict }));

const actionBody = (extra: Record<string, unknown> = {}) =>
  markAppAutomationElevation({ isSystem: true, userId: 'u_alice', accessible_org_ids: ['org_a'], ...extra }, 'action');
const systemHook = (extra: Record<string, unknown> = {}) =>
  markAppAutomationElevation({ isSystem: true, userId: 'u_alice', accessible_org_ids: ['org_a'], ...extra }, 'hook');
const systemFlow = (extra: Record<string, unknown> = {}) => ({
  isSystem: true,
  userId: 'u_alice',
  flowRunId: 'run_1',
  accessible_org_ids: ['org_a'],
  ...extra,
});

const refusalOf = async (run: () => Promise<unknown>): Promise<{ code?: string; status?: number; message?: string }> => {
  try {
    await run();
  } catch (e) {
    return e as { code?: string; status?: number; message?: string };
  }
  throw new Error('expected a refusal');
};

describe('an app-authored elevation sees through the organization wall what its caller sees', () => {
  for (const [kind, context] of [
    ['an action body', actionBody],
    ['a system hook', systemHook],
    ['a system flow', systemFlow],
  ] as const) {
    describe(kind, () => {
      it('with no active organization, a read resolves to nothing: the deny sentinel is AND-composed onto its predicate', async () => {
        const where = { status: 'open' };
        const opCtx: any = { object: 'task', operation: 'find', context: context(), ast: { object: 'task', where } };
        await applyAppAutomationOrganizationWall(opCtx, callerLayer0(DENY));
        expect(opCtx.ast.where).toEqual({ $and: [where, RLS_DENY_FILTER] });
        expect(opCtx.ast.where.$and[1]).toBe(RLS_DENY_FILTER);
        expect(opCtx.tenantLayer0Verdict).toEqual(DENY);
      });

      it('with no active organization, a read with no predicate takes the sentinel as its predicate', async () => {
        for (const operation of ['findOne', 'count', 'aggregate']) {
          const opCtx: any = { object: 'task', operation, context: context(), ast: { object: 'task' } };
          await applyAppAutomationOrganizationWall(opCtx, callerLayer0(DENY));
          expect(opCtx.ast.where).toBe(RLS_DENY_FILTER);
        }
      });

      it('with no active organization, every write is refused 403 PERMISSION_DENIED naming the missing active organization', async () => {
        for (const operation of ['insert', 'update', 'delete', 'purge', 'restore']) {
          const opCtx: any = { object: 'task', operation, context: context(), data: { name: 'x' } };
          const e = await refusalOf(() => applyAppAutomationOrganizationWall(opCtx, callerLayer0(DENY)));
          expect(e.code).toBe('PERMISSION_DENIED');
          expect(e.status).toBe(403);
          expect(e.message).toContain('has no active organization');
        }
      });

      it('control: a caller with an active organization is not asked anything, and its operation is left as it came', async () => {
        const probe = callerLayer0(ORG_A);
        const opCtx: any = { object: 'task', operation: 'find', context: context({ tenantId: 'org_a' }), ast: { object: 'task', where: { a: 1 } } };
        await applyAppAutomationOrganizationWall(opCtx, probe);
        expect(probe).not.toHaveBeenCalled();
        expect(opCtx.ast.where).toEqual({ a: 1 });
        const write: any = { object: 'task', operation: 'update', context: context({ tenantId: 'org_a' }) };
        await expect(applyAppAutomationOrganizationWall(write, probe)).resolves.toBeUndefined();
      });

      it("control: where the caller's own wall admits the operation (an object outside tenancy, a crossing operator), nothing changes", async () => {
        const opCtx: any = { object: 'catalog', operation: 'find', context: context(), ast: { object: 'catalog', where: { a: 1 } } };
        await applyAppAutomationOrganizationWall(opCtx, callerLayer0({ kind: 'none' }));
        expect(opCtx.ast.where).toEqual({ a: 1 });
        const write: any = { object: 'catalog', operation: 'insert', context: context() };
        await expect(applyAppAutomationOrganizationWall(write, callerLayer0({ kind: 'none' }))).resolves.toBeUndefined();
      });
    });
  }

  it("the caller's wall is computed over the caller's own context: the elevation's isSystem is off, everything else kept", async () => {
    const probe = callerLayer0(DENY);
    const opCtx: any = { object: 'task', operation: 'find', context: actionBody({ positions: ['member'] }), ast: { object: 'task' } };
    await applyAppAutomationOrganizationWall(opCtx, probe);
    const [callerContext, object, operation] = probe.mock.calls[0];
    expect(callerContext).toMatchObject({ isSystem: false, userId: 'u_alice', positions: ['member'], accessible_org_ids: ['org_a'] });
    expect([object, operation]).toEqual(['task', 'find']);
    expect(opCtx.context.isSystem).toBe(true);
  });

  it('a membership set that is empty can be denied even beside an active organization; the refusal names the membership', async () => {
    expect(callerMayLackOrganization({ tenantId: 'org_a', accessible_org_ids: [] })).toBe(true);
    expect(callerMayLackOrganization({ tenantId: 'org_a', accessible_org_ids: ['org_a'] })).toBe(false);
    expect(callerMayLackOrganization({ tenantId: 'org_a' })).toBe(false);
    const e = await refusalOf(() =>
      applyAppAutomationOrganizationWall(
        { object: 'task', operation: 'insert', context: actionBody({ tenantId: 'org_a', accessible_org_ids: [] }) },
        callerLayer0(DENY),
      ),
    );
    expect([e.code, e.status]).toEqual(['PERMISSION_DENIED', 403]);
    expect(e.message).toContain('holds no current membership in any organization');
  });

  describe('which contexts the rule reads', () => {
    it('platform system work that runs for no caller, or carries neither a run nor the mark, is unchanged', async () => {
      const probe = callerLayer0(DENY);
      for (const context of [
        { isSystem: true },
        { isSystem: true, userId: 'u_alice' },
        { isSystem: true, flowRunId: 'run_sched', actor: 'svc:flow:sweep' },
        markAppAutomationElevation({ isSystem: true }, 'hook'),
      ]) {
        expect(appAutomationWallCaller(context)).toBeUndefined();
        const opCtx: any = { object: 'task', operation: 'update', context, ast: { object: 'task' } };
        await expect(applyAppAutomationOrganizationWall(opCtx, probe)).resolves.toBeUndefined();
        expect(opCtx.ast.where).toBeUndefined();
      }
      expect(probe).not.toHaveBeenCalled();
    });

    it("a user's own context is not an elevation and is the plain door's to judge", () => {
      expect(appAutomationWallCaller({ userId: 'u_alice', flowRunId: 'run_user' })).toBeUndefined();
      expect(appAutomationWallCaller(markAppAutomationElevation({ userId: 'u_alice' }, 'action'))).toBeUndefined();
    });

    it("the guest entry's envelope is a caller", () => {
      expect(appAutomationWallCaller(markAppAutomationElevation({ isSystem: true, principalKind: 'guest' }, 'action'))?.source).toBe('action');
    });

    it('each elevation is named by its source', () => {
      expect(appAutomationWallCaller(actionBody())?.source).toBe('action');
      expect(appAutomationWallCaller(systemHook())?.source).toBe('hook');
      expect(appAutomationWallCaller(systemFlow())?.source).toBe('flow');
    });
  });
});
