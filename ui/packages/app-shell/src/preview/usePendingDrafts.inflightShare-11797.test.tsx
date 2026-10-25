/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#11797 — the pending-drafts ledger is read once per question, not
 * once per reader.
 *
 * Each surface that shows the count mounts `usePendingDrafts` (which reads on
 * mount) AND calls the hook's `refresh()` from a mount effect of its own: the
 * Studio topbar from its publish/draft-nonce effect, the chat bar from its
 * idle-edge effect. `Surface` below is that shape. With two such surfaces
 * open on one package, every one of those reads sent its own identical
 * `GET /api/v1/meta/_drafts` request.
 *
 * Counted on the wire: the stubbed `fetch` holds every request open until the
 * test answers it, so "at once" means the first request is genuinely pending
 * when the next read is asked.
 *
 * The rules pinned besides the one-request count:
 *   - a different scope is a different question;
 *   - the entry goes when the request settles, so a later refresh asks again
 *     (no reuse window);
 *   - a failure reaches every reader that shared it and is not remembered;
 *   - a publish pulse drops the pending request, so the reads it triggers are
 *     never answered by a request sent before the publish — and they share
 *     ONE new request between them.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { fetchPendingDrafts, usePendingDrafts } from './usePendingDrafts.js';
import { emitMetadataRefresh } from '../assistant/assistantBus.js';

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

/**
 * A surface showing the count: the hook, plus its own mount refresh. The
 * button is the surface-local trigger (a draft saved, a turn gone idle).
 */
function Surface({ id, packageId }: { id: string; packageId: string | null }) {
  const { count, refresh } = usePendingDrafts({ packageId });
  React.useEffect(() => {
    void refresh();
  }, [refresh]);
  return (
    <>
      <span data-testid={id}>{count === null ? 'unknown' : String(count)}</span>
      <button type="button" data-testid={`${id}-refresh`} onClick={() => void refresh()} />
    </>
  );
}

async function drain() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('usePendingDrafts — one request per question, not per reader (objectui#11797)', () => {
  it('two surfaces opening one package put one `_drafts` request on the wire, and both show its count', async () => {
    const { held, reads } = heldFetch();
    render(
      <>
        <Surface id="topbar" packageId="app.crm" />
        <Surface id="chatbar" packageId="app.crm" />
      </>,
    );
    await act(drain);
    expect(reads(CRM)).toHaveLength(1);
    expect(held).toHaveLength(1);

    await act(async () => reads(CRM)[0].respond(200, { drafts: [draft('crm_account'), draft('crm_contact')] }));
    await waitFor(() => expect(screen.getByTestId('topbar').textContent).toBe('2'));
    expect(screen.getByTestId('chatbar').textContent).toBe('2');
  });

  it('a caller editing its entries in its own continuation leaves another caller untouched', async () => {
    // Every caller maps the shared payload itself into new entries that hold
    // only primitives, so no caller is handed anything that points into the
    // payload or into another caller's list.
    const { reads } = heldFetch();
    const first = fetchPendingDrafts('app.crm').then((mine) => {
      mine[0].name = 'edited-by-first';
      mine.push({ type: 'view', name: 'extra', packageId: null });
      return mine;
    });
    const second = fetchPendingDrafts('app.crm');
    await drain();
    expect(reads(CRM)).toHaveLength(1);
    reads(CRM)[0].respond(200, { drafts: [draft('crm_account')] });

    expect((await first).map((d) => d.name)).toEqual(['edited-by-first', 'extra']);
    expect(await second).toEqual([{ type: 'object', name: 'crm_account', packageId: 'app.crm' }]);
  });

  it('keeps different scopes apart', async () => {
    const { held, reads } = heldFetch();
    render(
      <>
        <Surface id="pkg" packageId="app.crm" />
        <Surface id="org" packageId={null} />
      </>,
    );
    await act(drain);
    expect(reads(CRM)).toHaveLength(1);
    expect(reads('/api/v1/meta/_drafts')).toHaveLength(1);
    expect(held).toHaveLength(2);
  });

  it('is not a response cache: a refresh after the answer asks the server again', async () => {
    const { reads } = heldFetch();
    render(<Surface id="topbar" packageId="app.crm" />);
    await act(drain);
    await act(async () => reads(CRM)[0].respond(200, [draft('crm_account')]));
    await waitFor(() => expect(screen.getByTestId('topbar').textContent).toBe('1'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('topbar-refresh'));
      await drain();
    });
    expect(reads(CRM)).toHaveLength(2);
    await act(async () => reads(CRM)[1].respond(200, []));
    await waitFor(() => expect(screen.getByTestId('topbar').textContent).toBe('0'));
  });

  it('a failed request leaves every reader that shared it at "unknown", and is not remembered', async () => {
    const { reads } = heldFetch();
    render(
      <>
        <Surface id="topbar" packageId="app.crm" />
        <Surface id="chatbar" packageId="app.crm" />
      </>,
    );
    await act(drain);
    expect(reads(CRM)).toHaveLength(1);
    await act(async () => reads(CRM)[0].respond(503, { success: false }));
    await act(drain);
    expect(screen.getByTestId('topbar').textContent).toBe('unknown');
    expect(screen.getByTestId('chatbar').textContent).toBe('unknown');

    await act(async () => {
      fireEvent.click(screen.getByTestId('topbar-refresh'));
      fireEvent.click(screen.getByTestId('chatbar-refresh'));
      await drain();
    });
    expect(reads(CRM)).toHaveLength(2);
    await act(async () => reads(CRM)[1].respond(200, [draft('crm_account')]));
    await waitFor(() => expect(screen.getByTestId('topbar').textContent).toBe('1'));
    expect(screen.getByTestId('chatbar').textContent).toBe('1');
  });

  it('a publish pulse while a read is pending sends ONE new request, and its answer wins', async () => {
    const { reads } = heldFetch();
    render(
      <>
        <Surface id="topbar" packageId="app.crm" />
        <Surface id="chatbar" packageId="app.crm" />
      </>,
    );
    await act(drain);
    expect(reads(CRM)).toHaveLength(1);

    // Published while the mount read is still on the wire: the reads the pulse
    // triggers must not join it, and must not each send their own either.
    await act(async () => {
      emitMetadataRefresh();
      await drain();
    });
    expect(reads(CRM)).toHaveLength(2);

    await act(async () => {
      reads(CRM)[0].respond(200, [draft('crm_account'), draft('crm_contact')]);
      reads(CRM)[1].respond(200, []);
      await drain();
    });
    await waitFor(() => expect(screen.getByTestId('topbar').textContent).toBe('0'));
    expect(screen.getByTestId('chatbar').textContent).toBe('0');
  });
});
