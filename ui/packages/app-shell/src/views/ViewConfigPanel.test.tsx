// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

/**
 * ViewConfigPanel discard/close behavior (objectui#2320).
 *
 * Discard must revert any unsaved edits AND close the panel in edit mode,
 * consistent with create mode. Edits reach the host list preview only through
 * `onViewUpdate`, so discard replays the opening values through the same seam.
 */

// Swap the heavy spec-driven inspector for a light stub that lets a test drive
// `onPatch` — the seam ViewConfigPanel mirrors edits back to the host with.
vi.mock('./metadata-admin/inspectors/ViewVariantInspector', () => ({
  ViewVariantInspector: ({ draft, onPatch }: any) => (
    <button
      type="button"
      data-testid="mock-inspector-edit"
      onClick={() =>
        onPatch({ config: { ...(draft?.config ?? {}), columns: ['a', 'b', 'c'] } })
      }
    >
      edit
    </button>
  ),
}));

// The ADR-0034 draft/publish chrome does its own async metadata reads; stub it
// out so these tests stay focused on the local discard/close behavior.
vi.mock('./RuntimeDraftBar', () => ({
  RuntimeDraftBar: () => null,
}));

import { ViewConfigPanel } from './ViewConfigPanel';

const objectDef = {
  name: 'obj',
  fields: {
    a: { label: 'A', type: 'text' },
    b: { label: 'B', type: 'text' },
    c: { label: 'C', type: 'text' },
  },
};

function makeProps(overrides: Record<string, any> = {}) {
  return {
    open: true,
    onClose: vi.fn(),
    activeView: { id: 'v1', type: 'grid', columns: ['a', 'b'], filter: [], sort: [] },
    objectDef,
    onViewUpdate: vi.fn(),
    onSave: vi.fn(),
    onCreate: vi.fn(),
    ...overrides,
  };
}

describe('ViewConfigPanel — discard', () => {
  it('edit mode: Discard closes the panel even with no edits (objectui#2320)', () => {
    const props = makeProps({ mode: 'edit' });
    render(<ViewConfigPanel {...props} />);

    fireEvent.click(screen.getByTestId('view-config-discard'));

    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('edit mode: Discard reverts the host list preview to the opening view, then closes', () => {
    const props = makeProps({ mode: 'edit' });
    render(<ViewConfigPanel {...props} />);

    // Simulate an inspector edit → mirrored to the host list via onViewUpdate.
    fireEvent.click(screen.getByTestId('mock-inspector-edit'));
    expect(props.onViewUpdate).toHaveBeenCalledWith('columns', ['a', 'b', 'c']);

    props.onViewUpdate.mockClear();

    // Discard → host is told to restore the original columns, then closed.
    fireEvent.click(screen.getByTestId('view-config-discard'));
    expect(props.onViewUpdate).toHaveBeenCalledWith('columns', ['a', 'b']);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('create mode: Discard closes the panel without creating', () => {
    const props = makeProps({ mode: 'create' });
    render(<ViewConfigPanel {...props} />);

    fireEvent.click(screen.getByTestId('view-config-discard'));

    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onCreate).not.toHaveBeenCalled();
  });
});
