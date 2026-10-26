// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11583 (patch round): `ReportConfigPanel.handleSave` reads the
 * save's outcome before it reports the edit as saved.
 *
 * ## The defect this pins
 *
 * `handleSave` called `onSave(draftRef.current)`, cleared `dirty` and called
 * `onClose()` before the save settled. Measured through the real `ReportView`
 * after the first round's toast: a refused save closed the panel, and a reopen
 * showed the stored report, so the edit was lost. The same shape as
 * `ViewConfigPanel.handleSave` (row 2 of the card), and the same direction.
 *
 * ## The contract this pins
 *
 * `onSave` may return a promise of the outcome (`ReportView`'s
 * `handleReportConfigSave` does). The panel clears `dirty` and closes only
 * when that promise resolves to anything but `false`; `false` or a rejection
 * leaves it open, dirty, with the edit in the inspector and Save live. While
 * the save is in flight Save is disabled and the inspector is read-only, so
 * no edit can land in a window the save does not carry. A host that returns
 * nothing is read as saved, as before.
 *
 * The end-to-end pin, through the real `ReportView`, is
 * `ReportView.saveRefusal-11583.test.tsx`.
 *
 * Direction, written before the run: on the first round's head the `false`,
 * rejection and in-flight cases go RED (the panel closes before the save
 * settles); the `true` and legacy cases stay GREEN.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

vi.mock('./metadata-admin/inspectors/ReportDefaultInspector', () => ({
  ReportDefaultInspector: ({ draft, readOnly, onPatch }: any) => (
    <button
      type="button"
      data-testid="stub-report-edit"
      data-label={String(draft?.label)}
      data-readonly={String(readOnly)}
      onClick={() => onPatch({ label: 'Pipeline EDITED' })}
    >
      edit
    </button>
  ),
}));

// The draft bar, reduced to the one prop the panel drives.
vi.mock('./RuntimeDraftBar', () => ({
  RuntimeDraftBar: ({ dirty }: any) => <span data-testid="stub-draft-bar" data-dirty={String(dirty)} />,
}));

import { ReportConfigPanel } from './ReportConfigPanel';

function mount(onSave: (config: Record<string, any>) => unknown) {
  const onClose = vi.fn();
  render(
    <ReportConfigPanel
      open
      onClose={onClose}
      config={{ name: 'pipeline_by_quarter', label: 'Pipeline by Quarter', type: 'tabular' }}
      onSave={onSave as any}
    />,
  );
  return onClose;
}

const save = () => screen.getByTestId('report-config-save') as HTMLButtonElement;
const inspector = () => screen.getByTestId('stub-report-edit');
const dirty = () => screen.getByTestId('stub-draft-bar').getAttribute('data-dirty');

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('ReportConfigPanel — Save closes only after the save lands (objectui#11583, handleSave)', () => {
  it.each([
    { outcome: 'resolves false', onSave: () => Promise.resolve(false) },
    { outcome: 'rejects', onSave: () => Promise.reject(new Error('refused')) },
  ])('a save that $outcome keeps the panel open and dirty, with the edit and Save live', async ({ onSave }) => {
    const onClose = mount(onSave);
    fireEvent.click(inspector());
    expect(dirty()).toBe('true');

    await act(async () => {
      fireEvent.click(save());
    });

    await waitFor(() => expect(save().disabled).toBe(false));
    expect(onClose).not.toHaveBeenCalled();
    expect(dirty()).toBe('true');
    expect(inspector().getAttribute('data-label')).toBe('Pipeline EDITED');
  });

  it('a save that resolves true clears the panel and closes it (control)', async () => {
    const onSave = vi.fn(() => Promise.resolve(true));
    const onClose = mount(onSave);
    fireEvent.click(inspector());
    await act(async () => {
      fireEvent.click(save());
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ label: 'Pipeline EDITED' }));
    expect(dirty()).toBe('false');
  });

  it('a host that returns nothing is read as saved, as before (control)', async () => {
    const onSave = vi.fn();
    const onClose = mount(onSave);
    fireEvent.click(inspector());
    await act(async () => {
      fireEvent.click(save());
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('while the save is in flight, Save is disabled and the inspector is read-only', async () => {
    const pending = deferred<boolean>();
    const onSave = vi.fn(() => pending.promise);
    const onClose = mount(onSave);
    fireEvent.click(inspector());
    await act(async () => {
      fireEvent.click(save());
    });

    expect(save().disabled).toBe(true);
    expect(inspector().getAttribute('data-readonly')).toBe('true');
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      pending.resolve(true);
      await pending.promise;
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
