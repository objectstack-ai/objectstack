/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `element:number` with an `aggregate` and NO object draws a "no object
 * named" state instead of the silent dash (objectui#10951).
 *
 * PR objectui#10944 (objectui#10909) registered the block through
 * `elementDataSourceBlock` so `dataSource.object` could supply the object, and
 * `object` stopped being `required`. The manifest has no way to say "one of
 * `object` and `dataSource.object`", so a node carrying NEITHER now passes the
 * html tier without a diagnostic, and the renderer painted "—" with nothing to
 * tell the author why.
 *
 * What these rows pin:
 *
 *   - an aggregate with neither object: the notice, not the dash, and no query;
 *   - a `dataSource` that names no object is still authored absence;
 *   - since objectui#11880 a flat `properties.object` alone is authored absence
 *     too: the binding is the only place the metric reads its object from;
 *   - controls, each able to fail: `dataSource.object` alone aggregates as
 *     before; a binding whose `view` is
 *     still resolving, or failed to resolve, keeps its own panel and never
 *     shows the new state; a node with no `aggregate` keeps today's dash.
 *
 * No `I18nProvider` is mounted in this file, so the notice is the English
 * `defaultValue` (the provider leg is `elementNumber.noObjectStateLocale-10951`
 * — its own FILE, because `createI18n` installs a module-global instance that
 * would leak into every later provider-less render here).
 *
 * Driven through the real `SchemaRenderer` and this package's registrations,
 * under the `AdapterCtx` provider the renderer reads its adapter from.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act, cleanup, screen, waitFor } from '@testing-library/react';
import { AdapterCtx, SchemaRenderer } from '@object-ui/react';
// Registers every `element:*` renderer at module scope, not in a hook
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010).
import '../../../renderers';

afterEach(cleanup);

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 100)));

const NOTICE_ID = 'element-number-no-object';
/** Written out, not read from the pack: a pin must not agree by construction. */
// objectui#11880: the notice names only the binding member the metric reads.
const NOTICE_EN = 'No object named: set dataSource.object.';

/**
 * An adapter that can aggregate and can list saved views. `views` decides what
 * `getObjectSchema` answers; `pending` makes it never settle, which holds a
 * named `view` in its `loading` state for the whole test.
 */
function makeAdapter(opts: { pending?: boolean } = {}) {
  return {
    aggregate: vi.fn(async (..._args: unknown[]) => [{ count: 7 }]),
    find: vi.fn(async (..._args: unknown[]) => ({ data: [], total: 0 })),
    getObjectSchema: vi.fn((name: string) =>
      opts.pending
        ? new Promise<never>(() => {})
        : Promise.resolve({ name, fields: {}, listViews: {} }),
    ),
  };
}

function mount(schema: Record<string, unknown>, adapter: object) {
  return render(
    <AdapterCtx.Provider value={adapter as never}>
      <SchemaRenderer schema={schema as never} />
    </AdapterCtx.Provider>,
  );
}

describe('element:number — an aggregate naming no object shows the "no object named" state (objectui#10951)', () => {
  it('neither properties.object nor dataSource.object: the notice replaces the dash, and nothing is queried', async () => {
    const adapter = makeAdapter();
    mount({ type: 'element:number', id: 'n', properties: { aggregate: 'count' } }, adapter);
    await settle();

    const notice = screen.getByTestId(NOTICE_ID);
    expect(notice.textContent).toBe(NOTICE_EN);
    expect(screen.queryByText('—')).toBeNull();
    expect(adapter.aggregate).not.toHaveBeenCalled();
    expect(adapter.find).not.toHaveBeenCalled();
  });

  it('a dataSource that names no object is still authored absence', async () => {
    const adapter = makeAdapter();
    mount(
      { type: 'element:number', id: 'n', dataSource: { object: '' }, properties: { aggregate: 'sum', field: 'amount' } },
      adapter,
    );
    await settle();

    expect(screen.getByTestId(NOTICE_ID).textContent).toBe(NOTICE_EN);
    expect(screen.queryByText('—')).toBeNull();
    expect(adapter.aggregate).not.toHaveBeenCalled();
  });
});

describe('element:number — a flat properties.object names nothing (objectui#11880)', () => {
  it('properties.object alone is authored absence too: the notice, and nothing is queried', async () => {
    // The row that was this file's first control until objectui#11880: the
    // metric reads its object from `dataSource.object` only.
    const adapter = makeAdapter();
    mount({ type: 'element:number', id: 'n', properties: { object: 'contact', aggregate: 'count' } }, adapter);
    await settle();

    expect(screen.getByTestId(NOTICE_ID).textContent).toBe(NOTICE_EN);
    expect(adapter.aggregate).not.toHaveBeenCalled();
    expect(adapter.find).not.toHaveBeenCalled();
  });
});

describe('element:number — controls: every form that names an object is unchanged (objectui#10951)', () => {
  it('control: dataSource.object alone aggregates and paints the value', async () => {
    const adapter = makeAdapter();
    mount(
      { type: 'element:number', id: 'n', dataSource: { object: 'contact' }, properties: { aggregate: 'count' } },
      adapter,
    );

    await waitFor(() => expect(screen.getByText('7')).toBeTruthy());
    expect(adapter.aggregate.mock.calls.map((c) => c[0])).toEqual(['contact']);
    expect(screen.queryByTestId(NOTICE_ID)).toBeNull();
  });

  it('control: a binding whose view is still resolving keeps the loading panel, not the new state', async () => {
    const adapter = makeAdapter({ pending: true });
    mount(
      { type: 'element:number', id: 'n', dataSource: { object: 'contact', view: 'hot' }, properties: { aggregate: 'count' } },
      adapter,
    );
    await settle();

    expect(screen.getByTestId('element-number-resolving-view')).toBeTruthy();
    expect(screen.queryByTestId(NOTICE_ID)).toBeNull();
    expect(adapter.aggregate).not.toHaveBeenCalled();
  });

  it('control: a binding whose view failed to resolve keeps the error panel, not the new state', async () => {
    const adapter = makeAdapter();
    mount(
      { type: 'element:number', id: 'n', dataSource: { object: 'contact', view: 'nope' }, properties: { aggregate: 'count' } },
      adapter,
    );

    await waitFor(() => expect(screen.getByTestId('element-number-datasource-error')).toBeTruthy());
    expect(screen.queryByTestId(NOTICE_ID)).toBeNull();
    expect(adapter.aggregate).not.toHaveBeenCalled();
  });

  it('control: no aggregate and no object keeps the dash it paints today', async () => {
    const adapter = makeAdapter();
    mount({ type: 'element:number', id: 'n', properties: { format: 'number' } }, adapter);
    await settle();

    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.queryByTestId(NOTICE_ID)).toBeNull();
    expect(adapter.aggregate).not.toHaveBeenCalled();
  });
});
