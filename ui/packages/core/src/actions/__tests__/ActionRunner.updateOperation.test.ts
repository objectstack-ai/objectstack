/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * `operation: 'update'` — the declarative single-record field write
 * (objectui#7551, consuming `@objectstack/spec` 17.3.0; objectstack#14092).
 *
 * Four facts are pinned here, and each one has a measured failure behind it:
 *
 *  1. **The runner dispatches on `operation` BEFORE `type`.** The spec
 *     materializes `type: 'script'` on an update action and `ActionType` gained
 *     no member, so `type` cannot tell an update action from any other script
 *     action. A row rehydrated UNPARSED carries no `type` at all, and resolved
 *     by `type` it would end in `executeActionSchema`, reported on and never run.
 *  2. **The request carries the collected params, never `patch`
 *     (objectui#12941).** The route applies the declared `patch` itself, from
 *     the declaration it resolves by name. Posting the patch keys as `params`
 *     made every declarative-update button a request with undeclared params,
 *     which the runtime's ADR-0104 D2 refusal (objectstack#24268) answers with
 *     a 400. The pin runs every button against a route that refuses them.
 *  3. **The write is performed by the platform action route, never client-side.**
 *     `POST /api/v1/actions/{object}/{action}` runs it as the caller, so the
 *     permission floor, the object's hooks and its validations all fire. A
 *     `dataSource.update()` reaches the data plane having consulted none of
 *     them, which is why these tests assert the route was posted AND that no
 *     data source was touched.
 *  4. **A route refusal surfaces.** Swallowing one into a green success toast
 *     is the objectui#2960 class; the refusal's own message must reach the user
 *     and the success toast must not fire.
 *
 * The dispatch under test is the REAL `createServerActionHandler`, not a stub
 * of it: the assertions are about the URL and request body that actually leave
 * the client, so a regression in either half fails here.
 */

import { describe, it, expect, vi } from 'vitest';
import { validateActionParams } from '@objectstack/spec/ui';
import { ActionRunner, type ActionDef } from '../ActionRunner';
import { createServerActionHandler, type ServerActionFetch } from '../serverActionHandler';

/** A fetch stub answering the route's success envelope. */
function okFetch(body: unknown = { success: true, data: { ok: true } }) {
  return vi.fn(async () => ({ ok: true, status: 200, json: async () => body }));
}

/** The parsed JSON body of the `call`-th request a fetch stub was sent. */
function sentBody(fetch: { mock: { calls: unknown[][] } }, call = 0): { recordId?: unknown; params?: unknown } {
  return JSON.parse((fetch.mock.calls[call][1] as { body: string }).body);
}

/** A fetch stub answering the route's REFUSAL envelope — a real code + status. */
function refusingFetch(status = 403, code = 'PERMISSION_DENIED') {
  return vi.fn(async () => ({
    ok: false,
    status,
    json: async () => ({
      success: false,
      error: { code, message: `Refused by the action route (${code}, HTTP ${status})` },
    }),
  }));
}

/**
 * A runner wired exactly as a console host wires one: the server-action
 * dispatch registered under `script`, plus a toast spy so the "green toast on a
 * refusal" half can be observed rather than assumed.
 */
function wireRunner(fetch: ReturnType<typeof okFetch>, context: Record<string, unknown> = {}) {
  const runner = new ActionRunner(context);
  const toasts: Array<{ message: string; type?: string }> = [];
  runner.setToastHandler((message, opts) => {
    toasts.push({ message, type: opts?.type });
  });
  runner.registerHandler(
    'script',
    createServerActionHandler({ fetch: fetch as unknown as ServerActionFetch }),
  );
  return { runner, toasts };
}

/** The parsed shape the spec produces for an authored update action. */
function updateAction(overrides: Partial<ActionDef> = {}): ActionDef {
  return {
    type: 'script',
    name: 'mark_done',
    label: 'Mark Done',
    objectName: 'tasks',
    operation: 'update',
    patch: { status: 'done' },
    ...overrides,
  } as ActionDef;
}

describe("operation: 'update' — dispatch reaches the platform action route", () => {
  it('POSTs /api/v1/actions/{object}/{action} with the record id, and no `patch` key in params', async () => {
    const fetch = okFetch();
    const { runner } = wireRunner(fetch);

    const result = await runner.execute(updateAction({
      params: { recordId: 'rec_1' } as never,
    }));

    expect(result.success).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toBe('/api/v1/actions/tasks/mark_done');
    expect(init.method).toBe('POST');
    // objectui#12941: the declared `patch` (`status`) is the route's, applied
    // from the declaration; the request carries only what was collected.
    expect(JSON.parse(init.body)).toEqual({
      recordId: 'rec_1',
      params: { recordId: 'rec_1' },
    });
  });

  it('dispatches on `operation` even when the action carries NO `type` at all', async () => {
    // A row rehydrated from `sys_metadata` UNPARSED (objectui#3903) never got
    // the spec's materialized `type: 'script'`. Resolved by `type`, its
    // `actionType` falls back to the action NAME, matches no executor, and the
    // action ends in `executeActionSchema` — reported on, never run.
    const fetch = okFetch();
    const { runner } = wireRunner(fetch);

    const action = updateAction({ params: { recordId: 'rec_9' } as never });
    delete (action as Record<string, unknown>).type;

    const result = await runner.execute(action);

    expect(result.success).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((fetch as any).mock.calls[0][0]).toBe('/api/v1/actions/tasks/mark_done');
    expect(JSON.parse((fetch as any).mock.calls[0][1].body).params).toEqual({ recordId: 'rec_9' });
  });

  it('sends a collected value as-is and no `patch` member, even one of the same name', async () => {
    // The spec's words for the merge the ROUTE performs: static values "merged
    // UNDER the user-supplied `params` so a fixed value can be declared without
    // exposing it in the dialog". The collected `note` is what the user typed,
    // and the route writes it over the patch's; the patch's `status` never
    // travels (objectui#12941).
    const fetch = okFetch();
    const { runner } = wireRunner(fetch);

    await runner.execute(updateAction({
      patch: { status: 'done', note: 'from patch' } as never,
      params: { recordId: 'rec_2', note: 'typed by the user' } as never,
    }));

    expect(JSON.parse((fetch as any).mock.calls[0][1].body).params).toEqual({
      recordId: 'rec_2',
      note: 'typed by the user',
    });
  });

  it('never performs a client-side data-plane write, and refuses loudly with no route to post to', async () => {
    // No `script` handler registered — the runner cannot reach the route. The
    // two silent alternatives are both wrong: `executeScript` ends at "No
    // script provided" (an update action declares no `target`), and
    // `executeActionSchema` reports on an action that never ran.
    const runner = new ActionRunner({});
    const dataSource = { update: vi.fn(), execute: vi.fn() };
    (runner as unknown as { context: Record<string, unknown> }).context.dataSource = dataSource;

    const result = await runner.execute(updateAction());

    expect(result.success).toBe(false);
    expect(result.error).toContain('/api/v1/actions/{object}/{action}');
    expect(result.error).toContain('createServerActionHandler');
    expect(dataSource.update).not.toHaveBeenCalled();
    expect(dataSource.execute).not.toHaveBeenCalled();
  });
});

describe("operation: 'update' — a route refusal surfaces, never a green toast", () => {
  it('reports the refusal and fires the ERROR toast, not the success one', async () => {
    const fetch = refusingFetch(403, 'PERMISSION_DENIED');
    const { runner, toasts } = wireRunner(fetch as unknown as ReturnType<typeof okFetch>);

    const result = await runner.execute(updateAction({
      successMessage: 'Marked done',
      params: { recordId: 'rec_3' } as never,
    }));

    expect(result.success).toBe(false);
    // The envelope's own code and status reach the user — asserting only that
    // "something failed" would pass on a driver that refused for any reason.
    expect(result.error).toContain('PERMISSION_DENIED');
    expect(result.error).toContain('403');

    expect(toasts.map((t) => t.type)).toEqual(['error']);
    expect(toasts.some((t) => t.message === 'Marked done')).toBe(false);
  });

  it('surfaces a 200-with-`success:false` business rejection too', async () => {
    // The shape `res.ok` alone cannot see (objectstack#3913): HTTP 200 whose
    // INNER envelope says no.
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { success: false, error: 'Task is locked' } }),
    }));
    const { runner, toasts } = wireRunner(fetch as unknown as ReturnType<typeof okFetch>);

    const result = await runner.execute(updateAction({
      successMessage: 'Marked done',
      params: { recordId: 'rec_4' } as never,
    }));

    expect(result.success).toBe(false);
    expect(result.error).toBe('Task is locked');
    expect(toasts.map((t) => t.type)).toEqual(['error']);
  });
});

