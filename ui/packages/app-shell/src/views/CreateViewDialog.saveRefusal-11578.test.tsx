// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11578: the Create View dialog closes only on a save that succeeded.
 *
 * ## The defect this pins
 *
 * `handleSubmit` called `onCreate(payload)` and then `onOpenChange(false)` in
 * the same tick, without waiting for the save. Both persisting doors
 * (`ObjectDataPage`'s "Save as view" and `ObjectView.handleViewCreate`) save
 * asynchronously, so the dialog was already gone when the platform refused the
 * write: the user saw the dialog close as if the view existed.
 *
 * ## The contract pinned here
 *
 * `onCreate` resolves `true` once the view is saved and `false` when the save
 * was refused (the door has already told the user why). The dialog awaits it:
 * it closes on `true`; on `false` it stays open with the user's input intact
 * and Create enabled again; while the save is in flight Create is disabled, so
 * a second press cannot save twice. The two doors are pinned next door, in
 * `ObjectDataPage.saveAsViewRefusal-11578.test.tsx` and
 * `ObjectView.createViewRefusal-11578.test.tsx`.
 *
 * Direction, written before the run: on the unmodified tree the refused and
 * in-flight cases go RED (the dialog closes on press, and Create stays enabled
 * while the save runs); the saved case stays GREEN in both worlds, as the
 * control that the dialog still closes after a save.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor, screen, act } from '@testing-library/react';

// The open dialog lists the dataset catalog through the metadata client; serve
// it an empty one from a double, never the network.
const metadataClient = {
  list: vi.fn(async () => []),
  get: vi.fn(async () => null),
};
vi.mock('./metadata-admin/useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => metadataClient,
}));

import { CreateViewDialog } from './CreateViewDialog';

const DEAL = {
  name: 'crm_deal',
  label: 'Deal',
  fields: {
    name: { type: 'text', label: 'Name' },
    amount: { type: 'number', label: 'Amount' },
  },
};

const submit = () => screen.getByTestId('create-view-submit') as HTMLButtonElement;
const labelInput = () => screen.getByTestId('create-view-name-input') as HTMLInputElement;
const nameInput = () => screen.getByTestId('create-view-machine-name-input') as HTMLInputElement;

/** Mount the open dialog, type a label, and wait for Create to enable. */
async function openWithLabel(onCreate: (cfg: Record<string, unknown>) => boolean | Promise<boolean>) {
  const onOpenChange = vi.fn();
  render(<CreateViewDialog open onOpenChange={onOpenChange} onCreate={onCreate} objectDef={DEAL} />);
  fireEvent.change(labelInput(), { target: { value: 'Pipeline board' } });
  await waitFor(() => expect(nameInput().value).toBe('pipeline_board'));
  await waitFor(() => expect(submit().disabled).toBe(false));
  return onOpenChange;
}

/** Every `onOpenChange(false)` the dialog asked for: a close. */
const closes = (onOpenChange: ReturnType<typeof vi.fn>) =>
  onOpenChange.mock.calls.filter(([open]) => open === false).length;

beforeEach(() => {
  cleanup();
});

describe('the Create View dialog closes only on a saved view (objectui#11578)', () => {
  it('a refused save keeps the dialog open, the input intact, and Create enabled again', async () => {
    const onCreate = vi.fn(async () => false);
    const onOpenChange = await openWithLabel(onCreate);

    await act(async () => {
      fireEvent.click(submit());
    });

    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ type: 'grid', label: 'Pipeline board', name: 'pipeline_board' }));
    await waitFor(() => expect(submit().disabled).toBe(false));
    expect(closes(onOpenChange)).toBe(0);
    expect(labelInput().value).toBe('Pipeline board');
    expect(nameInput().value).toBe('pipeline_board');
  });

  it('a saved view closes the dialog (control)', async () => {
    const onCreate = vi.fn(async () => true);
    const onOpenChange = await openWithLabel(onCreate);

    await act(async () => {
      fireEvent.click(submit());
    });

    expect(onCreate).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(closes(onOpenChange)).toBe(1));
  });

  it('Create is disabled while the save is in flight, and a second press saves nothing', async () => {
    let settle!: (saved: boolean) => void;
    const onCreate = vi.fn(() => new Promise<boolean>((resolve) => { settle = resolve; }));
    const onOpenChange = await openWithLabel(onCreate);

    await act(async () => {
      fireEvent.click(submit());
    });
    await waitFor(() => expect(submit().disabled).toBe(true));
    // Enter in the label field is the dialog's other submit path.
    fireEvent.keyDown(labelInput(), { key: 'Enter' });
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(closes(onOpenChange)).toBe(0);

    await act(async () => {
      settle(false);
    });
    await waitFor(() => expect(submit().disabled).toBe(false));
    expect(closes(onOpenChange)).toBe(0);
  });
});
