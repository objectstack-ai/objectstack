// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11583: `ViewConfigPanel.handleSave` reads the save's outcome before
 * it reports the panel as saved.
 *
 * ## The defect this pins
 *
 * In edit mode `handleSave` called `onSave` without waiting, then cleared
 * `isDirty` and bumped `savedSignal`. Save is disabled while the panel is not
 * dirty, and `savedSignal` makes the draft bar announce "unpublished changes".
 * So a refused save looked saved, announced a draft that did not exist, and
 * could not be retried without making another edit.
 *
 * ## The contract this pins
 *
 * `onSave` may return a promise of the outcome (`ObjectView`'s
 * `handleViewConfigSave` does). The panel clears `isDirty` and bumps
 * `savedSignal` only when that promise resolves to anything but `false`; a
 * `false` or a rejection leaves the panel dirty. Save is disabled while the
 * save is in flight, and an edit made during it stays dirty after it lands.
 * A host that returns nothing is read as saved, as before.
 *
 * The end-to-end pin, through the real `ObjectView` and a refusing metadata
 * client, is `ObjectView.viewWriteRefusal-11583.test.tsx`.
 *
 * Direction, written before the run: on the unmodified tree the `false`,
 * rejection, in-flight and edit-during-save cases go RED (the panel clears
 * before the save settles); the `true` and legacy cases stay GREEN.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

vi.mock('./metadata-admin/inspectors/ViewVariantInspector', () => ({
  ViewVariantInspector: ({ draft, onPatch }: any) => (
    <button
      type="button"
      data-testid="mock-inspector-edit"
      onClick={() => onPatch({ config: { ...(draft?.config ?? {}), columns: [...(draft?.config?.columns ?? []), 'c'] } })}
    >
      edit
    </button>
  ),
}));

// The draft bar, reduced to the two props the panel drives.
vi.mock('./RuntimeDraftBar', () => ({
  RuntimeDraftBar: ({ savedSignal, dirty }: any) => (
    <span data-testid="stub-draft-bar" data-saved-signal={String(savedSignal)} data-dirty={String(dirty)} />
  ),
}));

import { ViewConfigPanel } from './ViewConfigPanel';

const objectDef = {
  name: 'obj',
  fields: { a: { label: 'A', type: 'text' }, b: { label: 'B', type: 'text' }, c: { label: 'C', type: 'text' } },
};

function mount(onSave: (draft: Record<string, any>) => unknown) {
  render(
    <ViewConfigPanel
      open
      mode="edit"
      onClose={vi.fn()}
      activeView={{ id: 'v1', type: 'grid', columns: ['a', 'b'], filter: [], sort: [] }}
      objectDef={objectDef}
      onViewUpdate={vi.fn()}
      onSave={onSave as any}
    />,
  );
}

const save = () => screen.getByTestId('view-config-save') as HTMLButtonElement;
const savedSignal = () => screen.getByTestId('stub-draft-bar').getAttribute('data-saved-signal');
const edit = () => fireEvent.click(screen.getByTestId('mock-inspector-edit'));

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('ViewConfigPanel — edit Save reports saved only after the save lands (objectui#11583, handleSave)', () => {
  it.each([
    { outcome: 'resolves false', onSave: () => Promise.resolve(false) },
    { outcome: 'rejects', onSave: () => Promise.reject(new Error('refused')) },
  ])('a save that $outcome leaves the panel dirty, and announces no draft', async ({ onSave }) => {
    mount(onSave);
    edit();
    expect(save().disabled).toBe(false);

    await act(async () => {
      fireEvent.click(save());
    });

    await waitFor(() => expect(save().disabled).toBe(false));
    expect(savedSignal()).toBe('0');
    expect(screen.getByTestId('stub-draft-bar').getAttribute('data-dirty')).toBe('true');
  });

  it('a save that resolves true clears the panel and announces the draft (control)', async () => {
    mount(() => Promise.resolve(true));
    edit();
    await act(async () => {
      fireEvent.click(save());
    });
    await waitFor(() => expect(save().disabled).toBe(true));
    expect(savedSignal()).toBe('1');
  });

  it('a host that returns nothing is read as saved, as before (control)', async () => {
    const onSave = vi.fn();
    mount(onSave);
    edit();
    await act(async () => {
      fireEvent.click(save());
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(save().disabled).toBe(true));
    expect(savedSignal()).toBe('1');
  });

  it('Save is disabled while the save is in flight, and an edit made then stays dirty', async () => {
    const pending = deferred<boolean>();
    const onSave = vi.fn(() => pending.promise);
    mount(onSave);
    edit();
    await act(async () => {
      fireEvent.click(save());
    });
    // In flight: a second press cannot send a second save.
    expect(save().disabled).toBe(true);
    expect(savedSignal()).toBe('0');

    // The user edits again before the first save lands.
    edit();
    await act(async () => {
      pending.resolve(true);
      await pending.promise;
    });

    // The first save landed, so the draft is announced; the second edit was
    // not in it, so the panel is still dirty and Save is live again.
    await waitFor(() => expect(savedSignal()).toBe('1'));
    expect(save().disabled).toBe(false);
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
