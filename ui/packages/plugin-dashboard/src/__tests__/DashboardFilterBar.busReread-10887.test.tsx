/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10887 member 2 — a dashboard filter's `optionsFrom` options are
 * re-read when the data-invalidation bus (`notifyDataChanged` from
 * `@object-ui/react`) reports a change to `optionsFrom.object`, and the value
 * the user selected survives the re-read.
 *
 * Before this card the options effect keyed on the object, the fields, the
 * options filter and the data source, and on no nonce. After a page action over
 * raw HTTP the filter kept offering the pre-action values until `PageView`
 * remounted the page, and objectui#10519 removes that remount. The effect now
 * names the `useDataInvalidation` nonce for `optionsFrom.object`, the
 * objectui#10853 shape (the record picker's options).
 *
 * Rendered through the real `SchemaRenderer` and this package's own
 * registration of `dashboard`, with the adapter injected by
 * `SchemaRendererProvider`, on both option reads: the server-side dataset
 * GROUP BY and the client-side `find` fallback. The selected value lives in the
 * dashboard's own variables provider, so it is chosen through the real select.
 * The bare `useDataInvalidation` reader beside the dashboard and an
 * `object-metric` block (it reads the bus itself) are the positive controls.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider, notifyDataChanged, useDataInvalidation } from '@object-ui/react';
// Module scope, not a hook: this import IS the registration of `dashboard`.
import '../index';

// Radix Select opens on pointer events the DOM environment does not implement;
// the same shim `DashboardFilterBar.options.test.tsx` uses.
beforeAll(() => {
  class MockPointerEvent extends Event {
    button: number;
    ctrlKey: boolean;
    pointerType: string;
    constructor(type: string, props: PointerEventInit = {}) {
      super(type, props);
      this.button = props.button ?? 0;
      this.ctrlKey = props.ctrlKey ?? false;
      this.pointerType = props.pointerType ?? 'mouse';
    }
  }
  Object.assign(window, { PointerEvent: MockPointerEvent });
  Object.assign(HTMLElement.prototype, {
    hasPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    scrollIntoView: vi.fn(),
  });
});

afterEach(cleanup);

type Path = 'dataset' | 'fallback';

/**
 * The options on the first read are `finance` and `retail`; every later read
 * adds `energy`, so a re-read that landed is visible in the list.
 */
function makeDataSource(path: Path) {
  let answered = 0;
  const values = () => {
    answered += 1;
    return answered === 1 ? ['finance', 'retail'] : ['energy', 'finance', 'retail'];
  };
  const find = vi.fn(async (_object: string, _query?: unknown) => ({ data: values().map((industry) => ({ industry })) }));
  const queryDataset = vi.fn(async (_draft: unknown, _selection?: unknown) => ({
    rows: values().map((industry) => ({ industry, option_count: 1 })),
  }));
  return path === 'dataset' ? { find, queryDataset } : { find };
}

/** The option reads, whichever of the two paths served them. */
const reads = (ds: ReturnType<typeof makeDataSource>, path: Path) =>
  path === 'dataset' ? (ds as { queryDataset: ReturnType<typeof vi.fn> }).queryDataset : ds.find;

/** The positive control: a bare reader of the filter's source object. */
function BusControl() {
  return <span data-testid="bus-control">{useDataInvalidation('accounts')}</span>;
}

const selectFilter = (extra: Record<string, unknown> = {}) => ({
  name: 'industry',
  field: 'industry',
  label: 'Industry',
  type: 'select',
  ...extra,
});

const dashboardWith = (filter: Record<string, unknown>) => ({ type: 'dashboard', globalFilters: [filter], widgets: [] });

const OPTIONS_FROM = { optionsFrom: { object: 'accounts', valueField: 'industry', labelField: 'industry' } };

function mount(path: Path, node: Record<string, unknown> = dashboardWith(selectFilter(OPTIONS_FROM))) {
  const ds = makeDataSource(path);
  render(
    <SchemaRendererProvider dataSource={ds as never}>
      <BusControl />
      <SchemaRenderer schema={node as never} />
    </SchemaRendererProvider>,
  );
  return ds;
}

