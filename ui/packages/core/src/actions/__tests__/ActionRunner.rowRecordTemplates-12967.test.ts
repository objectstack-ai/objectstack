/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12967 — a row action's templates read the row as `record`, the way
 * the record header's do.
 *
 * The record header binds `record` in the runner's context (`RecordDetailView`'s
 * `ActionProvider`). A list row binds nothing there: `ObjectGrid` dispatches a
 * row action as `{ ...def, params: { _rowRecord: row } }` through the shared
 * runner. The runner read `confirmText` in its own context only, so one
 * action's `${record.display_name}` read filled from the header and raw from a
 * row. The param dialog's `description` / `helpText` were never filled on
 * either door. (`confirmText` has read `{{ }}` holes only since objectui#13476;
 * the row is still its `record`.)
 *
 * Each pin drives the SAME action through both doors:
 *   - header — a runner whose context carries `record`, dispatch without a row;
 *   - row    — a runner whose context carries no `record` (a list page), the
 *              dispatch carrying the row exactly as `ObjectGrid` stashes it.
 */
import { describe, it, expect, vi } from 'vitest';
import { ActionRunner, type ActionDef } from '../ActionRunner';

const ROW = { id: 'env_1', display_name: 'Acme' };

const PAUSE: ActionDef = {
  name: 'pause_environment',
  label: 'Pause',
  confirmText: 'Pause {{ record.display_name }}?',
  onClick: () => {},
};

/** The record header: `record` bound in the runner's context. */
const headerDoor = () => new ActionRunner({ objectName: 'sys_environment', record: { ...ROW } });
/** A list page: the runner's context names the object, not a record. */
const listDoor = () => new ActionRunner({ objectName: 'sys_environment' });
/** `ObjectGrid`'s row dispatch shape: the row under `params._rowRecord`. */
const asRow = (def: ActionDef, row: Record<string, unknown> = ROW): ActionDef => ({ ...def, params: { _rowRecord: row } });

async function confirmTextFor(runner: ActionRunner, def: ActionDef): Promise<string> {
  const confirm = vi.fn().mockResolvedValue(false);
  runner.setConfirmHandler(confirm);
  const result = await runner.execute(def);
  expect(result).toMatchObject({ success: false, error: 'Action cancelled by user' });
  expect(confirm).toHaveBeenCalledTimes(1);
  return confirm.mock.calls[0][0] as string;
}

describe('ActionRunner — a row action reads the row as `record` (objectui#12967)', () => {
  it('(a) the same `confirmText` reads filled from the record header and from a list row', async () => {
    expect(await confirmTextFor(headerDoor(), PAUSE)).toBe('Pause Acme?');
    expect(await confirmTextFor(listDoor(), asRow(PAUSE))).toBe('Pause Acme?');
  });

  it('the row wins over a page-level `record` (a related-list row on a record page)', async () => {
    const onParentPage = new ActionRunner({ objectName: 'sys_org', record: { id: 'org_1', display_name: 'Parent' } });
    expect(await confirmTextFor(onParentPage, asRow(PAUSE))).toBe('Pause Acme?');
  });

  it('(b) the param dialog is handed an `interpolate` that fills a record hole on both doors', async () => {
    const def: ActionDef = {
      ...PAUSE,
      confirmText: undefined,
      description: 'Pausing ${record.display_name}',
      actionParams: [{ name: 'reason', label: 'Reason', type: 'text', helpText: 'Why pause ${record.display_name}?' }],
    };
    const readThrough = async (runner: ActionRunner, dispatched: ActionDef) => {
      let filled: string[] = [];
      runner.setParamCollectionHandler(async (params, action, interpolate) => {
        expect(interpolate).toBeTypeOf('function');
        filled = [String(action?.description), String(params[0].helpText)].map((text) => interpolate!(text));
        return null;
      });
      await runner.execute(dispatched);
      return filled;
    };
    const expected = ['Pausing Acme', 'Why pause Acme?'];
    expect(await readThrough(headerDoor(), def)).toEqual(expected);
    expect(await readThrough(listDoor(), asRow(def))).toEqual(expected);
  });

  it('(c) CONTROL: a hole naming a field the record lacks degrades the same way on both doors', async () => {
    const missing: ActionDef = { ...PAUSE, confirmText: 'Pause {{ record.no_such_field }}?' };
    const header = await confirmTextFor(headerDoor(), missing);
    const row = await confirmTextFor(listDoor(), asRow(missing));
    // The header's degradation, measured: the member reads `undefined` and the
    // hole prints empty. The row now matches it — never the raw source.
    expect(header).toBe('Pause ?');
    expect(row).toBe(header);
  });

  it('CONTROL: a dispatch without a row reads the runner context unchanged', async () => {
    // A list page firing a row-less action: `record` is unbound, so the hole
    // prints empty — the template engine's answer for an unbound root.
    expect(await confirmTextFor(listDoor(), PAUSE)).toBe('Pause ?');
  });

  it('(d) CONTROL: a toast\'s `{{ result.* }}` is read from the result, unchanged by the row binding', async () => {
    const runner = listDoor();
    const toast = vi.fn();
    runner.setToastHandler(toast);
    runner.registerHandler('custom', async () => ({ success: true, data: { display_name: 'From result' } }));
    const result = await runner.execute(asRow({
      name: 'custom_run',
      type: 'custom' as never,
      successMessage: 'Done: {{ result.display_name }}',
    } as ActionDef));
    expect(result.success).toBe(true);
    expect(toast).toHaveBeenCalledWith('Done: From result', expect.objectContaining({ type: 'success' }));
  });
});
