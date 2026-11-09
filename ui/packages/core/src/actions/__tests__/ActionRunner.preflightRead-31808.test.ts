/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ParamCollectionHandler`'s `interpolateRead` (objectstack#31808): the
 * filler the param dialog fills an action's `preflight.read.url` with.
 *
 * What these pin, at the runner:
 *  - `${param.NAME}` reads the dialog's CURRENT values (the second argument),
 *    not the params the action carried, and each value is percent-encoded as
 *    a target's is;
 *  - a row dispatch binds `${ctx.record.FIELD}` / `${ctx.recordId}` to the row;
 *  - a record page's HEADER dispatch carries no row, and binds
 *    `${ctx.record.FIELD}` to the runner context's record, the one the page
 *    shows;
 *  - a hole with no value (a missing param, an empty one, a record field the
 *    record lacks) and a token in a scope the grammar does not know answer
 *    `null`, so the dialog sends nothing;
 *  - a target's own interpolation is unchanged: it still writes `''` for a
 *    hole with no value.
 */

import { describe, it, expect, vi } from 'vitest';
import { ActionRunner, type ActionResult, type PreflightReadFiller } from '../ActionRunner';

const PARAMS = [
  { name: 'version', label: 'Version', type: 'text' },
  { name: 'token', label: 'Token', type: 'text' },
];

/** Run `action` and hand back the filler its param dialog was given. */
async function fillerFor(runner: ActionRunner, action: Record<string, unknown>): Promise<PreflightReadFiller> {
  let captured: PreflightReadFiller | undefined;
  runner.registerHandler('api', vi.fn(async (): Promise<ActionResult> => ({ success: true })));
  runner.setParamCollectionHandler(async (_params, _action, _interpolate, _run, interpolateRead) => {
    captured = interpolateRead;
    return null;
  });
  await runner.execute({ type: 'api', name: 'install_package', target: '/api/v1/x', ...action } as never);
  expect(captured).toBeTypeOf('function');
  return captured!;
}

describe('ActionRunner — the preflight read filler (objectstack#31808)', () => {
  it('reads the dialog\'s current values for `${param.*}`, percent-encoded', async () => {
    const fill = await fillerFor(new ActionRunner({}), { params: PARAMS });
    expect(fill('/api/v1/plan?version=${param.version}', { version: '2.0 beta/1' }))
      .toBe('/api/v1/plan?version=2.0%20beta%2F1');
  });

  it('binds `ctx.record` / `ctx.recordId` to the row a row dispatch carries, over the page\'s record', async () => {
    const runner = new ActionRunner({ record: { id: 'page_1', name: 'page' } });
    const fill = await fillerFor(runner, {
      actionParams: PARAMS,
      params: { _rowRecord: { id: 'row_7', name: 'crm' } },
    });
    expect(fill('/api/v1/packages/${ctx.recordId}/plan?n=${ctx.record.name}', {}))
      .toBe('/api/v1/packages/row_7/plan?n=crm');
  });

  it('binds `${ctx.record.FIELD}` on a header dispatch to the record the page shows', async () => {
    const runner = new ActionRunner({ record: { id: 'pkg_1', name: 'crm', current_version: '1.4.0' } });
    const fill = await fillerFor(runner, { params: PARAMS });
    expect(fill('/api/v1/packages/${ctx.recordId}/plan?from=${ctx.record.current_version}&to=${param.version}', { version: '2.0.0' }))
      .toBe('/api/v1/packages/pkg_1/plan?from=1.4.0&to=2.0.0');
  });

  it('answers null for a hole with no value, so nothing is sent', async () => {
    const fill = await fillerFor(new ActionRunner({ record: { id: 'pkg_1' } }), { params: PARAMS });
    expect(fill('/api/v1/plan?version=${param.version}', {})).toBeNull();
    expect(fill('/api/v1/plan?version=${param.version}', { version: '' })).toBeNull();
    // The record has no `current_version`: the hole cannot be bound.
    expect(fill('/api/v1/plan?from=${ctx.record.current_version}', {})).toBeNull();
  });

  it('answers null for a header dispatch on a runner with no record', async () => {
    const fill = await fillerFor(new ActionRunner({}), { params: PARAMS });
    expect(fill('/api/v1/plan?n=${ctx.record.name}', {})).toBeNull();
  });

  it('answers null for a token in a scope the grammar does not know', async () => {
    const fill = await fillerFor(new ActionRunner({}), { params: PARAMS });
    expect(fill('/api/v1/plan?x=${result.id}', {})).toBeNull();
  });

  it('CONTROL: a target still interpolates a hole with no value as an empty segment', async () => {
    const runner = new ActionRunner({});
    const api = vi.fn(async (): Promise<ActionResult> => ({ success: true }));
    runner.registerHandler('api', api);
    runner.setParamCollectionHandler(async () => ({ version: '' }));
    await runner.execute({
      type: 'api',
      name: 'install_package',
      target: '/api/v1/install?version=${param.version}',
      params: PARAMS,
    } as never);
    expect(api).toHaveBeenCalledTimes(1);
    const [dispatched] = api.mock.calls[0] as unknown as [{ target?: string }];
    expect(dispatched.target).toBe('/api/v1/install?version=');
  });
});
