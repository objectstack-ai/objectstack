/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Tests the drill "escape hatch": the in-place drill drawer offers an
 * "Open in list →" affordance (and honors `target: 'navigate'`) when the host
 * provides a `DrillNavigationContext.openRecordList` handler, and stays a
 * self-contained peek when it doesn't.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { DrillNavigationProvider } from '@object-ui/react';

import { DrillDownDrawer } from '../DrillDownDrawer';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`, which is why this carried a raised
// timeout. See object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '@object-ui/components';

function renderDrawer(
  props: Record<string, any> = {},
  openRecordList?: (object: string, filter?: Record<string, unknown>) => void,
) {
  return render(
    <DrillNavigationProvider value={{ openRecordList }}>
      <DrillDownDrawer
        open
        onClose={props.onClose ?? vi.fn()}
        title="Won × Web"
        objectName="opportunity"
        filter={{ stage: 'won' }}
        dataSource={{ find: async () => ({ data: [] }), getObjectSchema: async () => ({ fields: {} }) }}
        {...props}
      />
    </DrillNavigationProvider>,
  );
}

describe('DrillDownDrawer — escape hatch & navigate target', () => {
  it('shows "Open in list" when a host navigation handler is present and navigates with the drill filter', () => {
    const openRecordList = vi.fn();
    const onClose = vi.fn();
    renderDrawer({ onClose }, openRecordList);

    const btn = screen.getByTestId('drill-open-in-list');
    expect(btn).toBeInTheDocument();

    fireEvent.click(btn);
    expect(openRecordList).toHaveBeenCalledWith('opportunity', { stage: 'won' });
    expect(onClose).toHaveBeenCalled();
  });

  it('hides the escape hatch when no host navigation handler is provided', () => {
    renderDrawer({}, undefined);
    expect(screen.queryByTestId('drill-open-in-list')).toBeNull();
    // Still a working drawer.
    expect(screen.getByTestId('drill-down-body')).toBeInTheDocument();
  });

  it("target='navigate' opens the list directly and renders no drawer body", async () => {
    const openRecordList = vi.fn();
    const onClose = vi.fn();
    renderDrawer({ target: 'navigate', onClose }, openRecordList);

    await waitFor(() => expect(openRecordList).toHaveBeenCalledWith('opportunity', { stage: 'won' }));
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByTestId('drill-down-body')).toBeNull();
  });

  it("target='navigate' degrades to the drawer when no host handler is available", () => {
    renderDrawer({ target: 'navigate' }, undefined);
    // No navigation possible → still shows the in-place list.
    expect(screen.getByTestId('drill-down-body')).toBeInTheDocument();
  });
});
