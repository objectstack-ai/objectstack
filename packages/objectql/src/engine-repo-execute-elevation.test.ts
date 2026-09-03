// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #13866 — Director ruling 决裁批 #24 (2026-09-01), clause 2: give
// `ObjectRepository.execute()` the same elevated `ScopedContext` REST
// `/actions` and MCP `run_action` already supply an action body (#13832),
// so all three `executeAction` dispatch paths behave identically under the
// platform's documented trusted posture and #3914's identity-less shape is
// gone from the third one.
//
// Before this fix, `ObjectRepository.execute()` handed the handler
// `{ ...params, userId, tenantId, roles }` — no `api`, no `executionContext`.
// A handler reaching a sibling write via `ctx.api.object(x).update(y)` (the
// in-process action-composition shape `action-execution.ts` and
// `body-runner.ts` document as this method's own reason to exist) got
// `ctx.api === undefined` and threw, or — for the sandbox's own last-resort
// facade — a context-less repo whose writes ran as a non-system caller, so
// the engine's static `readonly` strip (`!opCtx.context?.isSystem`,
// `validation/rule-validator.ts`) applied to it and NOT to the same write
// made through REST `/actions` or MCP `run_action`. This suite pins the
// fixed shape: `ctx.api` is a real `ScopedContext` bound to
// `{ ...callerContext, isSystem: true }` — the same `sudo()`-shaped
// elevation `buildActionExecutionContext` uses — so a `readonly: true`
// column a handler writes through `ctx.api` now LANDS on this path exactly
// as it already does on the other two.
//
// The census this ruling required (repo + `examples/` + `apps/`, production
// and test) found ZERO existing callers of `ObjectRepository.execute()` —
// every hit was prose describing the shape (`action-execution.ts`,
// `body-runner.ts`, `validate-readonly-action-writes.ts`, this method's own
// call site), never an invocation — so nothing shipped today depends on the
// old, context-less behaviour this suite retires.

import { describe, it, expect } from 'vitest';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { ObjectQL, ScopedContext } from './engine.js';

