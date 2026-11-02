// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29148 — the metadata designer takes a pending draft the server
 * refuses to read (`403 PERMISSION_DENIED`: a page carries the same audience
 * gate, `requiredPermissions`, as a dashboard) for what it is, never for "no
 * draft". Both reads that install the editor's buffer:
 *
 *  - the LOAD: no buffer is installed over the refused draft, so the published
 *    body is not offered to edit; the strip says why with the server's sentence
 *    behind Details, and no save door sends anything;
 *  - the re-read after a PUBLISH: a draft that remains and whose read is
 *    refused is not taken for "the draft is gone"; the editor closes onto the
 *    same strip instead of reopening on the published body.
 *
 * The client double refuses the draft read as the metadata client throws a
 * refused read (an `Error` carrying `status` and `code`), and resolves `null`
 * for no draft (the client's reading of a 404). Only the page canvas is
 * stubbed, to hand the test a way to dirty the buffer; the autosave and the
 * save door are shipping code.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { t } from './i18n';

const PAGE = {
  name: 'home',
  label: 'Home',
  type: 'home',
  template: 'default',
  regions: [{ name: 'main', components: [{ type: 'text', id: 'b1' }] }],
};
/** The pending draft: the published page plus an audience gate the author does not hold. */
const GATED_DRAFT = { ...PAGE, label: 'Home (draft)', requiredPermissions: ['crm.export_data'] };
const GATE_REFUSAL = "You do not have permission to read the pending draft of 'home'.";

type SaveOpts = { mode?: string; packageId?: string; ifMatch?: string; ifNoneMatch?: string };

const door = {
  draft: null as null | Record<string, unknown>,
  /** The draft read is refused as the read gate refuses it. */
  gated: false,
  /** A publish leaves the draft row behind, and its read is then refused. */
  gateAfterPublish: false,
  saves: [] as SaveOpts[],
};

const mockClient = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: PAGE, code: PAGE, editable: true })),
  getDraft: vi.fn(async (_type: string, _name: string, _opts?: { packageId?: string }) => {
    if (door.gated) {
      throw Object.assign(new Error(GATE_REFUSAL), {
        status: 403,
        code: 'PERMISSION_DENIED',
        body: { success: false, error: { code: 'PERMISSION_DENIED', message: GATE_REFUSAL } },
      });
    }
    return door.draft ? { type: 'page', name: 'home', item: JSON.parse(JSON.stringify(door.draft)), version: 'hmac-sha256:pending' } : null;
  }),
  get: vi.fn(async () => null),
  references: vi.fn(async () => []),
  publish: vi.fn(async () => {
    if (door.gateAfterPublish) {
      door.draft = GATED_DRAFT;
      door.gated = true;
    } else {
      door.draft = null;
    }
    return { success: true };
  }),
  reset: vi.fn(async () => ({})),
  save: vi.fn(async (_type: string, _name: string, item: unknown, opts?: SaveOpts) => {
    door.saves.push({ ...(opts ?? {}) });
    door.draft = JSON.parse(JSON.stringify(item)) as Record<string, unknown>;
    return { success: true, version: 'hmac-sha256:receipt', state: 'draft' };
  }),
};

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({
      entries: [{ type: 'page', name: 'page', label: 'Page', allowEnvironmentOverlay: true, schema: { required: [] } }],
    }),
  };
});

import { MetadataResourceEditPage } from './ResourceEditPage';
import { registerMetadataPreview, getMetadataPreview } from './preview-registry';

/** Canvas stand-in: its only job is to dirty the buffer, which arms the real autosave. */
function StubPageCanvas({ onPatch }: { onPatch?: (patch: Record<string, unknown>) => void }) {
  return (
    <button type="button" onClick={() => onPatch?.({ label: 'Edited in the designer' })}>
      patch the draft
    </button>
  );
}

const realPagePreview = getMetadataPreview('page');

beforeEach(() => {
  door.draft = null;
  door.gated = false;
  door.gateAfterPublish = false;
  door.saves.length = 0;
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  registerMetadataPreview('page', StubPageCanvas as never);
  window.history.replaceState(null, '', '/metadata/page/home?package=com.acme.app');
});

afterEach(() => {
  cleanup();
  if (realPagePreview) registerMetadataPreview('page', realPagePreview);
  window.history.replaceState(null, '', '/');
});

function renderEditor() {
  render(
    <MemoryRouter initialEntries={['/metadata/page/home?package=com.acme.app']}>
      <MetadataResourceEditPage type="page" name="home" />
    </MemoryRouter>,
  );
}

/** Longer than the autosave's debounce, so a save that was going to leave has left. */
async function pastTheAutosave() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 2500));
  });
}

async function expectRefusalStrip() {
  const message = await screen.findByTestId('studio-refusal-message', undefined, { timeout: 8000 });
  expect(message).toHaveTextContent(t('engine.studio.refusal.draftUnreadable', 'en-US'));
  // The server's own sentence stays reachable, behind Details.
  expect(screen.getByTestId('studio-refusal-detail')).toHaveTextContent(GATE_REFUSAL);
}

describe('MetadataResourceEditPage — a draft the server refuses to read is not "no draft" (objectstack#29148)', () => {
  it('the load opens no buffer over the refused draft: the strip says why, nothing is editable, and no save is sent', async () => {
    door.draft = GATED_DRAFT;
    door.gated = true;
    renderEditor();

    // Red on base: the refusal was read as "no draft", and the published page
    // was installed as the buffer and handed to the canvas to edit.
    await expectRefusalStrip();
    expect(mockClient.getDraft).toHaveBeenCalledWith('page', 'home', { packageId: 'com.acme.app' });
    expect(screen.queryByRole('button', { name: 'patch the draft' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Publish$/ })).toBeNull();

    await pastTheAutosave();
    expect(door.saves).toEqual([]);
    expect(door.draft).toStrictEqual(GATED_DRAFT);
  });

  it('the re-read after a publish: a remaining draft whose read is refused closes the editor onto the strip, and nothing is sent', async () => {
    door.draft = { ...PAGE, label: 'Home (pending)' };
    door.gateAfterPublish = true;
    renderEditor();

    await screen.findByRole('button', { name: 'patch the draft' }, { timeout: 8000 });
    const publish = screen.getAllByRole('button', { name: /^Publish$/ })[0]!;
    await waitFor(() => expect(publish).toBeEnabled(), { timeout: 8000 });
    fireEvent.click(publish);
    await waitFor(() => expect(mockClient.publish).toHaveBeenCalled(), { timeout: 8000 });

    // Red on base: the refused re-read was taken for "the draft is gone", and
    // the published page was reinstalled as the buffer, open to edit.
    await expectRefusalStrip();
    expect(screen.queryByRole('button', { name: 'patch the draft' })).toBeNull();

    await pastTheAutosave();
    expect(door.saves).toEqual([]);
    expect(door.draft).toStrictEqual(GATED_DRAFT);
  });

  it('CONTROL: with no pending draft the published page opens, and an edit saves pinned to "no draft row"', async () => {
    renderEditor();

    fireEvent.click(await screen.findByRole('button', { name: 'patch the draft' }, { timeout: 8000 }));
    expect(screen.queryByTestId('studio-refusal')).toBeNull();
    await waitFor(() => expect(door.saves).toHaveLength(1), { timeout: 8000 });
    expect(door.saves[0]).toMatchObject({ mode: 'draft', packageId: 'com.acme.app', ifNoneMatch: '*' });
    expect(door.saves[0]).not.toHaveProperty('ifMatch');
  });
});
