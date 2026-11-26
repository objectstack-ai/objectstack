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
    getDraft: vi.fn().mockResolvedValue(draftItem),
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
    expect(metadataClient.getDraft).toHaveBeenCalledWith('view', 'my_view');
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

    await waitFor(() => expect(metadataClient.getDraft).toHaveBeenCalled());
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

    await waitFor(() => expect(metadataClient.getDraft).toHaveBeenCalled());
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
    expect(metadataClient.getDraft).not.toHaveBeenCalled();
  });
});

/**
 * objectstack#36350 (ruling 7168616260) — the bar's Publish is pinned to the
 * draft the bar showed: the version its draft read's envelope carried, sent as
 * `draftVersion`. A draft another writer changed since is refused by the door
 * (`409 METADATA_CONFLICT`) instead of being published on that writer's behalf.
 */
describe('RuntimeDraftBar — Publish is pinned to the draft it showed (objectstack#36350)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends the shown draft\'s version as `draftVersion`', async () => {
    const metadataClient = makeMetadataClient({
      type: 'report',
      name: 'my_report',
      item: { label: 'Pipeline' },
      version: 'hmac-sha256:draft-v1',
    });

    render(<RuntimeDraftBar type="report" name="my_report" metadataClient={metadataClient} />);
    fireEvent.click(await screen.findByTestId('runtime-draft-publish'));

    await waitFor(() =>
      expect(metadataClient.publish).toHaveBeenCalledWith('report', 'my_report', { draftVersion: 'hmac-sha256:draft-v1' }),
    );
  });

  it('a moved draft\'s refusal is said and the indicator stays: nothing was published', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const metadataClient = makeMetadataClient({
      type: 'report',
      name: 'my_report',
      item: { label: 'Pipeline' },
      version: 'hmac-sha256:draft-v1',
    });
    metadataClient.publish.mockRejectedValue(
      Object.assign(new Error('report/my_report draft changed since the version this publish pinned (draftVersion)'), {
        status: 409,
        code: 'METADATA_CONFLICT',
      }),
    );

    render(<RuntimeDraftBar type="report" name="my_report" metadataClient={metadataClient} />);
    fireEvent.click(await screen.findByTestId('runtime-draft-publish'));

    await waitFor(() => expect(metadataClient.publish).toHaveBeenCalled());
    expect(screen.getByTestId('runtime-draft-bar')).toBeTruthy();
  });

  it('after the host\'s own save (savedSignal) the Publish is pinned to that save\'s receipt version, not to the draft read before it', async () => {
    const metadataClient = makeMetadataClient({
      type: 'view',
      name: 'my_view',
      item: { columns: ['name'] },
      version: 'hmac-sha256:draft-v1',
    });

    const { rerender } = render(
      <RuntimeDraftBar type="view" name="my_view" metadataClient={metadataClient} savedSignal={0} />,
    );
    await screen.findByTestId('runtime-draft-publish');
    // The view settings saved: its receipt names the draft it wrote.
    rerender(
      <RuntimeDraftBar
        type="view"
        name="my_view"
        metadataClient={metadataClient}
        savedSignal={1}
        savedDraftVersion="hmac-sha256:saved-v2"
      />,
    );
    fireEvent.click(await screen.findByTestId('runtime-draft-publish'));

    await waitFor(() =>
      expect(metadataClient.publish).toHaveBeenCalledWith('view', 'my_view', { draftVersion: 'hmac-sha256:saved-v2' }),
    );
    // ⛔ No re-read pins it: one draft read, on open.
    expect(metadataClient.getDraft).toHaveBeenCalledTimes(1);
  });

  it('save-then-publish window: another writer\'s draft write after the host\'s save is refused at Publish, and the bar stays', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // No draft on open; the host's save writes one (receipt v2); then another
    // writer's rename moves it (v3, never shown here). The door refuses the
    // Publish pinned to v2.
    const metadataClient = makeMetadataClient(null);
    metadataClient.publish.mockImplementation(async (_t: string, _n: string, options?: { draftVersion?: string }) => {
      if (options?.draftVersion !== 'hmac-sha256:moved-v3') {
        throw Object.assign(new Error('view/my_view draft changed since the version this publish pinned (draftVersion)'), {
          status: 409,
          code: 'METADATA_CONFLICT',
        });
      }
      return {};
    });

    const { rerender } = render(
      <RuntimeDraftBar type="view" name="my_view" metadataClient={metadataClient} savedSignal={0} />,
    );
    await waitFor(() => expect(metadataClient.getDraft).toHaveBeenCalled());
    rerender(
      <RuntimeDraftBar
        type="view"
        name="my_view"
        metadataClient={metadataClient}
        savedSignal={1}
        savedDraftVersion="hmac-sha256:saved-v2"
      />,
    );
    fireEvent.click(await screen.findByTestId('runtime-draft-publish'));

    await waitFor(() =>
      expect(metadataClient.publish).toHaveBeenCalledWith('view', 'my_view', { draftVersion: 'hmac-sha256:saved-v2' }),
    );
    // Refused: nothing published, the indicator stays for the author to review.
    expect(screen.getByTestId('runtime-draft-bar')).toBeTruthy();
  });

  it('a host that gives no receipt version leaves the Publish after its save unpinned', async () => {
    const metadataClient = makeMetadataClient({ item: { columns: ['name'] }, version: 'hmac-sha256:draft-v1' });

    const { rerender } = render(
      <RuntimeDraftBar type="view" name="my_view" metadataClient={metadataClient} savedSignal={0} />,
    );
    await screen.findByTestId('runtime-draft-publish');
    rerender(<RuntimeDraftBar type="view" name="my_view" metadataClient={metadataClient} savedSignal={1} />);
    fireEvent.click(await screen.findByTestId('runtime-draft-publish'));

    await waitFor(() => expect(metadataClient.publish).toHaveBeenCalledWith('view', 'my_view'));
  });
});