describe("operation: 'update' — undoable captures exactly the written fields", () => {
  it('captures the prior values of the written fields, and of nothing else', async () => {
    const fetch = okFetch();
    const { runner } = wireRunner(fetch);

    const result = await runner.execute(updateAction({
      undoable: true,
      patch: { status: 'done' } as never,
      params: {
        note: 'typed',
        _rowRecord: { id: 'rec_5', status: 'open', note: 'was', owner: 'alice' },
      } as never,
    }));

    expect(result.success).toBe(true);
    expect(result.undo).toBeDefined();
    expect(result.undo!.objectName).toBe('tasks');
    expect(result.undo!.recordId).toBe('rec_5');
    // EXACTLY the written fields: `owner` was never written, so restoring it
    // would revert an edit this action did not make.
    expect(result.undo!.undoData).toEqual({ status: 'open', note: 'was' });
    expect(result.undo!.redoData).toEqual({ status: 'done', note: 'typed' });
    // `status` is written by the route from its declaration and never sent
    // (objectui#12941), so the snapshot is read off the route's merge, not off
    // the request: the request carries `note` alone.
    expect(sentBody(fetch).params).toEqual({ note: 'typed' });
  });

  it('offers no Undo affordance when `undoable` is not declared', async () => {
    const fetch = okFetch();
    const { runner } = wireRunner(fetch);

    const result = await runner.execute(updateAction({
      params: { _rowRecord: { id: 'rec_6', status: 'open' } } as never,
    }));

    expect(result.success).toBe(true);
    expect(result.undo).toBeUndefined();
  });
});

