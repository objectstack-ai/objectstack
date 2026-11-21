// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
// The panel's source reaches dynamic `import('@objectstack/formula')` and
// `import('@objectstack/lint')`: pay their load at collection, never inside a
// case's clocked window (`check:test-source-alias`).
import '@objectstack/formula';
import '@objectstack/lint';

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
  ViewVariantInspector: ({ draft, onPatch, readOnly }: any) => (
    <button
      type="button"
      data-testid="mock-inspector-edit"
      data-readonly={String(!!readOnly)}
      data-columns={JSON.stringify(draft?.config?.columns ?? null)}
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
  RuntimeDraftBar: () => <span data-testid="mock-draft-bar" />,
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

describe('ViewConfigPanel — read-only (objectstack#35974)', () => {
  it('a view the server refuses to save: shown with its controls disabled, no Save, no draft bar, Close only', () => {
    const props = makeProps({ mode: 'edit', readOnly: true });
    render(<ViewConfigPanel {...props} />);

    expect(screen.getByTestId('mock-inspector-edit').getAttribute('data-readonly')).toBe('true');
    expect(screen.queryByTestId('view-config-save')).toBeNull();
    expect(screen.queryByTestId('view-config-discard')).toBeNull();
    expect(screen.queryByTestId('mock-draft-bar')).toBeNull();

    // An edit a control would still send is not relayed to the host's list.
    fireEvent.click(screen.getByTestId('mock-inspector-edit'));
    expect(props.onViewUpdate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('view-config-close'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it('a verdict that lands after an edit: the edit is discarded, the panel stays open and shows the view', () => {
    const props = makeProps({ mode: 'edit' });
    const view = render(<ViewConfigPanel {...props} />);
    const opened = screen.getByTestId('mock-inspector-edit').getAttribute('data-columns');

    // Opened editable while the package list was still being read; edited.
    fireEvent.click(screen.getByTestId('mock-inspector-edit'));
    expect(props.onViewUpdate).toHaveBeenCalledWith('columns', ['a', 'b', 'c']);
    expect(screen.getByTestId('mock-inspector-edit').getAttribute('data-columns')).not.toBe(opened);
    props.onViewUpdate.mockClear();

    // The read-only verdict lands.
    view.rerender(<ViewConfigPanel {...props} readOnly />);

    // The host's list is told to restore the opening view, as Discard would.
    expect(props.onViewUpdate).toHaveBeenCalledWith('columns', ['a', 'b']);
    expect(props.onViewUpdate).not.toHaveBeenCalledWith('columns', ['a', 'b', 'c']);
    // The panel shows the view, not the edit, and stays open, read-only.
    expect(screen.getByTestId('mock-inspector-edit').getAttribute('data-columns')).toBe(opened);
    expect(screen.getByTestId('mock-inspector-edit').getAttribute('data-readonly')).toBe('true');
    expect(screen.queryByTestId('view-config-discard')).toBeNull();
    expect(screen.queryByTestId('view-config-save')).toBeNull();
    expect(props.onClose).not.toHaveBeenCalled();

    // Nothing more is relayed: a later edit is taken by no one.
    props.onViewUpdate.mockClear();
    fireEvent.click(screen.getByTestId('mock-inspector-edit'));
    expect(props.onViewUpdate).not.toHaveBeenCalled();
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it('a verdict that lands before any edit relays nothing', () => {
    const props = makeProps({ mode: 'edit' });
    const view = render(<ViewConfigPanel {...props} />);
    view.rerender(<ViewConfigPanel {...props} readOnly />);
    expect(props.onViewUpdate).not.toHaveBeenCalled();
    expect(screen.getByTestId('mock-inspector-edit').getAttribute('data-readonly')).toBe('true');
  });

  it('a savable view (the default) keeps its editable controls, Save, Discard and the draft bar', () => {
    const props = makeProps({ mode: 'edit' });
    render(<ViewConfigPanel {...props} />);

    expect(screen.getByTestId('mock-inspector-edit').getAttribute('data-readonly')).toBe('false');
    expect(screen.getByTestId('view-config-save')).toBeTruthy();
    expect(screen.getByTestId('view-config-discard')).toBeTruthy();
    expect(screen.getByTestId('mock-draft-bar')).toBeTruthy();
    expect(screen.queryByTestId('view-config-close')).toBeNull();
  });
});
