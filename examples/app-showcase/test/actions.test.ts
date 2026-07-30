// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { actionBodyRunnerFactory, QuickJSScriptRunner } from '@objectstack/runtime';

import { allActions, MarkDoneAction, PortfolioSnapshotAction } from '../src/ui/actions/index.js';

/**
 * Execution-path coverage for declared actions.
 *
 * The `coverage.test.ts` check only asserts that every `ActionType` *appears*
 * in the bundle — a `type: 'script'` action with no executable handler passes
 * it. That blind spot shipped the #2169 bug: `showcase_mark_done` declared
 * `type: 'script'` but carried neither a `body` nor a `target`, so AppPlugin
 * registered no engine handler and clicking "Mark Done" failed at runtime with
 * `Action 'showcase_mark_done' on object '*' not found`.
 *
 * These tests drive the **real** runtime path — `actionBodyRunnerFactory` +
 * the QuickJS sandbox, the exact bridge AppPlugin uses — against the actions as
 * shipped. A body that fails to parse, references the wrong field, or is missing
 * entirely fails here, not in production.
 */
describe('showcase actions — executability', () => {
  const runner = new QuickJSScriptRunner();

  it('every declared `script` action is executable (has a body or a target)', () => {
    // Mirrors the platform invariant enforced by ActionSchema: a script action
    // must be bound to *something* runnable. `target` actions are wired
    // imperatively (e.g. via onEnable); `body` actions are auto-registered.
    const scriptActions = allActions.filter((a) => a.type === 'script');
    expect(scriptActions.length).toBeGreaterThan(0);
    for (const a of scriptActions) {
      expect(
        Boolean((a as { body?: unknown }).body) || Boolean((a as { target?: unknown }).target),
        `script action '${a.name}' has neither body nor target — it cannot be invoked`,
      ).toBe(true);
    }
  });

  it('the runtime produces a handler for Mark Done (regression: #2169)', () => {
    const factory = actionBodyRunnerFactory(runner, { ql: {}, appId: 'showcase' });
    const handler = factory(MarkDoneAction as never);
    expect(typeof handler).toBe('function');
  });

  it('Mark Done flips `done` + `progress` via the sandboxed body', async () => {
    // Capture what the action writes through the proxied ObjectQL engine.
    let written: { object: string; data: Record<string, unknown> } | undefined;
    const ql = {
      object: (object: string) => ({
        update: async (data: Record<string, unknown>) => {
          written = { object, data };
          return { id: data.id };
        },
      }),
    };

    const factory = actionBodyRunnerFactory(runner, { ql, appId: 'showcase' });
    const handler = factory(MarkDoneAction as never);
    expect(typeof handler).toBe('function');

    const result = await handler!({
      recordId: 'task_1',
      record: { id: 'task_1', status: 'in_progress', progress: 40, done: false },
      params: {},
      user: { id: 'u1' },
    });

    // It updates the right object with the completion fields — and deliberately
    // does NOT touch `status` (the state-machine only permits in_review -> done).
    expect(written?.object).toBe('showcase_task');
    expect(written?.data).toMatchObject({ id: 'task_1', done: true, progress: 100 });
    expect(written?.data).not.toHaveProperty('status');
    expect(result).toEqual({ ok: true, id: 'task_1' });
  });

  it('a body-less `script` action yields no handler (the #2169 failure mode)', () => {
    // Documents exactly what used to ship: with neither body nor target the
    // runtime has nothing to register, so the HTTP action route falls into the
    // wildcard fallback. ActionSchema now rejects this at author time; this
    // asserts the runtime half of the contract.
    const factory = actionBodyRunnerFactory(runner, { ql: {}, appId: 'showcase' });
    const handler = factory({ name: 'broken', object: 'showcase_task' } as never);
    expect(handler).toBeUndefined();
  });
});

/**
 * The object-less ("global") action specimen — framework#3913.
 *
 * #3913 was filed because object-less actions were unreachable: registered
 * under the canonical `'global'` key, looked up under `'*'`. Its follow-up then
 * found that `POST /api/v1/actions//:action` — the empty-object-segment URL the
 * issue was actually filed against — had no route registration at all. Both
 * were fixed with **no live specimen**: the showcase is the "one specimen of
 * everything" app and every action in it declared an `objectName`, so nothing
 * exercised the object-less dispatch path end to end.
 *
 * These tests pin the two properties that make it a specimen. The first is the
 * one that silently rots: adding an `objectName` to this action would still
 * build, still pass `coverage.test.ts`, and still work — while quietly removing
 * the app's only coverage of object-less dispatch.
 */
describe('showcase actions — the object-less (`global`) specimen', () => {
  const runner = new QuickJSScriptRunner();

  it('declares no object, so it keys at `global` (framework#3913)', () => {
    // This mirrors ObjectQLPlugin.actionObjectKey / AppPlugin's
    // `action.object || 'global'`: neither field set → the 'global' bucket.
    const a = PortfolioSnapshotAction as { objectName?: string; object?: string };
    expect(a.objectName).toBeUndefined();
    expect(a.object).toBeUndefined();

    // ...and it is the ONLY one, so this test is what keeps the specimen alive.
    const objectLess = allActions.filter((x) => {
      const y = x as { objectName?: string; object?: string };
      return !y.objectName && !y.object;
    });
    expect(objectLess.map((x) => x.name)).toEqual(['showcase_portfolio_snapshot']);
  });

  it('counts across several objects via the sandboxed body', async () => {
    // An object-less action has no record and no single object to hang off —
    // this body reads three, which is why it cannot be given an `objectName`.
    const counts: Record<string, number> = {
      showcase_account: 15,
      showcase_project: 5,
      showcase_invoice: 13,
    };
    const seen: string[] = [];
    const ql = {
      object: (object: string) => ({
        count: async () => {
          seen.push(object);
          return counts[object] ?? 0;
        },
      }),
    };

    const factory = actionBodyRunnerFactory(runner, { ql, appId: 'showcase' });
    const handler = factory(PortfolioSnapshotAction as never);
    expect(typeof handler).toBe('function');

    // No recordId, no record — the object-less invocation shape.
    const result = await handler!({ params: {}, user: { id: 'u1' } });

    expect(seen).toEqual(['showcase_account', 'showcase_project', 'showcase_invoice']);
    expect(result).toEqual({
      ok: true,
      scope: 'global',
      accounts: 15,
      projects: 5,
      invoices: 13,
    });
  });
});
