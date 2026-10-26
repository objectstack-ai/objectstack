// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13139 — a runtime draft write moves the draft preview bar's count.
 *
 * The bar counts pending drafts through `usePendingDrafts`, which re-reads on
 * the assistant bus's `emitMetadataRefresh()` pulse (and on a route change).
 * The runtime view-config Save and Publish write through this seam and raised
 * no pulse, so after a Save the bar still showed no pending change, and after
 * a Publish it still offered its Publish button, until a reload.
 *
 * Pinned through the real `DraftPreviewBar`, on the object list route the
 * card's steps start from, against a fake `_drafts` ledger the fake metadata
 * client writes to. Each `_drafts` answer is the ledger as it stood when the
 * request was SENT, so a read sent before a write cannot count it.
 *
 * The bar's state is read from its controls and its count, not its copy: the
 * Changes button carries the count as `(N)`, and both it and Publish are gone
 * exactly when the count is a known zero.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../preview/PreviewModeContext', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePreviewDrafts: () => true,
  markPreviewExit: vi.fn(),
}));
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? _k,
  }),
}));
vi.mock('../preview/usePublishAllDrafts', () => ({
  usePublishAllDrafts: () => ({ publishAll: vi.fn(async () => ({ ok: true })), publishing: false }),
}));
vi.mock('../preview/DraftChangesPanel', () => ({ DraftChangesPanel: () => null }));

import { DraftPreviewBar } from '../preview/DraftPreviewBar';
import { subscribeMetadataRefresh } from '../assistant/assistantBus';
import {
  createRuntimeMetadata,
  discardRuntimeDraft,
  persistRuntimeMetadata,
  publishRuntimeMetadata,
} from './runtime-metadata-persistence';

const OBJECT = 'showcase_account';
const VIEW = 'showcase_account.all_accounts';
const LIST_ROUTE = `/apps/showcase_app/${OBJECT}/view/${VIEW}?preview=draft`;

/** A `_drafts` ledger the fake metadata client writes, served through `fetch`. */
function fakeServer(initial: Array<{ type: string; name: string }> = []) {
  const ledger = new Map(initial.map((d) => [`${d.type}/${d.name}`, d]));
  const draftsReads = vi.fn(async (input: RequestInfo | URL) => {
    expect(String(input)).toBe('/api/v1/meta/_drafts');
    const answer = [...ledger.values()].map((d) => ({ ...d, packageId: null }));
    return { ok: true, status: 200, json: async () => answer };
  });
  vi.stubGlobal('fetch', draftsReads);
  const metadataClient = {
    save: vi.fn(async (type: string, name: string) => {
      ledger.set(`${type}/${name}`, { type, name });
    }),
    publish: vi.fn(async (type: string, name: string) => {
      ledger.delete(`${type}/${name}`);
    }),
    reset: vi.fn(async (type: string, name: string) => {
      ledger.delete(`${type}/${name}`);
    }),
    get: vi.fn(async () => null),
  };
  return { draftsReads, metadataClient };
}

function renderBar() {
  return render(
    <MemoryRouter initialEntries={[LIST_ROUTE]}>
      <Routes>
        <Route path="/apps/:appName/*" element={<DraftPreviewBar />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The bar knows nothing is pending: no Changes button, no Publish. */
async function expectNonePending() {
  await waitFor(() => {
    expect(screen.queryByTestId('draft-preview-changes')).not.toBeInTheDocument();
    expect(screen.queryByTestId('draft-preview-publish')).not.toBeInTheDocument();
  });
  expect(screen.getByTestId('draft-preview-bar')).toBeInTheDocument();
}

/** The bar counts `n` pending drafts and offers Publish. */
async function expectPending(n: number) {
  await waitFor(() => expect(screen.getByTestId('draft-preview-changes')).toHaveTextContent(`(${n})`));
  expect(screen.getByTestId('draft-preview-publish')).toBeInTheDocument();
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a runtime draft write moves the draft preview bar (objectui#13139)', () => {
  it('Save then Publish of a view config: the bar counts the draft, then counts none', async () => {
    const { metadataClient } = fakeServer();
    renderBar();
    await expectNonePending();

    // Step 2 — Edit view config → Save stages a draft of the view.
    await act(async () => {
      await persistRuntimeMetadata('view', VIEW, { label: 'Renamed' }, { metadataClient, objectName: OBJECT });
    });
    await expectPending(1);

    // Step 3 — the panel's Publish promotes it.
    await act(async () => {
      await publishRuntimeMetadata('view', VIEW, { metadataClient, objectName: OBJECT });
    });
    await expectNonePending();
  });

  it('a create and a discard move it too — every write in the seam announces itself', async () => {
    const { metadataClient } = fakeServer();
    renderBar();
    await expectNonePending();

    await act(async () => {
      await createRuntimeMetadata('view', VIEW, { name: VIEW, object: OBJECT }, { metadataClient, objectName: OBJECT });
    });
    await expectPending(1);

    await act(async () => {
      await discardRuntimeDraft('view', VIEW, { metadataClient, objectName: OBJECT });
    });
    await expectNonePending();
  });

  it('a refused save or publish raises no pulse, and the bar keeps its count', async () => {
    const { draftsReads, metadataClient } = fakeServer([{ type: 'view', name: VIEW }]);
    const pulses = vi.fn();
    const unsubscribe = subscribeMetadataRefresh(pulses);
    try {
      renderBar();
      await expectPending(1);
      const readsBefore = draftsReads.mock.calls.length;

      metadataClient.save.mockRejectedValueOnce(new Error('422 refused'));
      await act(async () => {
        await expect(
          persistRuntimeMetadata('view', VIEW, { label: 'x' }, { metadataClient, objectName: OBJECT }),
        ).rejects.toThrow('422 refused');
      });
      metadataClient.publish.mockRejectedValueOnce(new Error('409 refused'));
      await act(async () => {
        await expect(
          publishRuntimeMetadata('view', VIEW, { metadataClient, objectName: OBJECT }),
        ).rejects.toThrow('409 refused');
      });

      expect(pulses).not.toHaveBeenCalled();
      expect(draftsReads.mock.calls.length).toBe(readsBefore);
      await expectPending(1);

      // Control: the same subscriber and read counter do see a write that lands.
      await act(async () => {
        await publishRuntimeMetadata('view', VIEW, { metadataClient, objectName: OBJECT });
      });
      expect(pulses).toHaveBeenCalledTimes(1);
      await expectNonePending();
      expect(draftsReads.mock.calls.length).toBeGreaterThan(readsBefore);
    } finally {
      unsubscribe();
    }
  });

  it('a pulse listener that throws does not turn a landed save into a failure', async () => {
    const { metadataClient } = fakeServer();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const unsubscribe = subscribeMetadataRefresh(() => {
      throw new Error('listener blew up');
    });
    try {
      await expect(
        persistRuntimeMetadata('view', VIEW, { label: 'x' }, { metadataClient, objectName: OBJECT }),
      ).resolves.toBeUndefined();
      expect(metadataClient.save).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[1]).toBeInstanceOf(Error);
    } finally {
      unsubscribe();
    }
  });
});
