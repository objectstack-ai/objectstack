/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#11787 — the count read after a draft save is sent after it, and
 * until it answers the count is known to be at least one.
 *
 * Studio's header showed "No drafts pending publish" beside an item's
 * "Unpublished draft" chip after a save, until the count caught up. Two causes
 * meet in this hook:
 *   - the read a save asks for could JOIN a `_drafts` request already on the
 *     wire (objectui#11797's sharing), sent before the save and so unable to
 *     count the draft it wrote;
 *   - until any read answers, the count shown is the one from before the save.
 *
 * Counted on the wire with the same held `fetch` the objectui#11797 pins use:
 * every request stays open until the test answers it.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { usePendingDrafts } from './usePendingDrafts.js';

interface HeldRequest {
  url: string;
  respond: (status: number, body: unknown) => void;
}

function heldFetch() {
  const held: HeldRequest[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (input: RequestInfo | URL) =>
        new Promise((resolve) => {
          held.push({
            url: String(input),
            respond: (status, body) =>
              resolve({ ok: status >= 200 && status < 300, status, json: async () => body }),
          });
        }),
    ),
  );
  const reads = (url: string) => held.filter((r) => r.url === url);
  return { held, reads };
}

const CRM = '/api/v1/meta/_drafts?packageId=app.crm';
const draft = (name: string) => ({ type: 'object', name, packageId: 'app.crm' });

/** The Studio header's shape: the count, whether it is behind a save, and the save's refresh. */
function Header() {
  const { count, refresh, behindSave } = usePendingDrafts({ packageId: 'app.crm' });
  return (
    <>
      <span data-testid="count">{count === null ? 'unknown' : String(count)}</span>
      <span data-testid="behind">{String(behindSave)}</span>
      <button type="button" data-testid="saved" onClick={() => void refresh({ afterSave: true })} />
      <button type="button" data-testid="refresh" onClick={() => void refresh()} />
    </>
  );
}

async function drain() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('usePendingDrafts — the read after a draft save (objectui#11787)', () => {
  it('is sent fresh while an earlier read is still on the wire, and its answer wins', async () => {
    const { reads } = heldFetch();
    render(<Header />);
    await act(drain);
    expect(reads(CRM)).toHaveLength(1);

    // A draft save lands while the mount read is still pending.
    await act(async () => {
      fireEvent.click(screen.getByTestId('saved'));
      await drain();
    });
    // Not joined to the request sent before the save.
    expect(reads(CRM)).toHaveLength(2);
    // Until a read sent after the save answers, the count is behind it.
    expect(screen.getByTestId('behind').textContent).toBe('true');

    // The pre-save read answers first, with the ledger as it was: ignored.
    await act(async () => reads(CRM)[0].respond(200, []));
    await act(drain);
    expect(screen.getByTestId('count').textContent).toBe('unknown');
    expect(screen.getByTestId('behind').textContent).toBe('true');

    // The post-save read counts the draft the save wrote.
    await act(async () => reads(CRM)[1].respond(200, [draft('crm_account')]));
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
    expect(screen.getByTestId('behind').textContent).toBe('false');
  });

  it('CONTROL — a refresh that is not after a save still shares the pending read (objectui#11797)', async () => {
    const { reads } = heldFetch();
    render(<Header />);
    await act(drain);
    await act(async () => {
      fireEvent.click(screen.getByTestId('refresh'));
      await drain();
    });
    expect(reads(CRM)).toHaveLength(1);
    expect(screen.getByTestId('behind').textContent).toBe('false');
  });

  it('stays behind when the read after the save fails, and a later answer clears it', async () => {
    const { reads } = heldFetch();
    render(<Header />);
    await act(drain);
    await act(async () => reads(CRM)[0].respond(200, []));
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('0'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('saved'));
      await drain();
    });
    await act(async () => reads(CRM)[1].respond(503, { success: false }));
    await act(drain);
    // The save is not in doubt: the draft it wrote exists.
    expect(screen.getByTestId('count').textContent).toBe('unknown');
    expect(screen.getByTestId('behind').textContent).toBe('true');

    await act(async () => {
      fireEvent.click(screen.getByTestId('refresh'));
      await drain();
    });
    await act(async () => reads(CRM)[2].respond(200, [draft('crm_account')]));
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
    expect(screen.getByTestId('behind').textContent).toBe('false');
  });
});