/** A route declaration: the authored action the server resolves by name. */
interface RouteDeclaration {
  params?: Array<{ name: string; type?: string; required?: boolean }>;
  patch?: Record<string, unknown>;
}

/**
 * The platform action route as the runtime's ADR-0104 D2 refusal makes it
 * (objectstack#24268), over the real request the real `createServerActionHandler`
 * sends. It resolves the action's DECLARATION by the name in the URL, judges
 * the request's `params` with `@objectstack/spec`'s own `validateActionParams`
 * (an undeclared key that is not a built-in is refused, whether or not the
 * action declares any params), and otherwise writes the declared `patch`
 * UNDER the params it was sent — `declarativeUpdateWrite`'s merge. The patch
 * comes from the declaration, never from the request.
 */
function refusingRoute(declarations: Record<string, RouteDeclaration>) {
  const writes: Array<{ action: string; recordId: unknown; data: Record<string, unknown> }> = [];
  const refusals: Array<{ action: string; status: number; code: string; params: string[] }> = [];
  const fetch = vi.fn(async (url: string, init: { body: string }) => {
    const action = decodeURIComponent(url.slice(url.lastIndexOf('/') + 1));
    const declaration = declarations[action] ?? {};
    const body = JSON.parse(init.body) as { recordId?: unknown; params?: Record<string, unknown> };
    const params = body.params ?? {};
    const issues = validateActionParams(declaration.params ?? [], params);
    if (issues.length > 0) {
      refusals.push({ action, status: 400, code: 'VALIDATION_ERROR', params: issues.map((i) => i.param) });
      return {
        ok: false,
        status: 400,
        json: async () => ({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `Invalid action params: ${issues.map((i) => i.message).join('; ')}`,
          },
        }),
      };
    }
    writes.push({ action, recordId: body.recordId, data: { ...(declaration.patch ?? {}), ...params } });
    return { ok: true, status: 200, json: async () => ({ success: true, data: { ok: true } }) };
  });
  return { fetch, writes, refusals };
}

/**
 * The shape a grid row hands the runner (`ObjectGrid`'s row-action dispatch):
 * the authored def, its param definitions moved to `actionParams`, and the row
 * stashed under `params._rowRecord`.
 */
function gridRowDispatch(def: Record<string, unknown>, row: Record<string, unknown>): ActionDef {
  const { params, ...rest } = def;
  return {
    ...rest,
    ...(Array.isArray(params) && params.length > 0 ? { actionParams: params } : {}),
    params: { _rowRecord: row },
  } as ActionDef;
}

