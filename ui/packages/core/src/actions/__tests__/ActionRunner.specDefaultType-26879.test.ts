/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * A stored action without `type` runs on the spec's default route
 * (objectstack-ai/objectstack#26879).
 *
 * `@objectstack/spec`'s `ActionSchema.type` is `.default('script')`, but the
 * console runs the stored row, not its parse: a row rehydrated UNPARSED
 * carries no `type` at all. The runner used to resolve such an action's route
 * to its NAME, match no executor, and refuse it as "not executable" — so a
 * spec-valid script action that Studio's New skeleton or an older Studio build
 * stored without `type` was dead in the console. The runner now reads the
 * missing `type` as the spec's default, at the one place it picks the route
 * (`resolveDispatchType`).
 *
 * Pinned here:
 *  1. A typeless `{ name, body }` and a typeless `{ name, operation: 'update',
 *     patch }` both reach the registered `script` dispatch — the REAL
 *     `createServerActionHandler`, so the URL that leaves the client is what is
 *     asserted.
 *  2. The default is the SPEC's: a typeless action takes the route named by
 *     the `type` that `ActionSchema` materializes on it.
 *  3. What the default must not swallow: an unknown `type` and a completely
 *     empty schema are still refused, a handler registered under the action's
 *     name still outranks the default, and a runner-own key (`redirect`) still
 *     runs on its legacy leg.
 */

import { describe, it, expect, vi } from 'vitest';
import { ActionSchema } from '@objectstack/spec/ui';
import { ActionRunner, type ActionDef, type ActionRunnerHandler } from '../ActionRunner';
import { createServerActionHandler, type ServerActionFetch } from '../serverActionHandler';

/** A fetch stub answering the route's success envelope. */
function okFetch() {
  return vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, data: { ok: true } }) }));
}

/** A runner wired as a console host wires one: the server-action dispatch under `script`. */
function wireRunner(fetch: ReturnType<typeof okFetch>) {
  const runner = new ActionRunner({});
  runner.registerHandler(
    'script',
    createServerActionHandler({ fetch: fetch as unknown as ServerActionFetch }),
  );
  return runner;
}

/** A stored script action as New's skeleton or an older Studio build left it: no `type`. */
const TYPELESS_BODY_ACTION: ActionDef = {
  name: 'run_script',
  label: 'Run script',
  objectName: 'tasks',
  body: { language: 'expression', source: 'true' },
};

/** A stored declarative update with no `type`. */
const TYPELESS_UPDATE_ACTION: ActionDef = {
  name: 'mark_done',
  label: 'Mark Done',
  objectName: 'tasks',
  operation: 'update',
  patch: { status: 'done' },
};

describe('a stored action without `type` runs on the script route', () => {
  it('runs a typeless `{ name, body }` action on the platform action route', async () => {
    const fetch = okFetch();
    const runner = wireRunner(fetch);

    const result = await runner.execute({ ...TYPELESS_BODY_ACTION, params: { recordId: 'rec_1' } as never });

    expect(result.success).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toBe('/api/v1/actions/tasks/run_script');
    expect(init.method).toBe('POST');
  });

  it("runs a typeless `{ name, operation: 'update', patch }` action on the platform action route", async () => {
    const fetch = okFetch();
    const runner = wireRunner(fetch);

    const result = await runner.execute({ ...TYPELESS_UPDATE_ACTION, params: { recordId: 'rec_2' } as never });

    expect(result.success).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((fetch as any).mock.calls[0][0]).toBe('/api/v1/actions/tasks/mark_done');
  });

  it("asks the script dispatch's early refusal for a typeless action, as for a typed one", async () => {
    // The route picked once is the route asked before any input
    // (`refusalBeforeInput`) and the route dispatched on.
    const dispatch = vi.fn(async () => ({ success: true })) as unknown as ActionRunnerHandler;
    const refuseBeforeInput = vi.fn(() => ({ error: 'Select one record' }));
    dispatch.refuseBeforeInput = refuseBeforeInput;
    const runner = new ActionRunner({});
    runner.registerHandler('script', dispatch);

    const result = await runner.execute({ ...TYPELESS_BODY_ACTION });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Select one record');
    expect(refuseBeforeInput).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe("the default is the spec's", () => {
  it('takes the route named by the `type` ActionSchema materializes on a typeless action', async () => {
    const parsed = ActionSchema.safeParse(TYPELESS_BODY_ACTION);
    expect(parsed.error).toBeUndefined();
    const specType = parsed.success ? parsed.data.type : undefined;
    expect(typeof specType).toBe('string');

    const runner = new ActionRunner({});
    const reached: string[] = [];
    for (const type of ['script', 'url', 'modal', 'flow', 'api', 'form', 'navigation']) {
      runner.registerHandler(type, async () => {
        reached.push(type);
        return { success: true };
      });
    }

    const result = await runner.execute({ ...TYPELESS_BODY_ACTION });

    expect(result.success).toBe(true);
    expect(reached).toEqual([specType]);
  });
});

describe('what the default does not swallow', () => {
  it('still refuses an action whose `type` names no route', async () => {
    const script = vi.fn(async () => ({ success: true }));
    const runner = new ActionRunner({});
    runner.registerHandler('script', script);

    const result = await runner.execute({ type: 'convert_lead', name: 'convert_lead' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('convert_lead');
    expect(script).not.toHaveBeenCalled();
  });

  it('still refuses a completely empty schema', async () => {
    const script = vi.fn(async () => ({ success: true }));
    const runner = new ActionRunner({});
    runner.registerHandler('script', script);

    const result = await runner.execute({});

    expect(result.success).toBe(false);
    expect(result.error).toContain('not executable');
    expect(script).not.toHaveBeenCalled();
  });

  it('runs a handler registered under the action name ahead of the default', async () => {
    const script = vi.fn(async () => ({ success: true }));
    const byName = vi.fn(async () => ({ success: true }));
    const runner = new ActionRunner({});
    runner.registerHandler('script', script);
    runner.registerHandler('run_script', byName);

    const result = await runner.execute({ ...TYPELESS_BODY_ACTION });

    expect(result.success).toBe(true);
    expect(byName).toHaveBeenCalledTimes(1);
    expect(script).not.toHaveBeenCalled();
  });

  it('runs a typeless named action that declares a `redirect` on its legacy leg', async () => {
    const script = vi.fn(async () => ({ success: true }));
    const runner = new ActionRunner({});
    runner.registerHandler('script', script);

    const result = await runner.execute({ name: 'go_home', redirect: '/home' });

    expect(result.success).toBe(true);
    expect(result.redirect).toBe('/home');
    expect(script).not.toHaveBeenCalled();
  });
});
