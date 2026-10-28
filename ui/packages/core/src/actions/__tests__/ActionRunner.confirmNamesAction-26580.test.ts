/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26580 — a declared action's confirm dialog names the action.
 *
 * Measured before this card: the runner called its `ConfirmationHandler` with
 * the message alone, so the console's `ActionConfirmDialog` always fell back
 * to its generic `actionConfirm.title` / `.confirm` chrome, and a
 * `variant: 'danger'` action was confirmed through a neutral button. The
 * runner now hands the handler's existing `options` bag the action's own
 * label (title and confirm button) and its danger variant (`destructive`).
 */
import { describe, it, expect, vi } from 'vitest';
import { ActionRunner, type ActionDef } from '../ActionRunner';

async function confirmCallFor(def: ActionDef): Promise<unknown[]> {
  const runner = new ActionRunner({ objectName: 'crm_deal', record: { id: 'd1' } });
  const confirm = vi.fn().mockResolvedValue(false);
  runner.setConfirmHandler(confirm);
  const result = await runner.execute(def);
  expect(result.success).toBe(false);
  expect(confirm).toHaveBeenCalledTimes(1);
  return confirm.mock.calls[0];
}

describe('the confirm dialog names the action it confirms (objectstack#26580)', () => {
  it('the label titles the dialog and labels the confirm button', async () => {
    expect(await confirmCallFor({
      name: 'close_won',
      label: 'Close as won',
      onClick: () => {},
      confirmText: 'Mark this deal as won?',
    })).toEqual(['Mark this deal as won?', { title: 'Close as won', confirmText: 'Close as won' }]);
  });

  it('a danger action paints the confirm button destructive', async () => {
    expect(await confirmCallFor({
      name: 'purge',
      label: 'Purge history',
      variant: 'danger',
      onClick: () => {},
      confirmText: 'This cannot be undone.',
    })).toEqual([
      'This cannot be undone.',
      { title: 'Purge history', confirmText: 'Purge history', destructive: true },
    ]);
  });

  it('a nameless danger action still asks destructively, under the host\'s own title', async () => {
    expect(await confirmCallFor({
      variant: 'danger',
      onClick: () => {},
      confirmText: 'Really?',
    })).toEqual(['Really?', { destructive: true }]);
  });

  it('CONTROL: an action with neither a label nor the danger variant is asked with the message alone', async () => {
    expect(await confirmCallFor({
      variant: 'primary',
      onClick: () => {},
      confirmText: 'Proceed?',
    })).toEqual(['Proceed?']);
  });

  it('a cancel still stops the run', async () => {
    const onClick = vi.fn();
    await confirmCallFor({ label: 'Archive', variant: 'danger', onClick, confirmText: 'Archive it?' });
    expect(onClick).not.toHaveBeenCalled();
  });
});
