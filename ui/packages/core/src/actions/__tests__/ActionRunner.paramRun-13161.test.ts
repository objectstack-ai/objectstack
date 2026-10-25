/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ParamCollectionHandler`'s `run` (objectui#13161).
 *
 * The console's param dialog used to resolve its values and close BEFORE the
 * runner dispatched the action, so a server refusal landed on a dialog that no
 * longer existed and only the error toast remained; what the user typed was
 * gone. The runner now hands the handler `run`: the handler dispatches the
 * action itself, learns the outcome, and keeps its dialog open on a refusal.
 *
 * What these pin, at the runner:
 *  - a refused run reaches the handler as its `ActionResult`, with the error
 *    toast it would have had as a lone run, and nothing ends the session;
 *  - a second `run` re-dispatches with the edited values, merged over the
 *    params the action had BEFORE the session, never over the first run's;
 *  - a success's post-execution waits for the handler to settle, and
 *    `execute` answers that run's result;
 *  - cancelling after a refusal is a cancel, and dispatches nothing more;
 *  - a `run` while one is in flight dispatches nothing new;
 *  - a dispatch that throws is a refused run, not a rejection;
 *  - a handler that never calls `run` keeps the old one-dispatch contract.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { ActionRunner, type ActionResult, type ParamCollectionHandler, type ToastHandler } from '../ActionRunner';

const PARAMS = [
  { name: 'email', label: 'Email', type: 'text' },
  { name: 'name', label: 'Name', type: 'text' },
];

const REFUSAL = 'User already exists. Use another email.';

/** A deferred the test settles by hand, to hold a run in flight. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('ActionRunner — the param-collection session (`run`, objectui#13161)', () => {
  let runner: ActionRunner;
  let toast: Mock<ToastHandler>;

  beforeEach(() => {
    runner = new ActionRunner({});
    toast = vi.fn<ToastHandler>();
    runner.setToastHandler(toast);
  });

  it('a refused run reaches the handler as its result, toasted as a lone run is, and the session stays open', async () => {
    const api = vi.fn(async (): Promise<ActionResult> => ({ success: false, error: REFUSAL }));
    runner.registerHandler('api', api);

    let seen: ActionResult | undefined;
    let finish!: (v: Record<string, any> | null) => void;
    const handler: ParamCollectionHandler = (_params, _action, _interpolate, run) =>
      new Promise((resolve) => {
        finish = resolve;
        void run!({ email: 'ada@example.com', name: 'Ada' }).then((r) => { seen = r; });
      });
    runner.setParamCollectionHandler(handler);

    const pending = runner.execute({ type: 'api', name: 'create_user', params: PARAMS });
    await vi.waitFor(() => expect(seen).toBeDefined());

    expect(seen).toEqual({ success: false, error: REFUSAL });
    expect(api).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(REFUSAL, expect.objectContaining({ type: 'error' }));

    // The session is still open: `execute` has not answered.
    let answered = false;
    void pending.then(() => { answered = true; });
    await Promise.resolve();
    expect(answered).toBe(false);

    finish(null);
    await expect(pending).resolves.toEqual({ success: false, error: 'Action cancelled by user (params)' });
  });

  it('a second `run` re-dispatches with the edited values over the pre-session params, and the success ends the session', async () => {
    const sent: Array<Record<string, any>> = [];
    const api = vi.fn(async (action: any): Promise<ActionResult> => {
      sent.push({ ...action.params });
      return action.params.email === 'taken@example.com'
        ? { success: false, error: REFUSAL }
        : { success: true, data: { id: 'u1' } };
    });
    runner.registerHandler('api', api);

    const handler: ParamCollectionHandler = async (_params, _action, _interpolate, run) => {
      const first = await run!({ email: 'taken@example.com', name: 'Ada', stale_key: 'from-run-1' });
      expect(first.success).toBe(false);
      const second = await run!({ email: 'ada@example.com', name: 'Ada' });
      expect(second.success).toBe(true);
      // No success toast yet: a success's post-execution waits for the
      // handler, so its dialog is closed before the toast shows.
      expect(toast.mock.calls.filter(([, o]) => o?.type === 'success')).toHaveLength(0);
      return { email: 'ada@example.com', name: 'Ada' };
    };
    runner.setParamCollectionHandler(handler);

    const result = await runner.execute({ type: 'api', name: 'create_user', params: PARAMS });

    expect(result).toEqual({ success: true, data: { id: 'u1' } });
    expect(api).toHaveBeenCalledTimes(2);
    expect(sent[0]).toEqual({ email: 'taken@example.com', name: 'Ada', stale_key: 'from-run-1' });
    // The second run does not inherit the first run's keys.
    expect(sent[1]).toEqual({ email: 'ada@example.com', name: 'Ada' });
    expect(toast.mock.calls.map(([, o]) => o?.type)).toEqual(['error', 'success']);
  });

  it('keeps a row stash (`_rowRecord`) on every run of the session', async () => {
    const sent: Array<Record<string, any>> = [];
    runner.registerHandler('api', async (action: any) => {
      sent.push({ ...action.params });
      return sent.length === 1 ? { success: false, error: REFUSAL } : { success: true };
    });
    runner.setParamCollectionHandler(async (_p, _a, _i, run) => {
      await run!({ email: 'a@x.io' });
      await run!({ email: 'b@x.io' });
      return { email: 'b@x.io' };
    });

    const row = { id: 'row-1' };
    await runner.execute({
      type: 'api',
      name: 'invite',
      actionParams: PARAMS,
      params: { _rowRecord: row },
    } as any);

    expect(sent).toEqual([
      { _rowRecord: row, email: 'a@x.io' },
      { _rowRecord: row, email: 'b@x.io' },
    ]);
  });

  it('cancelling after a refusal is a cancel, and dispatches nothing more (control for H4)', async () => {
    const api = vi.fn(async (): Promise<ActionResult> => ({ success: false, error: REFUSAL }));
    runner.registerHandler('api', api);
    runner.setParamCollectionHandler(async (_p, _a, _i, run) => {
      await run!({ email: 'ada@example.com' });
      return null;
    });

    const result = await runner.execute({ type: 'api', name: 'create_user', params: PARAMS });

    expect(result).toEqual({ success: false, error: 'Action cancelled by user (params)' });
    expect(api).toHaveBeenCalledTimes(1);
    // The refusal's own toast, and no second one for the cancel.
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('a `run` while one is in flight dispatches nothing new', async () => {
    const gate = deferred<ActionResult>();
    const api = vi.fn(() => gate.promise);
    runner.registerHandler('api', api);
    runner.setParamCollectionHandler(async (_p, _a, _i, run) => {
      const a = run!({ email: 'one@x.io' });
      const b = run!({ email: 'two@x.io' });
      expect(b).toBe(a);
      gate.resolve({ success: true });
      await a;
      return { email: 'one@x.io' };
    });

    const result = await runner.execute({ type: 'api', name: 'create_user', params: PARAMS });

    expect(api).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
  });

  it('a dispatch that throws is a refused run, not a rejection', async () => {
    runner.registerHandler('api', async () => { throw new Error('socket hang up'); });
    let seen: ActionResult | undefined;
    runner.setParamCollectionHandler(async (_p, _a, _i, run) => {
      seen = await run!({ email: 'ada@example.com' });
      return null;
    });

    await runner.execute({ type: 'api', name: 'create_user', params: PARAMS });

    expect(seen).toEqual({ success: false, error: 'socket hang up' });
    expect(toast).toHaveBeenCalledWith('socket hang up', expect.objectContaining({ type: 'error' }));
  });

  it('control — a handler that never calls `run` still gets exactly one dispatch with the values it resolves', async () => {
    const api = vi.fn(async (): Promise<ActionResult> => ({ success: false, error: REFUSAL }));
    runner.registerHandler('api', api);
    const handler = vi.fn(async () => ({ email: 'ada@example.com' }));
    runner.setParamCollectionHandler(handler);

    const result = await runner.execute({ type: 'api', name: 'create_user', params: PARAMS });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(typeof (handler.mock.calls[0] as unknown[])[3]).toBe('function');
    expect(api).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: false, error: REFUSAL });
    expect(toast).toHaveBeenCalledTimes(1);
  });
});
