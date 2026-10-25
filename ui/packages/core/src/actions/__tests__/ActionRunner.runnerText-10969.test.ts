/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10969 — the runner's other own text goes through the host's
 * translator, the same seam objectui#10900 opened for the default success
 * toast (`setTranslator`, pinned in `ActionRunner.defaultSuccessToast-10900`).
 *
 * Under a zh-CN session three more strings the runner writes itself still read
 * English: the error toast when the error that reached it carries no readable
 * message, a parallel chain's error when no failed action reported one, and
 * the Undo label of an undoable success toast (the runner used to hand the
 * toast handler `undo: {}`, so each handler fell back to its own English
 * `'Undo'`). Each is now asked of the translator with its pack key and its
 * English source; an author's `errorMessage` and an action's own error are
 * never asked. The React owners that install the session's `t` are pinned in
 * `@object-ui/react`'s `ActionProvider.runnerText-10969` suite.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { ActionRunner, type ActionResult, type ToastHandler } from '../ActionRunner';
import { globalUndoManager, type UndoableOperation } from '../UndoManager';

/** A translator that answers every key it knows in zh, and records the asks. */
const ZH: Record<string, string> = {
  'actions.failed': '操作失败',
  'actions.parallelFailed': '一个或多个并行操作失败',
  'actions.undo': '撤销',
};

const UNDO: UndoableOperation = {
  id: 'undo-task-1',
  type: 'update',
  objectName: 'task',
  recordId: '1',
  timestamp: 0,
  description: 'Close',
  undoData: { status: 'open' },
  redoData: { status: 'closed' },
};

describe('ActionRunner — the runner text beside the success toast is translatable (objectui#10969)', () => {
  let runner: ActionRunner;
  let toast: Mock<ToastHandler>;
  let translate: Mock<(key: string, options: { defaultValue: string }) => string>;

  beforeEach(() => {
    runner = new ActionRunner({});
    toast = vi.fn();
    runner.setToastHandler(toast);
    translate = vi.fn((key: string, options: { defaultValue: string }) => ZH[key] ?? options.defaultValue);
  });
  afterEach(() => {
    globalUndoManager.clear();
  });

  describe('the error toast when the error carries no readable message', () => {
    // A handler bug can leak a non-string error with no `message` through
    // `result.error`; the runner's single toast sink coerces it to its own text.
    const LEAKS_AN_OBJECT = async (): Promise<ActionResult> =>
      ({ success: false, error: { code: 'E_UNKNOWN' } as unknown as string });

    it('with no translator installed, is the English source', async () => {
      runner.registerHandler('script', LEAKS_AN_OBJECT);
      await runner.execute({ type: 'script', name: 'sync' });
      expect(toast).toHaveBeenCalledWith('Action failed', expect.objectContaining({ type: 'error' }));
    });

    it("with a translator, is its answer for 'actions.failed', asked with the English default", async () => {
      runner.setTranslator(translate);
      runner.registerHandler('script', LEAKS_AN_OBJECT);
      await runner.execute({ type: 'script', name: 'sync' });
      expect(translate).toHaveBeenCalledWith('actions.failed', { defaultValue: 'Action failed' });
      expect(toast).toHaveBeenCalledWith('操作失败', expect.objectContaining({ type: 'error' }));
    });

    it("an action's own error message and an author's errorMessage stay verbatim; the translator is never asked", async () => {
      runner.setTranslator(translate);
      runner.registerHandler('script', async () => ({ success: false, error: 'Quota exceeded' }));
      await runner.execute({ type: 'script', name: 'sync' });
      await runner.execute({ type: 'script', name: 'sync', errorMessage: 'Sync did not run' });
      expect(toast).toHaveBeenNthCalledWith(1, 'Quota exceeded', expect.objectContaining({ type: 'error' }));
      expect(toast).toHaveBeenNthCalledWith(2, 'Sync did not run', expect.objectContaining({ type: 'error' }));
      expect(translate).not.toHaveBeenCalled();
    });
  });

  describe("a parallel chain's error when no failed action reported one", () => {
    const FAILS_SILENTLY = async (): Promise<ActionResult> => ({ success: false });

    it('with no translator installed, is the English source', async () => {
      runner.registerHandler('script', FAILS_SILENTLY);
      const result = await runner.executeChain([{ type: 'script', name: 'a' }, { type: 'script', name: 'b' }], 'parallel');
      expect(result).toEqual({ success: false, error: 'One or more parallel actions failed' });
    });

    it("with a translator, is its answer for 'actions.parallelFailed'", async () => {
      runner.setTranslator(translate);
      runner.registerHandler('script', FAILS_SILENTLY);
      const result = await runner.executeChain([{ type: 'script', name: 'a' }, { type: 'script', name: 'b' }], 'parallel');
      expect(translate).toHaveBeenCalledWith('actions.parallelFailed', {
        defaultValue: 'One or more parallel actions failed',
      });
      expect(result).toEqual({ success: false, error: '一个或多个并行操作失败' });
    });

    it("a failed action's own error is the chain's error, verbatim", async () => {
      runner.setTranslator(translate);
      runner.registerHandler('script', async () => ({ success: false, error: 'Quota exceeded' }));
      const result = await runner.executeChain([{ type: 'script', name: 'a' }], 'parallel');
      expect(result).toEqual({ success: false, error: 'Quota exceeded' });
      expect(translate).not.toHaveBeenCalledWith('actions.parallelFailed', expect.anything());
    });
  });

  describe('the Undo label of an undoable success toast', () => {
    const UNDOABLE = async (): Promise<ActionResult> => ({ success: true, undo: { ...UNDO } });

    it("with no translator installed, the runner hands the handler the English 'Undo'", async () => {
      runner.registerHandler('script', UNDOABLE);
      await runner.execute({ type: 'script', name: 'close_task', successMessage: 'Closed' });
      expect(toast).toHaveBeenCalledWith('Closed', expect.objectContaining({ type: 'success', undo: { label: 'Undo' } }));
    });

    it("with a translator, the label is its answer for 'actions.undo'", async () => {
      runner.setTranslator(translate);
      runner.registerHandler('script', UNDOABLE);
      await runner.execute({ type: 'script', name: 'close_task', successMessage: 'Closed' });
      expect(translate).toHaveBeenCalledWith('actions.undo', { defaultValue: 'Undo' });
      expect(toast).toHaveBeenCalledWith('Closed', expect.objectContaining({ type: 'success', undo: { label: '撤销' } }));
    });

    it('an action with nothing to undo gets no Undo affordance and no label is asked for', async () => {
      runner.setTranslator(translate);
      runner.registerHandler('script', async () => ({ success: true }));
      await runner.execute({ type: 'script', name: 'close_task', successMessage: 'Closed' });
      expect(toast).toHaveBeenCalledWith('Closed', expect.objectContaining({ type: 'success', undo: undefined }));
      expect(translate).not.toHaveBeenCalledWith('actions.undo', expect.anything());
    });

    it('an empty answer from the translator falls back to the English source, not an empty label', async () => {
      runner.setTranslator(() => '');
      runner.registerHandler('script', UNDOABLE);
      await runner.execute({ type: 'script', name: 'close_task', successMessage: 'Closed' });
      expect(toast).toHaveBeenCalledWith('Closed', expect.objectContaining({ undo: { label: 'Undo' } }));
    });
  });
});