const rest = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 60)));
const emit = (change: { objectName: string; recordId?: string }) =>
  act(async () => {
    notifyDataChanged(change);
  });
const trigger = () => screen.getByTestId('dashboard-filter-industry');

async function mountAtRest(path: Path) {
  const ds = mount(path);
  const read = reads(ds, path);
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  await rest();
  expect(read, 'one read on mount').toHaveBeenCalledTimes(1);
  return { ds, read };
}

describe('a dashboard filter re-reads its optionsFrom options on the data-invalidation bus (objectui#10887)', () => {
  for (const path of ['dataset', 'fallback'] as const) {
    it(`an unscoped change ("*") re-reads the options once (${path} read)`, async () => {
      const { read } = await mountAtRest(path);

      await emit({ objectName: '*' });
      await rest();

      expect(screen.getByTestId('bus-control').textContent, 'control: the event never reached a subscriber').toBe('1');
      expect(read, 'the options never re-read after the bus reported a change').toHaveBeenCalledTimes(2);
    });

    it(`a change to its own object re-reads once; an unrelated object does not (${path} read)`, async () => {
      const { read } = await mountAtRest(path);

      await emit({ objectName: 'unrelated_object' });
      await rest();
      expect(read, 'a change to another object re-read the options').toHaveBeenCalledTimes(1);

      await emit({ objectName: 'accounts', recordId: 'a1' });
      await rest();
      expect(read, 'a change to its own object did not re-read the options exactly once').toHaveBeenCalledTimes(2);
    });
  }

  it('the selected value survives the re-read, and the re-read options reach the list', async () => {
    const { read } = await mountAtRest('dataset');

    fireEvent.pointerDown(trigger(), { button: 0 });
    fireEvent.click(await screen.findByRole('option', { name: 'retail' }));
    await waitFor(() => expect(trigger().textContent).toBe('retail'));
    await rest();
    const triggerNode = trigger();

    await emit({ objectName: '*' });
    await rest();
    expect(read).toHaveBeenCalledTimes(2);

    expect(trigger(), 'the re-read remounted the filter').toBe(triggerNode);
    expect(trigger().textContent, 'the re-read dropped the selected value').toBe('retail');
    fireEvent.pointerDown(trigger(), { button: 0 });
    expect(await screen.findByRole('option', { name: 'energy' }), 'the re-read options never reached the list').toBeTruthy();
    expect(trigger().textContent).toBe('retail');
  });

  it('lit control: an object-metric block beside the dashboard re-reads on the same event through its own reader', async () => {
    const ds = { ...makeDataSource('dataset'), aggregate: vi.fn(async () => [{ industry: 3 }]) };
    render(
      <SchemaRendererProvider dataSource={ds as never}>
        <SchemaRenderer schema={dashboardWith(selectFilter(OPTIONS_FROM)) as never} />
        <SchemaRenderer
          schema={{ type: 'object-metric', objectName: 'accounts', aggregate: { field: 'industry', function: 'count' }, label: 'Accounts' } as never}
        />
      </SchemaRendererProvider>,
    );
    await waitFor(() => expect(ds.aggregate).toHaveBeenCalledTimes(1));
    await rest();

    await emit({ objectName: '*' });
    await rest();

    expect(ds.aggregate, 'the metric never re-read: the event did not reach a block that reads the bus').toHaveBeenCalledTimes(2);
  });

  it('control: a select filter with no optionsFrom reads nothing, on mount or on an invalidation', async () => {
    const ds = mount('dataset', dashboardWith(selectFilter({ options: [{ value: 'finance', label: 'Finance' }] })));
    await rest();

    await emit({ objectName: '*' });
    await rest();

    expect(screen.getByTestId('bus-control').textContent).toBe('1');
    expect(reads(ds, 'dataset')).not.toHaveBeenCalled();
    expect(ds.find).not.toHaveBeenCalled();
  });
});
