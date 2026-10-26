/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12112 — `probeMetaItemAccess`, the by-name access probe for any
 * type the server gates per caller, read over the wire.
 *
 * Since objectstack#22731 a dashboard and a list view the caller does not hold
 * are refused by name with "the app arm's whole refusal (same emitter, same
 * envelope)": `403` `{ success: false, error: { code: 'PERMISSION_DENIED',
 * message } }`, the message naming the item. The verdicts are read exactly as
 * `probeAppAccess` reads them (`appAccessProbe.test.ts` pins that reading for
 * an app), and the refusal's own sentence comes back with `denied`, so the
 * console can show it.
 *
 * Every case goes through the real `ObjectStackClient` over a stubbed `fetch`,
 * so the client's own error stamping (`error.code` off `body.error.code`,
 * `error.message` off `body.error.message`) is part of what is measured.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackAdapter } from './index';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function makeAdapter(answer: (url: string) => Response) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => answer(String(input)));
  const adapter = new ObjectStackAdapter({ baseUrl: 'http://test.local', fetch: fetchImpl });
  return { adapter, fetchImpl };
}

/** The refusal objectstack#22731 answers for a dashboard, in the app's envelope. */
const DASHBOARD_REFUSAL = "You do not have permission to open the 'legal_board' dashboard.";
const VIEW_REFUSAL = "You do not have permission to open the 'clm_contract.legal_review' view.";
const refused = (message: string) => ({ success: false, error: { code: 'PERMISSION_DENIED', message } });

describe('ObjectStackAdapter.probeMetaItemAccess — over the wire (objectui#12112)', () => {
  it('a refused dashboard: `denied`, with the server\'s sentence, asked at the by-name address', async () => {
    const { adapter, fetchImpl } = makeAdapter(() => json(403, refused(DASHBOARD_REFUSAL)));

    await expect(adapter.probeMetaItemAccess('dashboard', 'legal_board')).resolves.toEqual({
      verdict: 'denied',
      message: DASHBOARD_REFUSAL,
    });
    expect(String(fetchImpl.mock.calls[0][0])).toContain('/api/v1/meta/dashboard/legal_board');
  });

  it('a refused list view: `denied`, with the server\'s sentence', async () => {
    const { adapter, fetchImpl } = makeAdapter(() => json(403, refused(VIEW_REFUSAL)));

    await expect(adapter.probeMetaItemAccess('view', 'clm_contract.legal_review')).resolves.toEqual({
      verdict: 'denied',
      message: VIEW_REFUSAL,
    });
    expect(String(fetchImpl.mock.calls[0][0])).toContain('/api/v1/meta/view/clm_contract.legal_review');
  });

  it('a name with nothing behind it (the item-less 200) is `not_found`, with no sentence', async () => {
    const { adapter } = makeAdapter(() =>
      json(200, { type: 'dashboard', name: 'no_such_board', lock: 'none', editable: true }),
    );
    await expect(adapter.probeMetaItemAccess('dashboard', 'no_such_board')).resolves.toEqual({ verdict: 'not_found' });
  });

  it('a served item is `granted`', async () => {
    const { adapter } = makeAdapter(() =>
      json(200, { type: 'dashboard', name: 'ops', item: { name: 'ops', label: 'Operations' } }),
    );
    await expect(adapter.probeMetaItemAccess('dashboard', 'ops')).resolves.toEqual({ verdict: 'granted' });
  });

  it('a 403 without the code is `unreachable` — the code refuses, never the status', async () => {
    const { adapter } = makeAdapter(() =>
      json(403, { error: { code: 'CSRF_TOKEN_INVALID', message: 'stale token' } }),
    );
    await expect(adapter.probeMetaItemAccess('view', 'clm_contract.legal_review')).resolves.toEqual({
      verdict: 'unreachable',
    });
  });

  it('nothing is asked for an empty name or type', async () => {
    const { adapter, fetchImpl } = makeAdapter(() => json(200, {}));
    await expect(adapter.probeMetaItemAccess('dashboard', '')).resolves.toEqual({ verdict: 'unknown' });
    await expect(adapter.probeMetaItemAccess('', 'legal_board')).resolves.toEqual({ verdict: 'unknown' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('`probeAppAccess` is the same probe for `app`, answering its verdict alone', async () => {
    const { adapter, fetchImpl } = makeAdapter(() =>
      json(403, refused("You do not have permission to open the 'finance' app.")),
    );
    await expect(adapter.probeAppAccess('finance')).resolves.toBe('denied');
    expect(String(fetchImpl.mock.calls[0][0])).toContain('/api/v1/meta/app/finance');
  });
});
