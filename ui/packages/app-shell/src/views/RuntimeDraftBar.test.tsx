// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { RuntimeDraftBar } from './RuntimeDraftBar';

/**
 * ADR-0034 draft/publish chrome tests.
 *
 * The bar reads the pending draft on open, surfaces the indicator + Publish +
 * Discard when one exists, and resumes the draft into the editor. It renders
 * nothing until there is a pending draft.
 */

function makeMetadataClient(draftItem: unknown = null) {
  return {
    get: vi.fn().mockResolvedValue(draftItem),
    publish: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(undefined),
  };
}

describe('RuntimeDraftBar (ADR-0034)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the indicator + publish when a draft is pending, and resumes it', async () => {
    const metadataClient = makeMetadataClient({
      type: 'view',
      name: 'my_view',
      item: { columns: ['name'] },
    });
    const onResume = vi.fn();

    render(
      <RuntimeDraftBar
        type="view"
        name="my_view"
        metadataClient={metadataClient}
        onResume={onResume}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('runtime-draft-bar')).toBeTruthy());
    expect(screen.getByTestId('runtime-draft-publish')).toBeTruthy();
    expect(screen.getByTestId('runtime-draft-discard')).toBeTruthy();
    expect(metadataClient.get).toHaveBeenCalledWith('view', 'my_view', { state: 'draft' });
    expect(onResume).toHaveBeenCalledWith({ columns: ['name'] });
  });

  it('still shows the indicator when onResume throws (resume is best-effort)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const metadataClient = makeMetadataClient({ item: { columns: ['name'] } });
    const onResume = vi.fn(() => {
      throw new Error('seed failed');
    });

    render(
      <RuntimeDraftBar
        type="view"
        name="my_view"
        metadataClient={metadataClient}
        onResume={onResume}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('runtime-draft-bar')).toBeTruthy());
    expect(onResume).toHaveBeenCalled();
  });

  it('renders nothing when there is no pending draft', async () => {
    const metadataClient = makeMetadataClient(null);

    const { container } = render(
      <RuntimeDraftBar type="report" name="my_report" metadataClient={metadataClient} />,
    );

    await waitFor(() => expect(metadataClient.get).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="runtime-draft-bar"]')).toBeNull();
  });

  it('publishes the pending draft on click', async () => {
    const metadataClient = makeMetadataClient({ item: { columns: ['name'] } });
    const onAfterChange = vi.fn();

    render(
      <RuntimeDraftBar
        type="dashboard"
        name="my_dash"
        metadataClient={metadataClient}
        onAfterChange={onAfterChange}
      />,
    );

    const publishBtn = await screen.findByTestId('runtime-draft-publish');
    fireEvent.click(publishBtn);

    await waitFor(() =>
      expect(metadataClient.publish).toHaveBeenCalledWith('dashboard', 'my_dash'),
    );
    expect(onAfterChange).toHaveBeenCalled();
  });

  it('Publish is disabled while the panel has unsaved edits (dirty)', async () => {
    const metadataClient = makeMetadataClient({ item: { columns: ['name'] } });

    render(
      <RuntimeDraftBar type="view" name="my_view" metadataClient={metadataClient} dirty />,
    );

    const publishBtn = await screen.findByTestId('runtime-draft-publish');
    expect((publishBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('surfaces the indicator immediately when savedSignal bumps (no read race)', async () => {
    const metadataClient = makeMetadataClient(null); // no draft on initial read

    const { rerender, container } = render(
      <RuntimeDraftBar type="view" name="my_view" metadataClient={metadataClient} savedSignal={0} />,
    );

    await waitFor(() => expect(metadataClient.get).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="runtime-draft-bar"]')).toBeNull();

    // Host saved a draft → bump the signal → indicator appears at once.
    rerender(
      <RuntimeDraftBar type="view" name="my_view" metadataClient={metadataClient} savedSignal={1} />,
    );
    await waitFor(() => expect(screen.getByTestId('runtime-draft-bar')).toBeTruthy());
  });

  // objectui#12690 — the confirm string this bar shares with the metadata edit
  // page now takes one `{item}`; the bar holds no label, so it keeps naming
  // the machine `type/name`, with no placeholder left unfilled.
  it('the discard confirm names type/name, with every placeholder filled', async () => {
    const confirmSpy = vi.fn(() => false);
    vi.stubGlobal('confirm', confirmSpy);
    const metadataClient = makeMetadataClient({ item: { columns: ['name'] } });

    render(<RuntimeDraftBar type="view" name="my_view" metadataClient={metadataClient} />);

    fireEvent.click(await screen.findByTestId('runtime-draft-discard'));

    expect(confirmSpy).toHaveBeenCalledWith('Discard the pending draft for view/my_view?');
    expect(metadataClient.reset).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('stays inert until a name is known', async () => {
    const metadataClient = makeMetadataClient({ item: { a: 1 } });

    const { container } = render(
      <RuntimeDraftBar type="view" metadataClient={metadataClient} />,
    );

    expect(container.querySelector('[data-testid="runtime-draft-bar"]')).toBeNull();
    expect(metadataClient.get).not.toHaveBeenCalled();
  });
});
