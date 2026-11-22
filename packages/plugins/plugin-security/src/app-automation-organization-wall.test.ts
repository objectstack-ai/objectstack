// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An app-authored elevation is bounded by its caller's organization wall —
 * the module's own pins. The real-stack half (an
 * action body, a system hook and a system flow, under `isolated`, `group` and
 * `single`, on a local and on a federated object) is
 * `packages/plugins/organizations/src/elevated-organization-wall*.wall.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { markAppAutomationElevation, markFlowWriteReferenceCheck, markRunCaller } from '@objectstack/core';
import type { TenantLayer0Verdict } from '@objectstack/spec/security';

import {
  appAutomationWallCaller,
  applyAppAutomationOrganizationWall,
  callerMayLackOrganization,
  carriesDoorFacts,
  RunCallerFactsMemo,
  type AppAutomationWallDeps,
  type CallerLayer0Answer,
} from './app-automation-organization-wall.js';
import { RLS_DENY_FILTER } from './rls-compiler.js';

const DENY: TenantLayer0Verdict = { kind: 'deny' };
const ORG_A: TenantLayer0Verdict = { kind: 'organization', organizationId: 'org_a' };
const UNION: TenantLayer0Verdict = { kind: 'organizations', organizationIds: ['org_a', 'org_b'] };
const NONE: TenantLayer0Verdict = { kind: 'none' };

const filterOf = (v: TenantLayer0Verdict): Record<string, unknown> | null =>
  v.kind === 'deny'
    ? RLS_DENY_FILTER
    : v.kind === 'organization'
      ? { organization_id: v.organizationId }
      : v.kind === 'organizations'
        ? { organization_id: { $in: v.organizationIds } }
        : null;

/** Deps whose verdict is `verdict`; every seam recorded. */
function depsFor(
  verdict: TenantLayer0Verdict,
  over: Partial<AppAutomationWallDeps> & { crossed?: boolean; inScope?: boolean } = {},
) {
  const answer: CallerLayer0Answer = { layer0: filterOf(verdict), tenantLayer0Verdict: verdict, crossedByPlatformAdmin: over.crossed ?? false };
  const deps = {
    isFederated: vi.fn((_object: string) => false),
    completeCaller: vi.fn(async (c: Record<string, unknown>) => ({ ...c, permissions: [], accessible_org_ids: ['org_a'] })),
    callerLayer0: vi.fn(async () => answer),
    rowInScope: vi.fn(async () => over.inScope ?? true),
    notFound: vi.fn((object: string, id: unknown) => Object.assign(new Error(`not found ${object} ${String(id)}`), { code: 'RECORD_NOT_FOUND', status: 404 })),
    ...over,
  };
  return deps as typeof deps & AppAutomationWallDeps;
}

// The request's envelope an action body and a hook spread (the caller's door facts carried).
const DOOR = { userId: 'u_alice', positions: ['member'], permissions: [], accessible_org_ids: ['org_a'] };
const actionBody = (extra: Record<string, unknown> = {}) => markAppAutomationElevation({ isSystem: true, ...DOOR, ...extra }, 'action');
const systemHook = (extra: Record<string, unknown> = {}) => markAppAutomationElevation({ isSystem: true, ...DOOR, ...extra }, 'hook');
// The envelope a `runAs: 'system'` run's data nodes really carry (`resolveRunDataContext`'s
// system arm, service-automation): no positions or permission sets, the caller's membership
// set and rung only when the run context carried them, the reference-check mark.
const systemFlow = (extra: Record<string, unknown> = {}) =>
  markFlowWriteReferenceCheck({
    isSystem: true,
    actor: 'svc:flow:sweep',
    userId: 'u_alice',
    accessible_org_ids: ['org_a'],
    flowRunId: 'run_1',
    ...extra,
  } as Record<string, unknown>);

const refusalOf = async (run: () => Promise<unknown>): Promise<{ code?: string; status?: number; message?: string }> => {
  try {
    await run();
  } catch (e) {
    return e as { code?: string; status?: number; message?: string };
  }
  throw new Error('expected a refusal');
};

describe('an app-authored elevation is bounded by its caller’s organization wall', () => {
  for (const [kind, context] of [
    ['an action body', actionBody],
    ['a system hook', systemHook],
    ['a system flow', systemFlow],
  ] as const) {
    describe(kind, () => {
      it('with no active organization, a read takes the deny sentinel, by reference, and records the verdict', async () => {
        const where = { status: 'open' };
        const opCtx: any = { object: 'task', operation: 'find', context: context(), ast: { object: 'task', where } };
        await applyAppAutomationOrganizationWall(opCtx, depsFor(DENY));
        expect(opCtx.ast.where).toEqual({ $and: [where, RLS_DENY_FILTER] });
        expect(opCtx.ast.where.$and[1]).toBe(RLS_DENY_FILTER);
        expect(opCtx.tenantLayer0Verdict).toEqual(DENY);
        for (const operation of ['findOne', 'count', 'aggregate']) {
          const bare: any = { object: 'task', operation, context: context(), ast: { object: 'task' } };
          await applyAppAutomationOrganizationWall(bare, depsFor(DENY));
          expect(bare.ast.where).toBe(RLS_DENY_FILTER);
        }
      });

      it('with no active organization, every write but a removal is refused 403 PERMISSION_DENIED naming the missing active organization', async () => {
        for (const operation of ['insert', 'update', 'transfer', 'restore']) {
          const opCtx: any = { object: 'task', operation, context: context(), data: { name: 'x' } };
          const e = await refusalOf(() => applyAppAutomationOrganizationWall(opCtx, depsFor(DENY)));
          expect([e.code, e.status]).toEqual(['PERMISSION_DENIED', 403]);
          expect(e.message).toContain('has no active organization');
        }
      });

      it('with no active organization, a predicate delete or purge matches nothing: the read rule, not a refusal', async () => {
        for (const operation of ['delete', 'purge']) {
          const opCtx: any = { object: 'task', operation, context: context(), ast: { object: 'task', where: { status: 'done' } } };
          await applyAppAutomationOrganizationWall(opCtx, depsFor(DENY));
          expect(opCtx.ast.where).toEqual({ $and: [{ status: 'done' }, RLS_DENY_FILTER] });
          expect(opCtx.ast.where.$and[1]).toBe(RLS_DENY_FILTER);
          expect(opCtx.tenantLayer0Verdict).toEqual(DENY);
        }
      });

      it('with no active organization, a by-id delete or purge answers as a row that is not there', async () => {
        for (const operation of ['delete', 'purge']) {
          const deps = depsFor(DENY);
          const e = await refusalOf(() =>
            applyAppAutomationOrganizationWall({ object: 'task', operation, context: context(), options: { where: { id: 't_9' } } }, deps),
          );
          expect([e.code, e.status]).toEqual(['RECORD_NOT_FOUND', 404]);
          expect(deps.rowInScope).not.toHaveBeenCalled();
        }
      });

      it('control: a caller with an active organization and its membership set is not asked anything', async () => {
        const deps = depsFor(ORG_A);
        const opCtx: any = { object: 'task', operation: 'find', context: context({ tenantId: 'org_a' }), ast: { object: 'task', where: { a: 1 } } };
        await applyAppAutomationOrganizationWall(opCtx, deps);
        expect(deps.callerLayer0).not.toHaveBeenCalled();
        expect(deps.completeCaller).not.toHaveBeenCalled();
        expect(opCtx.ast.where).toEqual({ a: 1 });
      });

      it("control: where the caller's wall contributes nothing (an object outside tenancy), the read is left as it came", async () => {
        const opCtx: any = { object: 'catalog', operation: 'find', context: context(), ast: { object: 'catalog', where: { a: 1 } } };
        await applyAppAutomationOrganizationWall(opCtx, depsFor(NONE));
        expect(opCtx.ast.where).toEqual({ a: 1 });
        await expect(
          applyAppAutomationOrganizationWall({ object: 'catalog', operation: 'insert', context: context() }, depsFor(NONE)),
        ).resolves.toBeUndefined();
      });
    });
  }

  describe('the caller’s wall is applied whole, not only its denial', () => {
    it('a group member with no active organization reads the union: the filter and the verdict are the wall’s', async () => {
      const opCtx: any = { object: 'task', operation: 'find', context: systemFlow({ accessible_org_ids: ['org_a', 'org_b'] }), ast: { object: 'task' } };
      await applyAppAutomationOrganizationWall(opCtx, depsFor(UNION));
      expect(opCtx.ast.where).toEqual({ organization_id: { $in: ['org_a', 'org_b'] } });
      expect(opCtx.tenantLayer0Verdict).toEqual(UNION);
    });

    it('a predicate write matches only rows the wall admits', async () => {
      const opCtx: any = { object: 'task', operation: 'update', context: actionBody(), ast: { object: 'task', where: { status: 'open' } }, data: { status: 'x' } };
      await applyAppAutomationOrganizationWall(opCtx, depsFor(UNION));
      expect(opCtx.ast.where).toEqual({ $and: [{ status: 'open' }, { organization_id: { $in: ['org_a', 'org_b'] } }] });
    });

    it('a by-id write of a row the wall does not admit answers as a row that is not there', async () => {
      const deps = depsFor(UNION, { inScope: false });
      const e = await refusalOf(() =>
        applyAppAutomationOrganizationWall({ object: 'task', operation: 'update', context: actionBody(), data: { id: 't_9', status: 'x' } }, deps),
      );
      expect([e.code, e.status]).toEqual(['RECORD_NOT_FOUND', 404]);
      expect(deps.rowInScope).toHaveBeenCalledWith('task', 't_9', { organization_id: { $in: ['org_a', 'org_b'] } }, expect.anything());
    });

    it('control: a by-id write of a row the wall admits passes on', async () => {
      await expect(
        applyAppAutomationOrganizationWall(
          { object: 'task', operation: 'update', context: actionBody(), data: { id: 't_1', status: 'x' } },
          depsFor(UNION, { inScope: true }),
        ),
      ).resolves.toBeUndefined();
    });

    it('a write never names an organization the wall does not admit', async () => {
      const e = await refusalOf(() =>
        applyAppAutomationOrganizationWall(
          { object: 'task', operation: 'update', context: actionBody(), data: { id: 't_1', organization_id: 'org_z' } },
          depsFor(UNION),
        ),
      );
      expect([e.code, e.status]).toEqual(['PERMISSION_DENIED', 403]);
    });

    it('an insert with no active organization has nowhere to land on a walled tenant object, a crossing operator’s included', async () => {
      for (const deps of [depsFor(UNION), depsFor(NONE, { crossed: true })]) {
        const e = await refusalOf(() =>
          applyAppAutomationOrganizationWall({ object: 'task', operation: 'insert', context: actionBody(), data: { name: 'x' } }, deps),
        );
        expect([e.code, e.status]).toEqual(['PERMISSION_DENIED', 403]);
      }
    });
  });

  describe('a federated object, where the engine projects no driver scope', () => {
    it('is judged for a caller with an active organization: its read takes the caller’s filter', async () => {
      const deps = depsFor(ORG_A, { isFederated: vi.fn(() => true) });
      const opCtx: any = { object: 'remote', operation: 'find', context: actionBody({ tenantId: 'org_a' }), ast: { object: 'remote' } };
      await applyAppAutomationOrganizationWall(opCtx, deps);
      expect(opCtx.ast.where).toEqual({ organization_id: 'org_a' });
      expect(deps.callerLayer0).toHaveBeenCalledOnce();
    });

    it('its by-id write is checked against the row it names', async () => {
      const deps = depsFor(ORG_A, { isFederated: vi.fn(() => true), inScope: false });
      const e = await refusalOf(() =>
        applyAppAutomationOrganizationWall({ object: 'remote', operation: 'update', context: systemHook({ tenantId: 'org_a' }), data: { id: 'r_b1', touched: 'x' } }, deps),
      );
      expect([e.code, e.status]).toEqual(['RECORD_NOT_FOUND', 404]);
    });

    it('an undeclared organization scope is refused on write and read empty, whatever the caller’s organization', async () => {
      const deps = depsFor(DENY, { isFederated: vi.fn(() => true) });
      const read: any = { object: 'remote', operation: 'find', context: actionBody({ tenantId: 'org_a' }), ast: { object: 'remote' } };
      await applyAppAutomationOrganizationWall(read, deps);
      expect(read.ast.where).toBe(RLS_DENY_FILTER);
      const e = await refusalOf(() =>
        applyAppAutomationOrganizationWall({ object: 'remote', operation: 'update', context: actionBody({ tenantId: 'org_a' }), data: { id: 'r_1' } }, deps),
      );
      expect([e.code, e.status]).toEqual(['PERMISSION_DENIED', 403]);
      const removal = await refusalOf(() =>
        applyAppAutomationOrganizationWall({ object: 'remote', operation: 'delete', context: actionBody({ tenantId: 'org_a' }), data: { id: 'r_1' } }, deps),
      );
      expect([removal.code, removal.status]).toEqual(['RECORD_NOT_FOUND', 404]);
    });

    it('a deny verdict handed without its projection still walls a removal: the deny sentinel, never no wall', async () => {
      const deps = depsFor(DENY, { callerLayer0: vi.fn(async () => ({ layer0: null, tenantLayer0Verdict: DENY })) });
      const opCtx: any = { object: 'task', operation: 'delete', context: actionBody(), ast: { object: 'task' } };
      await applyAppAutomationOrganizationWall(opCtx, deps);
      expect(opCtx.ast.where).toBe(RLS_DENY_FILTER);
    });
  });

  describe('the door’s facts', () => {
    it('a context without the caller’s permission sets has them resolved before the wall is asked', async () => {
      const deps = depsFor(UNION);
      await applyAppAutomationOrganizationWall({ object: 'task', operation: 'find', context: systemFlow(), ast: { object: 'task' } } as any, deps);
      expect(deps.completeCaller).toHaveBeenCalledOnce();
      const [completed] = vi.mocked(deps.callerLayer0).mock.calls[0] as unknown as [Record<string, unknown>];
      expect(completed).toMatchObject({ isSystem: false, userId: 'u_alice', permissions: [] });
    });

    it('a context that carries them is used as it is', async () => {
      const deps = depsFor(DENY);
      await applyAppAutomationOrganizationWall({ object: 'task', operation: 'find', context: actionBody(), ast: { object: 'task' } } as any, deps);
      expect(deps.completeCaller).not.toHaveBeenCalled();
    });

    it('may-lack: no active organization, an absent or empty membership set, and a platform operator are all asked', () => {
      expect(callerMayLackOrganization({ accessible_org_ids: ['org_a'] })).toBe(true);
      expect(callerMayLackOrganization({ tenantId: 'org_a' })).toBe(true);
      expect(callerMayLackOrganization({ tenantId: 'org_a', accessible_org_ids: [] })).toBe(true);
      expect(callerMayLackOrganization({ tenantId: 'org_a', accessible_org_ids: ['org_a'], posture: 'PLATFORM_ADMIN' })).toBe(true);
      expect(callerMayLackOrganization({ tenantId: 'org_a', accessible_org_ids: ['org_a'] })).toBe(false);
    });

    it('the refusal names the missing membership for a person outside every organization, and the guest entry as such', async () => {
      const outsider = await refusalOf(() =>
        applyAppAutomationOrganizationWall(
          { object: 'task', operation: 'insert', context: actionBody({ tenantId: 'org_a', accessible_org_ids: [] }) },
          depsFor(DENY),
        ),
      );
      expect(outsider.message).toContain('holds no current membership in any organization');
      const guest = await refusalOf(() =>
        applyAppAutomationOrganizationWall(
          { object: 'task', operation: 'update', context: markAppAutomationElevation({ isSystem: true, principalKind: 'guest', permissions: [], accessible_org_ids: [] }, 'action'), data: { id: 't' } },
          depsFor(DENY),
        ),
      );
      expect(guest.message).toContain('the guest entry');
      expect(guest.message).not.toContain('Join or select');
    });
  });

  describe('a write that names or empties the organization, for every judged caller', () => {
    // A member with an active organization and its membership set: the
    // engine's projection already scopes its reads, so only its payload is asked.
    const member = () => actionBody({ tenantId: 'org_a' });

    it('an insert naming another organization is refused 403, though the caller has an active organization', async () => {
      const deps = depsFor(ORG_A);
      const e = await refusalOf(() =>
        applyAppAutomationOrganizationWall({ object: 'task', operation: 'insert', context: member(), data: { name: 'x', organization_id: 'org_b' } }, deps),
      );
      expect([e.code, e.status]).toEqual(['PERMISSION_DENIED', 403]);
      expect(deps.callerLayer0).toHaveBeenCalledOnce();
    });

    it('an update moving a row into another organization, or into none, is refused 403', async () => {
      for (const organization_id of ['org_b', null, '']) {
        const e = await refusalOf(() =>
          applyAppAutomationOrganizationWall(
            { object: 'task', operation: 'update', context: member(), data: { id: 't_1', organization_id } },
            depsFor(ORG_A),
          ),
        );
        expect([e.code, e.status]).toEqual(['PERMISSION_DENIED', 403]);
      }
    });

    it('control: a write naming the caller’s own organization passes, and one naming none asks nothing', async () => {
      await expect(
        applyAppAutomationOrganizationWall(
          { object: 'task', operation: 'insert', context: member(), data: { name: 'x', organization_id: 'org_a' } },
          depsFor(ORG_A),
        ),
      ).resolves.toBeUndefined();
      const quiet = depsFor(ORG_A);
      await applyAppAutomationOrganizationWall({ object: 'task', operation: 'insert', context: member(), data: { name: 'x' } }, quiet);
      expect(quiet.callerLayer0).not.toHaveBeenCalled();
    });

    it('control: an object outside the wall admits any organization the payload names', async () => {
      await expect(
        applyAppAutomationOrganizationWall(
          { object: 'catalog', operation: 'insert', context: member(), data: { organization_id: 'org_b' } },
          depsFor(NONE),
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe('the by-id check is read where the write runs', () => {
    it('the write’s own context, transaction included, is handed to the check', async () => {
      const deps = depsFor(ORG_A, { inScope: true });
      const context = { ...actionBody({ tenantId: 'org_a', posture: 'PLATFORM_ADMIN' }), transaction: { handle: 'trx_1' } };
      await applyAppAutomationOrganizationWall({ object: 'task', operation: 'update', context, data: { id: 't_1', touched: 'x' } }, deps);
      expect(vi.mocked(deps.rowInScope).mock.calls[0]?.[3]).toBe(context);
    });
  });

  describe('an external object that states no organization scope', () => {
    it('the refusal names the undeclared scope, not an active organization the caller has', async () => {
      const deps = depsFor(DENY, {
        isFederated: vi.fn(() => true),
        callerLayer0: vi.fn(async () => ({ layer0: RLS_DENY_FILTER, tenantLayer0Verdict: DENY, undeclaredExternalScopePosture: 'isolated' as const })),
      });
      const e = await refusalOf(() =>
        applyAppAutomationOrganizationWall({ object: 'remote', operation: 'update', context: actionBody({ tenantId: 'org_a' }), data: { id: 'r_1' } }, deps),
      );
      expect([e.code, e.status]).toEqual(['PERMISSION_DENIED', 403]);
      expect(e.message).toContain('states none the organization wall can enforce');
      expect(e.message).not.toContain('no active organization');
    });
  });

  describe('the caller’s facts, once per run', () => {
    it('a run’s caller is resolved once, a different run or user resolves again, and an operation of no run is never memoised', async () => {
      const memo = new RunCallerFactsMemo<string>();
      const load = vi.fn(async () => 'facts');
      await memo.resolve('run_1', 'u_a', 'org_a', load);
      await memo.resolve('run_1', 'u_a', 'org_a', load);
      expect(load).toHaveBeenCalledTimes(1);
      await memo.resolve('run_2', 'u_a', 'org_a', load);
      await memo.resolve('run_1', 'u_b', 'org_a', load);
      await memo.resolve(undefined, 'u_a', 'org_a', load);
      await memo.resolve(undefined, 'u_a', 'org_a', load);
      expect(load).toHaveBeenCalledTimes(5);
    });

    it('a failed resolution is not kept, and an entry expires', async () => {
      let t = 0;
      const memo = new RunCallerFactsMemo<string>(256, 1_000, () => t);
      const failing = vi.fn(async () => {
        throw new Error('store down');
      });
      await expect(memo.resolve('run_1', 'u_a', undefined, failing)).rejects.toThrow('store down');
      const load = vi.fn(async () => 'facts');
      await memo.resolve('run_1', 'u_a', undefined, load);
      t = 2_000;
      await memo.resolve('run_1', 'u_a', undefined, load);
      expect(load).toHaveBeenCalledTimes(2);
    });

    it('a context carrying the membership set and a rung below the operator’s needs no resolution', () => {
      expect(carriesDoorFacts({ accessible_org_ids: ['org_a'], posture: 'MEMBER' })).toBe(true);
      expect(carriesDoorFacts({ accessible_org_ids: ['org_a'], permissions: [] })).toBe(true);
      expect(carriesDoorFacts({ accessible_org_ids: ['org_a'], posture: 'PLATFORM_ADMIN' })).toBe(false);
      expect(carriesDoorFacts({ accessible_org_ids: ['org_a'] })).toBe(false);
      expect(carriesDoorFacts({ permissions: [] })).toBe(false);
    });
  });

  describe('which contexts the rule reads', () => {
    it('platform system work that runs for no caller, or carries neither a run nor the mark, is unchanged', async () => {
      const deps = depsFor(DENY);
      for (const context of [
        { isSystem: true },
        { isSystem: true, userId: 'u_alice' },
        { isSystem: true, flowRunId: 'run_sched', actor: 'svc:flow:sweep' },
        markAppAutomationElevation({ isSystem: true }, 'hook'),
      ]) {
        expect(appAutomationWallCaller(context)).toBeUndefined();
        const opCtx: any = { object: 'task', operation: 'update', context, ast: { object: 'task' } };
        await expect(applyAppAutomationOrganizationWall(opCtx, deps)).resolves.toBeUndefined();
        expect(opCtx.ast.where).toBeUndefined();
      }
      expect(deps.callerLayer0).not.toHaveBeenCalled();
    });

    it('a decided segment of a run that began for no caller stays unjudged, though it names its decider', async () => {
      const deps = depsFor(DENY);
      const decided = markRunCaller(systemFlow({ userId: 'u_decider', accessible_org_ids: undefined }), null);
      expect(appAutomationWallCaller(decided)).toBeUndefined();
      await expect(applyAppAutomationOrganizationWall({ object: 'task', operation: 'update', context: decided, data: { id: 't' } }, deps)).resolves.toBeUndefined();
      expect(deps.callerLayer0).not.toHaveBeenCalled();
    });

    it('a decided segment is always asked, though the caller’s own facts would leave it to the engine', async () => {
      const decided = markRunCaller(
        systemFlow({ userId: 'u_decider', tenantId: 'org_a', accessible_org_ids: ['org_c'], posture: 'MEMBER' }),
        'u_alice',
      );
      const deps = depsFor(UNION, {
        completeCaller: vi.fn(async (c: Record<string, unknown>) => ({ ...c, permissions: [], accessible_org_ids: ['org_a', 'org_b'] })),
      });
      const opCtx: any = { object: 'task', operation: 'find', context: decided, ast: { object: 'task' } };
      await applyAppAutomationOrganizationWall(opCtx, deps);
      expect(deps.callerLayer0).toHaveBeenCalledOnce();
      expect(vi.mocked(deps.callerLayer0).mock.calls[0]?.[0]).toMatchObject({ userId: 'u_alice' });
      expect(opCtx.ast.where).toEqual({ organization_id: { $in: ['org_a', 'org_b'] } });
    });

    it('a decided segment of a run that began for a caller is judged as that caller, with none of the segment’s own facts', () => {
      const decided = markRunCaller(systemFlow({ userId: 'u_decider', posture: 'PLATFORM_ADMIN' }), 'u_alice');
      const caller = appAutomationWallCaller(decided);
      expect(caller?.callerContext.userId).toBe('u_alice');
      expect(caller?.callerContext.posture).toBeUndefined();
      expect(caller?.callerContext.accessible_org_ids).toBeUndefined();
    });

    it("a user's own context is not an elevation and is the plain door's to judge", () => {
      expect(appAutomationWallCaller({ userId: 'u_alice', flowRunId: 'run_user' })).toBeUndefined();
      expect(appAutomationWallCaller(markAppAutomationElevation({ userId: 'u_alice' }, 'action'))).toBeUndefined();
    });

    it("the guest entry's envelope is a caller, and each elevation is named by its source", () => {
      expect(appAutomationWallCaller(markAppAutomationElevation({ isSystem: true, principalKind: 'guest' }, 'action'))?.source).toBe('action');
      expect(appAutomationWallCaller(actionBody())?.source).toBe('action');
      expect(appAutomationWallCaller(systemHook())?.source).toBe('hook');
      expect(appAutomationWallCaller(systemFlow())?.source).toBe('flow');
    });
  });
});
