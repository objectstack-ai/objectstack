/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11080 — an undoable update whose action declared no `label` names
 * its operation by the object it acted on, with no English verb.
 *
 * The description used to fall back to `Undo <object>`. The console's global
 * Ctrl+Z / Ctrl+Shift+Z toast now supplies the verb itself, from a pack key
 * (`actions.undoneOperation` / `actions.redoneOperation`), so the fallback's
 * own `Undo ` doubled it on the undo toast and was wrong on the redo toast
 * (`重做：Undo task`). The runner renders no toast, so this pins the operation
 * it pushes: the description is exactly the object identifier the runner holds,
 * and an authored label still wins byte for byte. The toast those descriptions
 * reach is pinned in app-shell's `AppContent.undoFallbackObject-11080`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ActionRunner, type ActionDef } from '../ActionRunner';
import { globalUndoManager } from '../UndoManager';

afterEach(() => {
  vi.restoreAllMocks();
  globalUndoManager.clear();
});

/**
 * A runner whose `script` dispatch answers success, so the update "ran". The
 * runner registers an undoable result on the stack only from its success
 * toast, so a toast handler is set.
 */
function wireRunner(objectName = 'task') {
  const runner = new ActionRunner({ objectName });
  runner.setToastHandler(() => {});
  runner.registerHandler('script', vi.fn(async () => ({ success: true })));
  return runner;
}

/** An undoable update on a row that carries the field it writes. */
function closeTask(extra: Partial<ActionDef> = {}): ActionDef {
  return {
    type: 'script',
    name: 'close_task',
    operation: 'update',
    undoable: true,
    patch: { status: 'closed' },
    params: { _rowRecord: { id: 't_1', status: 'open' } },
    ...extra,
  } as ActionDef;
}

describe('undoable update — the description of an unlabelled action names the object (objectui#11080)', () => {
  it('an action with no label is described by the runner\'s object, and the operation on the stack says the same', async () => {
    const result = await wireRunner('task').execute(closeTask());

    expect(result.undo?.description).toBe('task');
    expect(globalUndoManager.peekUndo()?.description).toBe('task');
  });

  it('an empty authored label falls to the same object identifier', async () => {
    const result = await wireRunner('task').execute(closeTask({ label: '' }));

    expect(result.undo?.description).toBe('task');
  });

  it('an object the action itself names wins over the runner\'s context object', async () => {
    const result = await wireRunner('task').execute(closeTask({ objectName: 'crm_call' }));

    expect(result.undo?.description).toBe('crm_call');
    expect(result.undo?.objectName).toBe('crm_call');
  });

  it('control: an authored label is the description, byte for byte', async () => {
    const label = '标记为完成 & notify "owner"';
    const result = await wireRunner('task').execute(closeTask({ label }));

    expect(result.undo?.description).toBe(label);
  });
});
