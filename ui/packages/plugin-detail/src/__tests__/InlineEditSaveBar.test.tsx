/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InlineEditProvider, useInlineEdit } from '@object-ui/react';
import { InlineEditSaveBar } from '../InlineEditSaveBar';

/**
 * `<InlineEditSaveBar>` (objectui#2407 P1) commits the whole inline-edit draft
 * in ONE atomic write. These tests pin the acceptance contract:
 *   - DataSource mode issues exactly ONE `update` carrying only edited fields,
 *     OCC-guarded by `ifMatch: data.updated_at`, then refreshes;
 *   - a 409 keeps the record in edit and opens the conflict resolver;
 *   - callback mode (drawer) loops the caller's per-field save;
 *   - Cancel discards the draft without writing.
 */

// Drives the shared context so the bar has a draft to save. Buttons carry
// distinctive labels so the bar's own "Save" / "Cancel" stay unambiguous.
function Harness() {
  const inline = useInlineEdit()!;
  return (
    <>
      <button onClick={() => inline.enter('status')}>edit-enter</button>
      <button onClick={() => inline.setField('status', 'active')}>edit-status</button>
      <button onClick={() => inline.setField('budget', 100)}>edit-budget</button>
    </>
  );
}

function stageTwoFields() {
  fireEvent.click(screen.getByText('edit-enter'));
  fireEvent.click(screen.getByText('edit-status'));
  fireEvent.click(screen.getByText('edit-budget'));
}

describe('InlineEditSaveBar — DataSource (atomic OCC) mode', () => {
  it('issues exactly ONE update with only the edited fields + ifMatch, then refreshes', async () => {
    const update = vi.fn().mockResolvedValue({});
    const refresh = vi.fn().mockResolvedValue(undefined);
    render(
      <InlineEditProvider canEdit>
        <Harness />
        <InlineEditSaveBar
          dataSource={{ update }}
          objectName="proj"
          recordId="p1"
          data={{ updated_at: 'v1' }}
          refresh={refresh}
        />
      </InlineEditProvider>,
    );

    stageTwoFields();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith(
      'proj',
      'p1',
      { status: 'active', budget: 100 },
      { ifMatch: 'v1' },
    );
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    // Save exits edit mode → the bar (and its Save button) unmounts.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).toBeNull());
  });

  it('opens the conflict resolver on a 409 and stays in edit (no reset)', async () => {
    const update = vi.fn().mockRejectedValue({
      code: 'CONCURRENT_UPDATE',
      currentVersion: 'v2',
      currentRecord: { status: 'taken' },
    });
    render(
      <InlineEditProvider canEdit>
        <Harness />
        <InlineEditSaveBar
          dataSource={{ update }}
          objectName="proj"
          recordId="p1"
          data={{ updated_at: 'v1' }}
          refresh={vi.fn()}
        />
      </InlineEditProvider>,
    );

    fireEvent.click(screen.getByText('edit-enter'));
    fireEvent.click(screen.getByText('edit-status'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    // The ConcurrentUpdateDialog (Radix AlertDialog) surfaces the conflict with
    // a Reload / Overwrite resolver — proof the save stayed in edit rather than
    // silently discarding the draft. (The open modal aria-hides the background
    // bar, so we assert against the dialog's own controls.)
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /overwrite/i })).toBeInTheDocument();
  });
});

describe('InlineEditSaveBar — callback (drawer) mode', () => {
  it('loops the caller onFieldSave over each edited field', async () => {
    const onFieldSave = vi.fn().mockResolvedValue(undefined);
    render(
      <InlineEditProvider canEdit>
        <Harness />
        <InlineEditSaveBar onFieldSave={onFieldSave} />
      </InlineEditProvider>,
    );

    stageTwoFields();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onFieldSave).toHaveBeenCalledTimes(2));
    expect(onFieldSave).toHaveBeenCalledWith('status', 'active');
    expect(onFieldSave).toHaveBeenCalledWith('budget', 100);
  });
});

describe('InlineEditSaveBar — keyboard shortcuts (objectui#2572)', () => {
  it('Cmd/Ctrl+Enter commits the draft in one atomic update', async () => {
    const update = vi.fn().mockResolvedValue({});
    render(
      <InlineEditProvider canEdit>
        <Harness />
        <InlineEditSaveBar
          dataSource={{ update }}
          objectName="proj"
          recordId="p1"
          data={{ updated_at: 'v1' }}
          refresh={vi.fn()}
        />
      </InlineEditProvider>,
    );

    stageTwoFields();
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith(
      'proj',
      'p1',
      { status: 'active', budget: 100 },
      { ifMatch: 'v1' },
    );
  });

  it('Cmd/Ctrl+Enter is a no-op while locked', () => {
    const update = vi.fn();
    render(
      <InlineEditProvider canEdit>
        <Harness />
        <InlineEditSaveBar dataSource={{ update }} objectName="proj" recordId="p1" data={{}} refresh={vi.fn()} locked />
      </InlineEditProvider>,
    );

    stageTwoFields();
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    expect(update).not.toHaveBeenCalled();
    // Session stays live — the bar is still rendered.
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('Esc cancels the session without a write', () => {
    const update = vi.fn();
    render(
      <InlineEditProvider canEdit>
        <Harness />
        <InlineEditSaveBar dataSource={{ update }} objectName="proj" recordId="p1" data={{}} refresh={vi.fn()} />
      </InlineEditProvider>,
    );

    stageTwoFields();
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(update).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('Esc defers to an open floating layer (popover owns the key)', () => {
    render(
      <InlineEditProvider canEdit>
        <Harness />
        <InlineEditSaveBar dataSource={{ update: vi.fn() }} objectName="proj" recordId="p1" data={{}} refresh={vi.fn()} />
      </InlineEditProvider>,
    );

    stageTwoFields();
    // Simulate an open Radix layer (lookup/select popover) in the DOM.
    const popper = document.createElement('div');
    popper.setAttribute('data-radix-popper-content-wrapper', '');
    document.body.appendChild(popper);
    try {
      fireEvent.keyDown(window, { key: 'Escape' });
      // The session must survive — Esc belonged to the popover.
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    } finally {
      popper.remove();
    }

    // With the layer gone, Esc tears the session down.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('shortcuts are inert while not editing', () => {
    const update = vi.fn();
    render(
      <InlineEditProvider canEdit>
        <Harness />
        <InlineEditSaveBar dataSource={{ update }} objectName="proj" recordId="p1" data={{}} refresh={vi.fn()} />
      </InlineEditProvider>,
    );

    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(update).not.toHaveBeenCalled();
  });
});

describe('InlineEditSaveBar — Cancel', () => {
  it('discards the draft without any write', () => {
    const update = vi.fn();
    render(
      <InlineEditProvider canEdit>
        <Harness />
        <InlineEditSaveBar dataSource={{ update }} objectName="proj" recordId="p1" data={{}} refresh={vi.fn()} />
      </InlineEditProvider>,
    );

    fireEvent.click(screen.getByText('edit-enter'));
    fireEvent.click(screen.getByText('edit-status'));
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });
});
