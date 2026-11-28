/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * `type: 'ask_ai'` — the console executor (objectstack#37142, ADR-0160 D7).
 *
 * The action focuses the host's in-app assistant on the record it runs on and
 * expands it, through the handler the host installs
 * (`setAssistantFocusHandler`). Pinned here:
 *  1. A click hands the record — the page record, a row a row surface stashed,
 *     the one selected row — to the handler, once, and nothing else runs: no
 *     server dispatch, no registered handler, no fetch, no success toast.
 *  2. With no record, or several selected, the launch is refused before the
 *     `confirmText` asks anything, and the handler is not called.
 *  3. With no handler installed the action is not drawn (`drawsAction`,
 *     `ActionEngine.getActionsForLocation`) and a launch that reaches the
 *     runner anyway is refused, not reported done.
 *  4. Other actions are drawn whatever the assistant answer is.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ActionSchema } from '@objectstack/spec/ui';
import { ActionRunner, isAskAiAction, type ActionDef } from '../ActionRunner';
import { ActionEngine } from '../ActionEngine';

const ASK: ActionDef = { name: 'ask_about_account', label: 'Ask AI', type: 'ask_ai', locations: ['record_page'] };

function hostRunner(context: Record<string, unknown> = {}) {
  const runner = new ActionRunner({ objectName: 'account', ...context });
  const focus = vi.fn();
  const toast = vi.fn();
  const confirm = vi.fn(async () => true);
  const script = vi.fn(async () => ({ success: true }));
  runner.setAssistantFocusHandler(focus);
  runner.setToastHandler(toast);
  runner.setConfirmHandler(confirm);
  // A console host registers its server dispatch; `ask_ai` must never reach it.
  runner.registerHandler('script', script);
  return { runner, focus, toast, confirm, script };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ask_ai — the executor (ADR-0160 D7)', () => {
  it('is the type the spec parses, with no target', () => {
    const parsed = ActionSchema.parse({ ...ASK });
    expect(parsed.type).toBe('ask_ai');
    expect(isAskAiAction(parsed)).toBe(true);
  });

  it('hands the page record to the assistant, once, and sends nothing', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { runner, focus, toast, script } = hostRunner({ record: { id: 'acc_1', name: 'Acme' } });

    const result = await runner.execute({ ...ASK });

    expect(result.success).toBe(true);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledWith({ object: 'account', id: 'acc_1' });
    expect(script).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    // Opening the assistant is not an outcome to announce.
    expect(toast).not.toHaveBeenCalled();
  });

  it('reads the row a row surface stashed, by `recordIdField`', async () => {
    const { runner, focus } = hostRunner({ record: { id: 'page_record' } });
    await runner.execute({ ...ASK, recordIdField: 'uid', params: { _rowRecord: { id: 'x', uid: 'row_7' } } });
    expect(focus).toHaveBeenCalledWith({ object: 'account', id: 'row_7' });
  });

  it('reads the record of a dispatch scoped to another object (a related-list row)', async () => {
    const { runner, focus } = hostRunner({ record: { id: 'acc_1' } });
    await runner.execute({ ...ASK }, { objectName: 'contact', record: { id: 'con_3' } });
    expect(focus).toHaveBeenCalledWith({ object: 'contact', id: 'con_3' });
  });

  it('reads the page record by `recordIdField` too', async () => {
    const { runner, focus } = hostRunner({ record: { id: 'internal', uid: 'acc_uid' } });
    await runner.execute({ ...ASK, recordIdField: 'uid' });
    expect(focus).toHaveBeenCalledWith({ object: 'account', id: 'acc_uid' });
  });

  it('reads the one selected row in a list header', async () => {
    const { runner, focus } = hostRunner({ selectedRecords: [{ id: 'acc_9' }] });
    await runner.execute({ ...ASK });
    expect(focus).toHaveBeenCalledWith({ object: 'account', id: 'acc_9' });
  });

  it('shows a declared successMessage, as a navigation does', async () => {
    const { runner, toast } = hostRunner({ record: { id: 'acc_1' } });
    await runner.execute({ ...ASK, successMessage: 'Assistant opened' });
    expect(toast).toHaveBeenCalledWith('Assistant opened', expect.objectContaining({ type: 'success' }));
  });
});