describe("operation: 'update' — against a route that refuses undeclared params (objectui#12941)", () => {
  const ROW = { id: 'rec_10', status: 'open', note: 'was' };
  const MARK_DONE = { name: 'mark_done', objectName: 'tasks', operation: 'update', patch: { status: 'done' } };
  const ADD_NOTE = {
    name: 'add_note',
    objectName: 'tasks',
    operation: 'update',
    patch: { status: 'done' },
    params: [{ name: 'note', type: 'text', label: 'Note' }],
  };

  function wireAgainst(route: ReturnType<typeof refusingRoute>) {
    const { runner, toasts } = wireRunner(route.fetch as unknown as ReturnType<typeof okFetch>);
    runner.setParamCollectionHandler(async () => ({ note: 'typed by the user' }));
    return { runner, toasts };
  }

  it('a patch-only button writes its patch: the request carries no undeclared param', async () => {
    const route = refusingRoute({ mark_done: { patch: { status: 'done' } } });
    const { runner, toasts } = wireAgainst(route);

    const result = await runner.execute(gridRowDispatch({ type: 'script', ...MARK_DONE }, ROW));

    expect(route.refusals).toEqual([]);
    expect(result.success).toBe(true);
    expect(toasts.map((t) => t.type)).not.toContain('error');
    expect(route.writes).toEqual([{ action: 'mark_done', recordId: 'rec_10', data: { status: 'done' } }]);
  });

  it('control: a button that declares a param sends that param, and the route writes it over the patch', async () => {
    const route = refusingRoute({
      add_note: { params: [{ name: 'note', type: 'text' }], patch: { status: 'done' } },
    });
    const { runner } = wireAgainst(route);

    const result = await runner.execute(gridRowDispatch({ type: 'script', ...ADD_NOTE }, ROW));

    expect(route.refusals).toEqual([]);
    expect(result.success).toBe(true);
    // The declared param travels; the patch does not, and the route still writes both.
    expect(sentBody(route.fetch)).toEqual({
      recordId: 'rec_10',
      params: { note: 'typed by the user' },
    });
    expect(route.writes).toEqual([
      { action: 'add_note', recordId: 'rec_10', data: { status: 'done', note: 'typed by the user' } },
    ]);
  });

  it('control: the route does refuse an undeclared param, so the two greens above are earned', async () => {
    // The same route, sent the patch key as a param by a plain script action:
    // the request this runner used to send for `mark_done`.
    const route = refusingRoute({ mark_done: { patch: { status: 'done' } } });
    const { runner, toasts } = wireAgainst(route);

    const result = await runner.execute({
      type: 'script',
      name: 'mark_done',
      objectName: 'tasks',
      params: { _rowRecord: ROW, status: 'done' },
    } as ActionDef);

    expect(result.success).toBe(false);
    expect(route.refusals).toEqual([{ action: 'mark_done', status: 400, code: 'VALIDATION_ERROR', params: ['status'] }]);
    expect(result.error).toContain('Unknown action param "status"');
    expect(toasts.map((t) => t.type)).toEqual(['error']);
    expect(route.writes).toEqual([]);
  });
});

describe('reverse pin — a script action WITHOUT `operation` is untouched', () => {
  it('still dispatches by `type` through the registered script handler', async () => {
    const fetch = okFetch();
    const { runner } = wireRunner(fetch);

    const result = await runner.execute({
      type: 'script',
      name: 'archive',
      objectName: 'tasks',
      params: { recordId: 'rec_7', reason: 'stale' },
    } as ActionDef);

    expect(result.success).toBe(true);
    expect((fetch as any).mock.calls[0][0]).toBe('/api/v1/actions/tasks/archive');
    expect(JSON.parse((fetch as any).mock.calls[0][1].body)).toEqual({
      recordId: 'rec_7',
      params: { recordId: 'rec_7', reason: 'stale' },
    });
  });

  it('leaves a non-update `type` (url) on its own executor', async () => {
    const fetch = okFetch();
    const { runner } = wireRunner(fetch);
    const navigated: string[] = [];
    runner.setNavigationHandler((url) => { navigated.push(url); });

    const result = await runner.execute({
      type: 'url', name: 'docs', target: '/docs',
    } as ActionDef);

    expect(result.success).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(navigated).toEqual(['/docs']);
  });
});
