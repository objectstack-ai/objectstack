/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ActionRunner — generic `script` action must await a Promise-returning
 * formula function before reporting success, so the success toast reflects
 * the underlying write actually completing rather than firing as soon as the
 * (synchronous) expression evaluation returned a still-pending Promise.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { ActionRunner, type ActionDef, type ToastHandler } from '../ActionRunner';

describe('ActionRunner - script action awaits a Promise-returning formula', () => {
  let runner: ActionRunner;
  // Typed with `setToastHandler`'s own signature — see the note in
  // `ActionRunner.resultDialog.test.ts` for what `ReturnType<typeof vi.fn>`
  // degrades to (objectui#4040).
  let toast: Mock<ToastHandler>;

  beforeEach(() => {
    runner = new ActionRunner({});
    toast = vi.fn();
    runner.setToastHandler(toast);
  });

  it('resolves `data` to the awaited value, not a pending Promise, and toasts only after it settles', async () => {
    let resolveWrite: (v: string) => void;
    const write = new Promise<string>((resolve) => { resolveWrite = resolve; });
    // Formula names are registered case-insensitively (stored upper-cased),
    // so the expression must call it by that same upper-cased name.
    runner.getEvaluator().registerFunction('doWrite', () => write);

    const action: ActionDef = { type: 'script', target: 'DOWRITE()' };
    const pending = runner.execute(action);

    // The write hasn't resolved yet — no toast should have fired.
    await Promise.resolve();
    expect(toast).not.toHaveBeenCalled();

    resolveWrite!('saved');
    const result = await pending;

    expect(result.success).toBe(true);
    expect(result.data).toBe('saved'); // the resolved value, not the Promise itself
    expect(toast).toHaveBeenCalledWith('Action completed successfully', expect.objectContaining({ type: 'success' }));
  });

  it('surfaces a rejected write as success:false instead of a false-positive success toast', async () => {
    runner.getEvaluator().registerFunction('doFailingWrite', () => Promise.reject(new Error('write failed')));
    const action: ActionDef = { type: 'script', target: 'DOFAILINGWRITE()' };

    const result = await runner.execute(action);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/write failed/);
    expect(toast).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'success' }));
  });
});
