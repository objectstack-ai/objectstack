/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27948 (ruling A, step 1) — the three action-copy keys that read
 * `${…}` holes also fill ADR-0032 `{{ }}` holes: the param dialog's
 * `description`, each param's `helpText`, and an `outcomeMessages` entry.
 *
 * Ruling A makes all five copy keys `template` slots, renderer first: the
 * console fills `{{ }}` here before the spec closes these slots to `${…}`
 * (step 2), so `${…}` keeps working through the transition. Measured before
 * this change: the spec tells an author whose action has params to move the
 * confirm question from `confirmText` to `description`, and there the same
 * `{{ record.x }}` hole printed raw, from the record header and from a row.
 *
 * One dialect per sentence, the rule `confirmText` / `successMessage` kept
 * through their own transition: a sentence with a `{{ }}` hole is filled by
 * the template engine alone (a `${…}` token in it stays text); one with none
 * keeps its `${…}` reading.
 *
 * Every pin reads what the host is HANDED — the text the param dialog draws
 * (through the `interpolate` the param-collection handler receives) and the
 * text the toast handler receives — through the real runner and
 * `@objectstack/formula`'s `templateEngine`. Each dialog pin drives both doors:
 *   - header — a runner whose context carries `record`;
 *   - row    — a list page's runner (no `record`), the dispatch carrying the
 *              row under `params._rowRecord`, as `ObjectGrid` stashes it.
 */
import { describe, it, expect, vi } from 'vitest';
import { ActionRunner, type ActionDef, type ActionResult } from '../ActionRunner';

const ROW = { id: 'acct_1', display_name: 'Acme', amount: 1250 };

const headerDoor = () => new ActionRunner({ objectName: 'crm_account', record: { ...ROW } });
const listDoor = () => new ActionRunner({ objectName: 'crm_account' });
const asRow = (def: ActionDef): ActionDef => ({ ...def, params: { _rowRecord: { ...ROW } } });
const DOORS: Array<[string, () => ActionRunner, (def: ActionDef) => ActionDef]> = [
  ['header', headerDoor, (def) => def],
  ['row', listDoor, asRow],
];

/** An action that collects one param, so the param dialog opens. */
const withDialogCopy = (description: string, helpText: string): ActionDef => ({
  name: 'pause_account',
  label: 'Pause',
  description,
  actionParams: [{ name: 'reason', label: 'Reason', type: 'text', helpText }],
  onClick: () => {},
});

/** What the dialog draws: `description` and the param's `helpText`, run through `interpolate`. */
async function dialogCopy(runner: ActionRunner, def: ActionDef): Promise<{ description: string; helpText: string }> {
  let drawn: { description: string; helpText: string } | undefined;
  runner.setParamCollectionHandler(async (params, action, interpolate) => {
    expect(interpolate).toBeTypeOf('function');
    drawn = {
      description: interpolate!(String(action?.description)),
      helpText: interpolate!(String(params[0].helpText)),
    };
    return null;
  });
  await runner.execute(def);
  expect(drawn).toBeDefined();
  return drawn!;
}

/** The confirm handler's argument for a param-less action carrying `confirmText`. */
async function confirmTextFor(runner: ActionRunner, def: ActionDef): Promise<string> {
  const confirm = vi.fn().mockResolvedValue(false);
  runner.setConfirmHandler(confirm);
  await runner.execute(def);
  expect(confirm).toHaveBeenCalledTimes(1);
  return confirm.mock.calls[0][0] as string;
}