describe('ask_ai — refused before anything is asked', () => {
  it('refuses with no record, before the confirmText', async () => {
    const { runner, focus, confirm } = hostRunner();
    const result = await runner.execute({ ...ASK, confirmText: 'Open the assistant?' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('This action runs on a single record — select a row first.');
    expect(confirm).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
    expect(runner.launchRefusal({ ...ASK })).toBe('This action runs on a single record — select a row first.');
  });

  it('refuses several selected rows rather than guessing between them', async () => {
    const { runner, focus } = hostRunner({ selectedRecords: [{ id: 'a' }, { id: 'b' }] });
    const result = await runner.execute({ ...ASK });
    expect(result.success).toBe(false);
    expect(result.error).toBe('This action runs on a single record — select exactly one row.');
    expect(focus).not.toHaveBeenCalled();
  });

  it('refuses with no object named', async () => {
    const runner = new ActionRunner({ record: { id: 'acc_1' } });
    const focus = vi.fn();
    runner.setAssistantFocusHandler(focus);
    const result = await runner.execute({ ...ASK });
    expect(result.success).toBe(false);
    expect(focus).not.toHaveBeenCalled();
  });
});

describe('ask_ai — absent without an in-app assistant', () => {
  it('is not drawn on a runner with no handler, and drawn once one is set', () => {
    const runner = new ActionRunner({ objectName: 'account' });
    expect(runner.drawsAction(ASK)).toBe(false);
    runner.setAssistantFocusHandler(() => {});
    expect(runner.drawsAction(ASK)).toBe(true);
    runner.setAssistantFocusHandler(null);
    expect(runner.drawsAction(ASK)).toBe(false);
  });

  it('draws every other action whatever the assistant answer is', () => {
    const runner = new ActionRunner();
    for (const action of [{ type: 'script', target: 'x' }, { type: 'url', target: '/x' }, { name: 'typeless' }, null]) {
      expect(runner.drawsAction(action)).toBe(true);
    }
  });

  it('reads the legacy `actionType` spelling as the resolver does', () => {
    const runner = new ActionRunner();
    expect(runner.drawsAction({ actionType: 'ask_ai' })).toBe(false);
  });

  it('refuses a launch that reaches the runner anyway, before the confirmText', async () => {
    const runner = new ActionRunner({ objectName: 'account', record: { id: 'acc_1' } });
    const confirm = vi.fn(async () => true);
    runner.setConfirmHandler(confirm);
    const result = await runner.execute({ ...ASK, confirmText: 'Open?' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('in-app assistant is not available');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('is left out of ActionEngine.getActionsForLocation until the runner has an assistant', () => {
    const engine = new ActionEngine({ objectName: 'account' });
    engine.registerActions([{ ...ASK }, { name: 'edit', type: 'script', target: 'edit', locations: ['record_page'] }]);
    expect(engine.getActionsForLocation('record_page').map((a) => a.name)).toEqual(['edit']);
    engine.getRunner().setAssistantFocusHandler(() => {});
    expect(engine.getActionsForLocation('record_page').map((a) => a.name)).toEqual(['ask_about_account', 'edit']);
  });

  it('a scoped dispatch keeps the host assistant', async () => {
    const { runner, focus } = hostRunner();
    await runner.execute({ ...ASK }, { record: { id: 'acc_2' } });
    expect(focus).toHaveBeenCalledWith({ object: 'account', id: 'acc_2' });
  });
});

describe('ask_ai — never a bulk action (one record, not one per row)', () => {
  it('is refused for a selection by `bulkRefusal`, and nothing else is', () => {
    const { runner } = hostRunner();
    expect(runner.bulkRefusal({ ...ASK })).toBe('This action runs on a single record — select exactly one row.');
    expect(runner.bulkRefusal({ name: 'close', type: 'script', target: 'close' })).toBeUndefined();
  });

  it('is left out of ActionEngine.getBulkActions and refused by executeBulk, even with an assistant', async () => {
    const engine = new ActionEngine({ objectName: 'account' });
    const focus = vi.fn();
    engine.getRunner().setAssistantFocusHandler(focus);
    engine.registerAction({ ...ASK }, { bulkEnabled: true });
    engine.registerAction({ name: 'close', type: 'script', target: 'close' }, { bulkEnabled: true });
    expect(engine.getBulkActions().map((a) => a.name)).toEqual(['close']);
    const outcome = await engine.executeBulk('ask_about_account', [{ id: 'a' }, { id: 'b' }]);
    expect(outcome.succeeded).toBe(0);
    expect(outcome.results[0]).toMatchObject({ success: false });
    expect(focus).not.toHaveBeenCalled();
  });
});
