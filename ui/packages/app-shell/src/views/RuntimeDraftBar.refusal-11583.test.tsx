// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11583: the draft bar's Publish and Discard say a refused write.
 *
 * ## The defect this pins
 *
 * `RuntimeDraftBar.handlePublish` and `handleDiscard` caught a refused
 * `publishRuntimeMetadata` / `discardRuntimeDraft` with `console.error` only.
 * The spinner stopped, the "unpublished changes" indicator stayed, and nothing
 * told the user the draft was neither published nor discarded.
 *
 * ## What runs
 *
 * The real bar and the real persistence seam, over a metadata client double
 * whose `publish` / `reset` reject the way `MetadataClient` does: an error
 * whose message is the refusal's own text. The bar has a draft pending, so
 * both buttons render.
 *
 * Direction, written before the run: on the unmodified tree both refused cases
 * go RED (no `toast.error`), and both controls stay GREEN.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act, cleanup } from '@testing-library/react';
import { toast } from 'sonner';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(),
    warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));

import { RuntimeDraftBar } from './RuntimeDraftBar';

const refusal = (message: string) => Object.assign(new Error(message), { status: 403 });

function makeMetadataClient(writes: Record<string, unknown> = {}) {
  return {
    get: vi.fn().mockResolvedValue({ type: 'view', name: 'crm_deal.pipeline', item: { label: 'Pipeline' } }),
    publish: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(undefined),
    ...writes,
  };
}

async function mountWithDraft(metadataClient: ReturnType<typeof makeMetadataClient>, onAfterChange = vi.fn()) {
  render(
    <RuntimeDraftBar
      type="view"
      name="crm_deal.pipeline"
      metadataClient={metadataClient}
      onAfterChange={onAfterChange}
    />,
  );
  await screen.findByTestId('runtime-draft-bar');
  return onAfterChange;
}

const errorDescription = () => {
  const [, options] = vi.mocked(toast.error).mock.calls[0] as [unknown, { description?: unknown } | undefined];
  return String(options?.description);
};

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // Discard asks first; the user says yes.
  vi.stubGlobal('confirm', vi.fn(() => true));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('RuntimeDraftBar says a refused Publish (objectui#11583, handlePublish)', () => {
  it('a refused publish raises the refusal, and the draft is still announced', async () => {
    const client = makeMetadataClient({
      publish: vi.fn().mockRejectedValue(refusal('Publishing views requires the Manage Metadata permission')),
    });
    const onAfterChange = await mountWithDraft(client);
    await act(async () => {
      fireEvent.click(screen.getByTestId('runtime-draft-publish'));
    });

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(errorDescription()).toContain('Publishing views requires the Manage Metadata permission');
    expect(screen.getByTestId('runtime-draft-indicator')).toBeTruthy();
    expect(onAfterChange).not.toHaveBeenCalled();
  });

  it('a publish that lands raises nothing and clears the bar (control)', async () => {
    const client = makeMetadataClient();
    const onAfterChange = await mountWithDraft(client);
    await act(async () => {
      fireEvent.click(screen.getByTestId('runtime-draft-publish'));
    });

    await waitFor(() => expect(screen.queryByTestId('runtime-draft-bar')).toBeNull());
    expect(client.publish).toHaveBeenCalledWith('view', 'crm_deal.pipeline');
    expect(onAfterChange).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('RuntimeDraftBar says a refused Discard (objectui#11583, handleDiscard)', () => {
  it('a refused discard raises the refusal, and the draft is still announced', async () => {
    const client = makeMetadataClient({
      reset: vi.fn().mockRejectedValue(refusal('Discarding drafts requires the Manage Metadata permission')),
    });
    const onAfterChange = await mountWithDraft(client);
    await act(async () => {
      fireEvent.click(screen.getByTestId('runtime-draft-discard'));
    });

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(errorDescription()).toContain('Discarding drafts requires the Manage Metadata permission');
    expect(screen.getByTestId('runtime-draft-indicator')).toBeTruthy();
    expect(onAfterChange).not.toHaveBeenCalled();
  });

  it('a discard that lands raises nothing and clears the bar (control)', async () => {
    const client = makeMetadataClient();
    const onAfterChange = await mountWithDraft(client);
    await act(async () => {
      fireEvent.click(screen.getByTestId('runtime-draft-discard'));
    });

    await waitFor(() => expect(screen.queryByTestId('runtime-draft-bar')).toBeNull());
    expect(client.reset).toHaveBeenCalledWith('view', 'crm_deal.pipeline', { state: 'draft' });
    expect(onAfterChange).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });
});
