/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A row action's `${ctx.*}` target holes read the row, the way the record
 * header's do.
 *
 * The record header binds `record` in the runner's context (`RecordDetailView`'s
 * `ActionProvider`, which also mirrors it under `ctx`). A list row binds nothing
 * there: `ObjectGrid` dispatches a row action as
 * `{ ...def, params: { _rowRecord: row } }` through the page's runner. The
 * target interpolation read the runner's context only, so a `list_item` url
 * action declared as `/apps/APP/OBJECT/record/${ctx.recordId}/page/P` landed
 * on `/apps/APP/OBJECT/record/page/P` from a row menu.
 *
 * Each pin drives the SAME action through both doors:
 *   - header — a runner whose context carries `record` (flat and in the `ctx`
 *              mirror, as `ActionProvider` publishes it), dispatch without a row;
 *   - row    — a runner whose context carries no `record` (a list page), the
 *              dispatch carrying the row exactly as `ObjectGrid` stashes it.
 */
import { describe, it, expect, vi, type Mock } from 'vitest';
import { ActionRunner, type ActionDef, type NavigationHandler } from '../ActionRunner';

const ROW = { id: 'usr_1', name: 'Ada' };

const OPEN_MEMBER: ActionDef = {
  name: 'member_open',
  objectName: 'sys_user',
  type: 'url',
  target: '/apps/app_x/sys_user/record/${ctx.recordId}/page/member',
};

/** `ActionProvider`'s context shape: the flat keys plus their `ctx` mirror. */
const provided = (context: Record<string, unknown>) => new ActionRunner({ ...context, ctx: { ...context } });
/** The record header. */
const headerDoor = () => provided({ objectName: 'sys_user', record: { ...ROW } });
/** A list page: the context names the object, not a record. */
const listDoor = () => provided({ objectName: 'sys_user' });
/** `ObjectGrid`'s row dispatch shape: the row under `params._rowRecord`. */
const asRow = (def: ActionDef, row: Record<string, unknown> = ROW): ActionDef => ({ ...def, params: { _rowRecord: row } });

async function navigatedTo(runner: ActionRunner, def: ActionDef): Promise<string> {
  const nav: Mock<NavigationHandler> = vi.fn();
  runner.setNavigationHandler(nav);
  const result = await runner.execute(def);
  expect(result.success).toBe(true);
  expect(nav).toHaveBeenCalledTimes(1);
  return nav.mock.calls[0][0];
}

describe('ActionRunner — a row action interpolates its target from the row', () => {
  it('`${ctx.recordId}` reads the same id from the record header and from a list row', async () => {
    expect(await navigatedTo(headerDoor(), OPEN_MEMBER)).toBe('/apps/app_x/sys_user/record/usr_1/page/member');
    expect(await navigatedTo(listDoor(), asRow(OPEN_MEMBER))).toBe('/apps/app_x/sys_user/record/usr_1/page/member');
  });

  it('`${ctx.record.FIELD}` reads the row on a list page', async () => {
    const def: ActionDef = { ...OPEN_MEMBER, target: '/people?id=${ctx.record.id}&name=${ctx.record.name}' };
    expect(await navigatedTo(headerDoor(), def)).toBe('/people?id=usr_1&name=Ada');
    expect(await navigatedTo(listDoor(), asRow(def))).toBe('/people?id=usr_1&name=Ada');
  });

  it('the row wins over a page-level record (a related-list row on a record page)', async () => {
    const onParentPage = provided({ objectName: 'sys_org', record: { id: 'org_1', name: 'Parent' } });
    const def: ActionDef = { ...OPEN_MEMBER, target: '/people/${ctx.recordId}?name=${ctx.record.name}' };
    expect(await navigatedTo(onParentPage, asRow(def))).toBe('/people/usr_1?name=Ada');
  });

  it('`${ctx.selection.ids}` stays the checked selection, which a row dispatch does not fill', async () => {
    const def: ActionDef = { ...OPEN_MEMBER, target: '/people?ids=${ctx.selection.ids}&count=${ctx.selection.count}' };
    expect(await navigatedTo(listDoor(), asRow(def))).toBe('/people?ids=&count=0');
    const checked = new ActionRunner({ objectName: 'sys_user', selectedRecords: [{ id: 'usr_2' }, { id: 'usr_3' }] });
    expect(await navigatedTo(checked, asRow(def))).toBe('/people?ids=usr_2%2Cusr_3&count=2');
  });

  it('CONTROL: a dispatch with no row on a list page still reads no record', async () => {
    expect(await navigatedTo(listDoor(), OPEN_MEMBER)).toBe('/apps/app_x/sys_user/record//page/member');
  });
});