function makeDriver() {
  const stores = new Map<string, Map<string, any>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  const matches = (row: any, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]: [string, any]) => row?.[k] === v);
  };
  let n = 0;
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any) {
      const rows = Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
      // [check:objectql-double-limit] Apply the caller's bound AFTER the
      // filter, by PRESENCE — this fixture is not under test for pagination,
      // but a `find` double that silently ignores `limit` is exactly the
      // shape that gate exists to catch.
      return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      n += 1;
      const id = (data.id as string) ?? `r_${n}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(object);
      const row = { ...s.get(id), ...data, id };
      s.set(id, row);
      return row;
    },
    async updateMany() { return 0; },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count() { return 0; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r, undefined)));
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, storeFor };
}

function makeRig() {
  const engine = new ObjectQL({});
  const d = makeDriver();
  engine.registerDriver(d.driver, true);
  engine.registry.registerObject({
    name: 'os_repo_execute_probe',
    fields: {
      title: { type: 'text' },
      // Author-declared lock — the exact gate `!opCtx.context?.isSystem`
      // guards (`validation/rule-validator.ts`'s `stripReadonlyFields`).
      stamped_by: { type: 'text', readonly: true },
    },
  } as any);
  return { engine, storeFor: d.storeFor };
}

describe('ObjectRepository.execute() elevation (#13866, 决裁批 #24)', () => {
  it('THE FIX: a readonly-field write through ctx.api LANDS, matching REST/MCP', async () => {
    const { engine, storeFor } = makeRig();
    await engine.init();
    storeFor('os_repo_execute_probe').set('p_1', { id: 'p_1', title: 'A', stamped_by: null });

    engine.registerAction('os_repo_execute_probe', 'stamp', async (ctx: any) => {
      // The in-process composition shape this method exists for: a handler
      // reaching a sibling write via `ctx.api.object(x).update(y)`.
      await ctx.api.object('os_repo_execute_probe').update({ id: ctx.id, stamped_by: 'action-body' });
      return { ok: true };
    });

    const callerCtx: ExecutionContext = { userId: 'u_1', tenantId: 't_1' } as any;
    const repo = new ScopedContext(callerCtx, engine as any).object('os_repo_execute_probe');
    const result = await repo.execute('stamp', { id: 'p_1' });

    expect(result).toEqual({ ok: true });
    // THE REGRESSION, stated as the value it must NOT be: before the fix
    // `ctx.api` was `undefined` (throwing) or a context-less facade whose
    // write the static strip silently discarded, leaving `stamped_by: null`.
    expect(storeFor('os_repo_execute_probe').get('p_1').stamped_by).toBe('action-body');
  });

  it('ctx.executionContext carries isSystem: true — the same envelope buildActionExecutionContext builds', async () => {
    const { engine } = makeRig();
    await engine.init();
    let seenExecutionContext: any;
    let seenApi: any;
    engine.registerAction('os_repo_execute_probe', 'inspect', async (ctx: any) => {
      seenExecutionContext = ctx.executionContext;
      seenApi = ctx.api;
      return { ok: true };
    });

    const callerCtx: ExecutionContext = { userId: 'u_2', tenantId: 't_2' } as any;
    await new ScopedContext(callerCtx, engine as any).object('os_repo_execute_probe').execute('inspect', {});

    expect(seenExecutionContext).toMatchObject({ userId: 'u_2', tenantId: 't_2', isSystem: true });
    expect(seenApi).toBeInstanceOf(ScopedContext);
  });

  it('the elevation is ATTRIBUTABLE, not anonymous: userId/tenantId still ride the elevated context', async () => {
    // The reason `buildActionExecutionContext` spreads the caller's envelope
    // FIRST rather than handing over a bare `{ isSystem: true }` — pinned
    // here on the third path exactly as `recomputeSummaries`' `systemCtx`
    // pins it on the second.
    const { engine } = makeRig();
    await engine.init();
    let capturedUserId: unknown;
    let capturedTenantId: unknown;
    engine.registerAction('os_repo_execute_probe', 'capture_identity', async (ctx: any) => {
      capturedUserId = ctx.executionContext.userId;
      capturedTenantId = ctx.executionContext.tenantId;
      return { ok: true };
    });

    const callerCtx: ExecutionContext = { userId: 'u_3', tenantId: 't_3' } as any;
    await new ScopedContext(callerCtx, engine as any).object('os_repo_execute_probe').execute('capture_identity', {});

    expect(capturedUserId).toBe('u_3');
    expect(capturedTenantId).toBe('t_3');
  });

  it('an already-elevated caller composing through repo.execute() stays elevated (no regression)', async () => {
    const { engine, storeFor } = makeRig();
    await engine.init();
    storeFor('os_repo_execute_probe').set('p_2', { id: 'p_2', title: 'B', stamped_by: null });

    engine.registerAction('os_repo_execute_probe', 'stamp2', async (ctx: any) => {
      await ctx.api.object('os_repo_execute_probe').update({ id: ctx.id, stamped_by: 'still-elevated' });
      return { ok: true };
    });

    const systemCtx: ExecutionContext = { isSystem: true } as any;
    await new ScopedContext(systemCtx, engine as any).object('os_repo_execute_probe').execute('stamp2', { id: 'p_2' });

    expect(storeFor('os_repo_execute_probe').get('p_2').stamped_by).toBe('still-elevated');
  });

  it('PARITY: the same landed value a non-system caller updating directly with { context: { isSystem: true } } produces', async () => {
    // Not a REST/MCP integration test (those live in `packages/runtime`,
    // which cannot be imported from here without a circular dependency) —
    // this asserts the same OUTCOME that posture produces on the write path
    // both those doors and this one now share: a readonly write elevated by
    // `isSystem: true` lands, non-elevated does not.
    const { engine, storeFor } = makeRig();
    await engine.init();
    storeFor('os_repo_execute_probe').set('p_3', { id: 'p_3', title: 'C', stamped_by: null });
    storeFor('os_repo_execute_probe').set('p_4', { id: 'p_4', title: 'D', stamped_by: null });

    // The REST/MCP-equivalent direct write.
    await engine.update(
      'os_repo_execute_probe',
      { id: 'p_3', stamped_by: 'direct-elevated' },
      { context: { isSystem: true } } as any,
    );

    // The repo.execute()-mediated write, now under the same posture.
    engine.registerAction('os_repo_execute_probe', 'stamp3', async (ctx: any) => {
      await ctx.api.object('os_repo_execute_probe').update({ id: ctx.id, stamped_by: 'via-repo-execute' });
    });
    const callerCtx: ExecutionContext = { userId: 'u_4' } as any;
    await new ScopedContext(callerCtx, engine as any).object('os_repo_execute_probe').execute('stamp3', { id: 'p_4' });

    expect(storeFor('os_repo_execute_probe').get('p_3').stamped_by).toBe('direct-elevated');
    expect(storeFor('os_repo_execute_probe').get('p_4').stamped_by).toBe('via-repo-execute');
  });
});