describe('param dialog `description` and `helpText` fill {{ }} holes and keep ${…} (objectstack#27948)', () => {
  for (const [door, runnerFor, dispatch] of DOORS) {
    it(`${door} door — the confirm question moved from confirmText reads the same in description and helpText`, async () => {
      const question = 'Pause {{ record.display_name }}?';
      const asConfirm = await confirmTextFor(runnerFor(), dispatch({ name: 'pause_account', confirmText: question, onClick: () => {} }));
      expect(asConfirm).toBe('Pause Acme?');
      const drawn = await dialogCopy(runnerFor(), dispatch(withDialogCopy(question, `Why ${question.toLowerCase()}`)));
      expect(drawn).toEqual({ description: asConfirm, helpText: 'Why pause Acme?' });
    });

    it(`${door} door — a \${record.x} hole still fills`, async () => {
      const drawn = await dialogCopy(runnerFor(), dispatch(withDialogCopy('Pausing ${record.display_name}', 'Why pause ${record.display_name}?')));
      expect(drawn).toEqual({ description: 'Pausing Acme', helpText: 'Why pause Acme?' });
    });

    it(`${door} door — an unknown {{ x }} hole reads as it does in confirmText`, async () => {
      const sentence = 'Pause {{ nothing_bound }} now';
      const asConfirm = await confirmTextFor(runnerFor(), dispatch({ name: 'pause_account', confirmText: sentence, onClick: () => {} }));
      expect(asConfirm).not.toContain('{{');
      const drawn = await dialogCopy(runnerFor(), dispatch(withDialogCopy(sentence, sentence)));
      expect(drawn).toEqual({ description: asConfirm, helpText: asConfirm });
    });
  }

  it('a formatter hole renders through the same engine as confirmText', async () => {
    const drawn = await dialogCopy(headerDoor(), withDialogCopy('Refund {{ record.amount | currency:USD }}', 'Up to {{ record.amount | currency:USD }}'));
    expect(drawn).toEqual({ description: 'Refund $1,250.00', helpText: 'Up to $1,250.00' });
  });

  it('one dialect per sentence: with a {{ }} hole, a ${…} token in the same sentence stays text', async () => {
    const drawn = await dialogCopy(headerDoor(), withDialogCopy('{{ record.display_name }} costs ${record.amount}', '{{ record.display_name }}'));
    expect(drawn.description).toBe('Acme costs ${record.amount}');
  });

  it('a value filled into a {{ }} hole is never read again as ${…}', async () => {
    const runner = new ActionRunner({ objectName: 'crm_account', record: { ...ROW, display_name: '${record.amount}' } });
    const drawn = await dialogCopy(runner, withDialogCopy('Pause {{ record.display_name }}?', 'x'));
    expect(drawn.description).toBe('Pause ${record.amount}?');
  });
});

describe('`outcomeMessages` fills {{ }} holes and keeps ${result.*} (objectstack#27948)', () => {
  const answer: ActionResult = { success: true, data: { outcome: 'paused', name: 'prod', amount: 1250 } };
  const toastFor = async (def: ActionDef, runner: ActionRunner = listDoor()): Promise<string> => {
    const toast = vi.fn();
    runner.setToastHandler(toast);
    runner.registerHandler('custom', async () => answer);
    await runner.execute({ name: 'pause_environment', type: 'custom' as never, ...def } as ActionDef);
    const calls = toast.mock.calls.filter(([, options]) => options?.type === 'success');
    expect(calls).toHaveLength(1);
    return calls[0][0] as string;
  };

  it('a {{ result.x }} hole fills from the handler payload', async () => {
    expect(await toastFor({ outcomeMessages: { paused: 'Environment {{ result.name }} paused' } } as ActionDef))
      .toBe('Environment prod paused');
  });

  it('a {{ record.x }} hole fills from the row the action ran against, as successMessage does', async () => {
    expect(await toastFor(asRow({ outcomeMessages: { paused: '{{ record.display_name }} paused' } } as ActionDef)))
      .toBe('Acme paused');
  });

  it('a formatter hole renders', async () => {
    expect(await toastFor({ outcomeMessages: { paused: 'Held {{ result.amount | currency:USD }}' } } as ActionDef))
      .toBe('Held $1,250.00');
  });

  it('a ${result.x} hole still fills', async () => {
    expect(await toastFor({ outcomeMessages: { paused: 'Environment ${result.name} paused' } } as ActionDef))
      .toBe('Environment prod paused');
  });

  it('an unknown {{ x }} hole reads as it does in successMessage', async () => {
    const sentence = 'Paused {{ nothing_bound }} now';
    const asSuccess = await toastFor({ successMessage: sentence } as ActionDef);
    expect(asSuccess).not.toContain('{{');
    expect(await toastFor({ outcomeMessages: { paused: sentence } } as ActionDef)).toBe(asSuccess);
  });

  it('one dialect per sentence: with a {{ }} hole, a ${…} token in the same sentence stays text', async () => {
    expect(await toastFor({ outcomeMessages: { paused: '{{ result.name }} at ${result.amount}' } } as ActionDef))
      .toBe('prod at ${result.amount}');
  });
});
