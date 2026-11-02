/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28879 — the confirm dialog's dismiss button says the action's
 * `cancelText`. The runner hands the `ConfirmationHandler`'s existing `options`
 * bag the string the dispatching surface resolved (`useActionTextLocalizer`),
 * which the console's `ActionConfirmDialog` draws over its generic
 * `actionConfirm.cancel`. Absent, the bag carries no `cancelText` and the host's
 * own "Cancel" stands.
 */
import { describe, it, expect, vi } from 'vitest';
import { ActionRunner, type ActionDef } from '../ActionRunner';

async function confirmCallFor(def: ActionDef): Promise<unknown[]> {
  const runner = new ActionRunner({ objectName: 'sys_invitation', record: { id: 'inv1' } });
  const confirm = vi.fn().mockResolvedValue(false);
  runner.setConfirmHandler(confirm);
  const result = await runner.execute(def);
  expect(result.success).toBe(false);
  expect(confirm).toHaveBeenCalledTimes(1);
  return confirm.mock.calls[0];
}

describe('the confirm dialog labels its dismiss button with the action\'s cancelText (objectstack#28879)', () => {
  it('a declared cancelText rides the options bag beside the label', async () => {
    expect(await confirmCallFor({
      name: 'cancel_invitation',
      label: 'Cancel Invitation',
      onClick: () => {},
      confirmText: 'Cancel this invitation?',
      cancelText: 'Keep invitation',
    })).toEqual([
      'Cancel this invitation?',
      { title: 'Cancel Invitation', confirmText: 'Cancel Invitation', cancelText: 'Keep invitation' },
    ]);
  });

  it('a nameless, label-less action with only a cancelText still hands it on', async () => {
    expect(await confirmCallFor({
      onClick: () => {},
      confirmText: 'Discard the draft?',
      cancelText: 'Keep editing',
    })).toEqual(['Discard the draft?', { cancelText: 'Keep editing' }]);
  });

  it('CONTROL: no cancelText, no key in the bag — the host keeps its own Cancel', async () => {
    const [, options] = await confirmCallFor({
      name: 'cancel_invitation',
      label: 'Cancel Invitation',
      onClick: () => {},
      confirmText: 'Cancel this invitation?',
    });
    expect(options).toEqual({ title: 'Cancel Invitation', confirmText: 'Cancel Invitation' });
    expect(options).not.toHaveProperty('cancelText');
  });

  it('an empty string is no label: the host keeps its own Cancel', async () => {
    expect(await confirmCallFor({
      onClick: () => {},
      confirmText: 'Proceed?',
      cancelText: '',
    })).toEqual(['Proceed?']);
  });

  it('dismissing still stops the run', async () => {
    const onClick = vi.fn();
    await confirmCallFor({ label: 'Cancel Invitation', onClick, confirmText: 'Sure?', cancelText: 'Keep invitation' });
    expect(onClick).not.toHaveBeenCalled();
  });
});
