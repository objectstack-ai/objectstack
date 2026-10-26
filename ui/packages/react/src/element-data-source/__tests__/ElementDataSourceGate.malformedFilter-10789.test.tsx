/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The gate draws the malformed-filter notice instead of throwing out of render
 * — objectui#10789.
 *
 * The gate lowers filters at two render-time merges, and both called the
 * THROWING converter form:
 *
 *  1. its own merge of the component's `filter` with the composed binding
 *     (`useElementDataSourceSchema`'s `useMemo`), and
 *  2. `composeElementDataSource`'s merge of the saved view's filter with the
 *     binding's own (`useElementDataSource`'s `useMemo`).
 *
 * A malformed authored filter therefore threw a `FilterOperatorError` out of
 * render, into the nearest error boundary, BEFORE the wrapped block —
 * `record:related_list`, `object-grid`, a line-items panel — reached its own
 * `toFilterNodeSafely` and drew the malformed-filter state (objectui#9050).
 *
 * Each merge gets one malformed filter here. The assertions are the notice's
 * CONTENT (the operator it names, the refusal's own message) and the refusal's
 * envelope (`code` / `httpStatus`), never a bare "did not throw": `render`
 * returning at all is the no-throw half, and the block staying unmounted is
 * the no-widening half — the block cannot run a query the gate could not build.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, renderHook, waitFor } from '@testing-library/react';
import * as React from 'react';
import { I18nProvider } from '@object-ui/i18n';
import {
  ElementDataSourceGate,
  useElementDataSourceSchema,
  type ElementDataSourceMapping,
} from '../ElementDataSourceGate';

/** Refused by the converter since objectui#8530: `$regex` has no AST target. */
const MALFORMED = { name: { $regex: '^A' } };

const HOT_VIEW = { name: 'hot', filter: [['rating', '=', 'hot']] };

const makeAdapter = () => ({
  find: vi.fn(),
  getObjectSchema: vi.fn().mockResolvedValue({ name: 'account', listViews: { hot: HOT_VIEW } }),
});

const MAPPING: ElementDataSourceMapping = { filter: true };

function Block({ schema }: { schema: any }) {
  return <div data-testid="block">{JSON.stringify(schema.filter ?? null)}</div>;
}

const renderGate = (schema: Record<string, unknown>) =>
  render(
    <ElementDataSourceGate schema={schema} mapping={MAPPING} dataSource={makeAdapter()} testId="probe">
      {(bound) => <Block schema={bound} />}
    </ElementDataSourceGate>,
  );

/** The two merges, each fed one malformed filter. */
const CASES: ReadonlyArray<[string, Record<string, unknown>]> = [
  [
    "the gate's own merge — the component's filter",
    { filter: MALFORMED, dataSource: { object: 'account' } },
  ],
  [
    "composeElementDataSource's merge — the binding's filter beside the view's",
    { dataSource: { object: 'account', view: 'hot', filter: MALFORMED } },
  ],
];

describe('ElementDataSourceGate — a malformed filter draws the notice (objectui#10789)', () => {
  it.each(CASES)('%s', async (_label, schema) => {
    const { queryByTestId, getByTestId } = renderGate(schema);

    await waitFor(() => expect(queryByTestId('probe-malformed-filter')).not.toBeNull());
    // The headline NAMES the operator the author has to fix — the sibling
    // blocks' sentence, not the "data source could not be resolved" panel.
    // No `I18nProvider` here: the sentence itself reaches the screen, not the
    // raw key, and its `{{subject}}` hole is filled.
    const headline = getByTestId('probe-malformed-filter-subject').textContent ?? '';
    expect(headline).toContain('filter is malformed');
    expect(headline).toContain('the $regex condition');
    expect(headline).not.toContain('view.malformedFilter');
    expect(getByTestId('probe-malformed-filter').getAttribute('role')).toBe('alert');
    // Refused, not dropped: the block never mounts, so it cannot run the query
    // unconstrained.
    expect(queryByTestId('block')).toBeNull();
    expect(queryByTestId('probe-datasource-error')).toBeNull();
  });

  it.each(CASES)('%s — the hook reports the refusal as a value', async (_label, schema) => {
    const adapter = makeAdapter();
    const { result } = renderHook(() => useElementDataSourceSchema(schema, MAPPING, adapter));
    await waitFor(() => expect(result.current.status).not.toBe('loading'));

    expect(result.current.status).toBe('missing');
    const refusal = result.current.filterRefusal;
    expect(refusal?.code).toBe('INVALID_FILTER');
    expect(refusal?.httpStatus).toBe(400);
    expect(refusal?.operator).toBe('$regex');
    expect(result.current.error).toBe(refusal?.message);
  });

  it('with an I18nProvider, the headline is the pack sentence naming the operator', async () => {
    const { queryByTestId, getByTestId } = render(
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false, resources: {} }}>
        <ElementDataSourceGate schema={CASES[0][1]} mapping={MAPPING} dataSource={makeAdapter()} testId="probe">
          {(bound) => <Block schema={bound} />}
        </ElementDataSourceGate>
      </I18nProvider>,
    );
    await waitFor(() => expect(queryByTestId('probe-malformed-filter')).not.toBeNull());
    const headline = getByTestId('probe-malformed-filter-subject').textContent ?? '';
    expect(headline).toContain('filter is malformed');
    expect(headline).toContain('the $regex condition');
  });

  it('CONTROL — a well-formed filter still renders the block with the merged filter', async () => {
    const { queryByTestId, getByTestId } = renderGate({
      filter: { name: 'Acme' },
      dataSource: { object: 'account', view: 'hot', filter: { amount: { $gt: 100 } } },
    });
    await waitFor(() => expect(queryByTestId('block')).not.toBeNull());
    const merged = getByTestId('block').textContent ?? '';
    expect(merged).toContain('rating');
    expect(merged).toContain('amount');
    expect(merged).toContain('Acme');
    expect(queryByTestId('probe-malformed-filter')).toBeNull();
  });
});
