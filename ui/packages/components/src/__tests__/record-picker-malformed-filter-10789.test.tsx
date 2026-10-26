/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `element:record_picker` reports a refused binding filter instead of throwing
 * out of render — objectui#10789.
 *
 * The picker composes its binding through `useElementDataSource`, whose render
 * `useMemo` called `composeElementDataSource` — and that merge of the saved
 * view's filter with the binding's own used the THROWING converter form. A
 * malformed binding filter beside a view filter threw a `FilterOperatorError`
 * into the nearest error boundary.
 *
 * The hook now reports it as `missing` with the refusal, which is the state
 * this block already answers with its configuration-error panel — so the
 * picker says what is wrong, and never queries without the filter.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { AdapterCtx, SchemaRenderer } from '@object-ui/react';
// Registers `element:record_picker` at module scope (the objectui#3010 rule).
import '../renderers';

const HOT_VIEW = { name: 'hot', filter: [['rating', '=', 'hot']] };

function makeAdapter() {
  return {
    find: vi.fn().mockResolvedValue({ data: [{ id: 'a1', name: 'Acme' }] }),
    getObjectSchema: vi.fn().mockResolvedValue({ name: 'account', fields: {}, listViews: { hot: HOT_VIEW } }),
  };
}

const renderPicker = (schema: Record<string, unknown>, adapter: ReturnType<typeof makeAdapter>) =>
  render(
    <AdapterCtx.Provider value={adapter as any}>
      <SchemaRenderer schema={{ type: 'element:record_picker', id: 'picker', ...schema } as any} />
    </AdapterCtx.Provider>,
  );

describe('element:record_picker — a refused binding filter (objectui#10789)', () => {
  it('renders the configuration-error panel carrying the refusal, and queries nothing', async () => {
    const adapter = makeAdapter();
    const { queryByTestId, getByTestId, container } = renderPicker(
      { dataSource: { object: 'account', view: 'hot', filter: { name: { $regex: '^A' } } } },
      adapter,
    );

    await waitFor(() => expect(queryByTestId('record-picker-datasource-error')).not.toBeNull());
    const panel = getByTestId('record-picker-datasource-error');
    // The refusal's own sentence, naming the operator the author wrote.
    expect(panel.textContent).toContain('$regex');
    expect(panel.getAttribute('role')).toBe('alert');
    // Not the error boundary's "failed to render" banner.
    expect(container.textContent).not.toMatch(/failed to render/i);
    // Refused, not dropped: no query without the view's filter.
    expect(adapter.find).not.toHaveBeenCalled();
    expect(queryByTestId('record-picker')).toBeNull();
  });

  it('CONTROL — a well-formed binding filter still queries with both filters', async () => {
    const adapter = makeAdapter();
    renderPicker(
      { dataSource: { object: 'account', view: 'hot', filter: { name: 'Acme' } } },
      adapter,
    );
    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    const json = JSON.stringify(adapter.find.mock.calls[0][1].$filter);
    expect(json).toContain('rating');
    expect(json).toContain('Acme');
  });
});
