/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11902 — the record page says what its record read actually answered:
 * no access, not found, or could not load.
 *
 * The page's record load mapped EVERY rejection to `missing`, so a viewer whose
 * read was refused (403 `PERMISSION_DENIED`) was told the record "does not
 * exist or may have been deleted" — measured in a real browser against a
 * published 17.7.0 server by objectui#11878's run — and so was a viewer whose
 * read failed in transit or on a 5xx, where the page told them to stop trying.
 *
 * This file mounts the REAL page over the REAL `ObjectStackAdapter`, with only
 * the HTTP transport doubled, so each answer reaches the page in the shape the
 * adapter really hands it (measured before the fix, same harness):
 *
 *   - 403 → rejects with `httpStatus: 403`, `code: 'PERMISSION_DENIED'`;
 *   - 404 → RESOLVES `null` on both read paths (the `$expand` list read and the
 *     by-id GET), which is why `missing` stays the not-found state;
 *   - 500 → rejects with `httpStatus: 500`;
 *   - a transport failure → rejects with the `TypeError` `fetch` threw.
 *
 * The object declares a lookup, so the page's read takes the `$expand` path —
 * the one whose non-404 failure the adapter retries as a by-id GET before it
 * rejects (two wire requests for ONE page read). The pins count the page's
 * reads at the adapter, not at the wire, so they say how often the PAGE asked.
 *
 * Copy is asserted in `en` and `zh`, from the packs (no `defaultValue` path):
 * each answer renders its own state, a refusal names the object and never says
 * "not found", a failure offers a Retry that re-runs the page's own read, and
 * the two controls — a 404 and a found record — render as they did before.
 */
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada', image: null }, activeOrganization: null }),
}));
vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRecordPresence: () => [],
  PresenceAvatars: () => null,
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(),
    warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));

import { MetadataCtx } from '@object-ui/react';
import { I18nProvider, type I18nConfig } from '@object-ui/i18n';
import { ObjectStackAdapter } from '@object-ui/data-objectstack';
import { RecordDetailView } from './RecordDetailView';

const BASE = 'http://test.local';
const OBJECT = 'probe_invoice';
const REC = 'inv-11902';
const RECORD = { id: REC, name: 'Acme invoice', account: null };

const objectDef = {
  name: OBJECT,
  label: 'Invoice',
  managedBy: 'platform',
  fields: {
    id: { label: 'Id', type: 'text' },
    name: { label: 'Name', type: 'text' },
    account: { label: 'Account', type: 'lookup', reference: 'probe_account' },
  },
};

/** What the server answers for this object's record reads. */
type Answer = 'ok' | 'forbidden' | 'notFound' | 'serverError' | 'network';
let answer: Answer = 'ok';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/**
 * One transport for the adapter and for the page's global-`fetch` side reads.
 * Stubbed at module scope and never torn down, so no late side read can reach
 * a real socket after a test ends (the network-escape guard, objectui#6640).
 */
const transport = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const path = url.replace(BASE, '');
  if (path.endsWith('/api/v1/discovery')) {
    return json(200, { success: true, data: { capabilities: {}, routes: {} } });
  }
  if (path.startsWith(`/api/v1/data/${OBJECT}`)) {
    switch (answer) {
      // The refusal as the server sends it (measured on objectui#11878).
      case 'forbidden':
        return json(403, { error: `Permission denied: read on ${OBJECT}`, code: 'PERMISSION_DENIED', object: OBJECT });
      case 'notFound':
        return json(404, { error: 'Record not found', code: 'RECORD_NOT_FOUND' });
      case 'serverError':
        return json(500, { error: 'Internal server error', code: 'INTERNAL_ERROR' });
      case 'network':
        throw new TypeError('Failed to fetch');
      default:
        return path.includes('?')
          ? json(200, { success: true, data: { records: [RECORD], total: 1 } })
          : json(200, { success: true, data: { object: OBJECT, id: REC, record: RECORD } });
    }
  }
  if (path.endsWith('/security/explain')) return json(200, { allowed: true });
  return json(200, { success: true, data: [] });
});
vi.stubGlobal('fetch', transport);

const EN: I18nConfig = { defaultLanguage: 'en', detectBrowserLanguage: false };
/** `zh`, with the object's label translated, so the copy shows WHICH label it names. */
const ZH: I18nConfig = {
  defaultLanguage: 'zh',
  detectBrowserLanguage: false,
  resources: { zh: { probe: { objects: { [OBJECT]: { label: '发票' } } } } },
};

const NOT_FOUND_EN = 'Record not found';
const NOT_FOUND_DESCRIPTION_EN = 'The record you are looking for does not exist or may have been deleted.';
const NOT_FOUND_ZH = '未找到记录';

/** Open the record page; returns the adapter's `findOne`, spied, to count the page's reads. */
async function openRecordPage(config: I18nConfig = EN) {
  const ds = new ObjectStackAdapter({ baseUrl: BASE, fetch: transport, autoReconnect: false });
  await ds.connect();
  // Object metadata is the metadata service's business, not this file's.
  (ds as unknown as { getObjectSchema: () => Promise<unknown> }).getObjectSchema = async () => objectDef;
  const findOne = vi.spyOn(ds, 'findOne');
  const metadata = {
    objects: [objectDef], pages: [], loading: false, error: null,
    refresh: async () => {}, invalidate: () => {},
    ensureType: async () => [], getItem: async () => null, getItemsByType: () => [],
  } as never;
  render(
    <I18nProvider config={config} persistLanguage={false}>
      <MemoryRouter initialEntries={[`/apps/demo/${OBJECT}/record/${REC}`]}>
        <MetadataCtx.Provider value={metadata}>
          <RecordDetailView
            dataSource={ds as never}
            objects={[objectDef] as never}
            onEdit={() => {}}
            objectNameOverride={OBJECT}
            recordIdOverride={REC}
          />
        </MetadataCtx.Provider>
      </MemoryRouter>
    </I18nProvider>,
  );
  return { findOne };
}

const pageReads = (findOne: { mock: { calls: unknown[][] } }) =>
  findOne.mock.calls.filter(([object, id]) => object === OBJECT && id === REC).length;

const absent = (text: string | RegExp) => expect(screen.queryAllByText(text)).toHaveLength(0);

afterEach(() => {
  cleanup();
  answer = 'ok';
});

describe('a refused read renders a no-access state that names the object (objectui#11902)', () => {
  it('en: 403 PERMISSION_DENIED → "You don’t have access to Invoice records", never not-found', async () => {
    answer = 'forbidden';
    const { findOne } = await openRecordPage(EN);

    const state = await screen.findByTestId('record-access-denied', undefined, { timeout: 5000 });
    expect(state).toHaveTextContent('You don’t have access to Invoice records');
    expect(state).toHaveTextContent(
      'You don’t have permission to view records of this type. Contact your administrator if you think you should have access.',
    );
    absent(NOT_FOUND_EN);
    absent(/may have been deleted/);
    // A permission decision is not retryable: no Retry is offered.
    expect(screen.queryByRole('button', { name: /Retry/ })).toBeNull();
    // The page asked once; the refusal set off no re-read of its own.
    expect(pageReads(findOne)).toBe(1);
  });

  it('zh: 403 → "无权访问发票记录", naming the object by its translated label', async () => {
    answer = 'forbidden';
    await openRecordPage(ZH);

    expect(await screen.findByText('无权访问发票记录', undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('你没有查看此类记录的权限。如需访问，请联系管理员。')).toBeInTheDocument();
    absent(NOT_FOUND_ZH);
    absent(/已被删除/);
  });
});

describe('a failed load renders a retryable load error, not not-found (objectui#11902)', () => {
  it('en: a 5xx → "Couldn’t load this record" with Retry; a Retry that succeeds renders the record', async () => {
    answer = 'serverError';
    const { findOne } = await openRecordPage(EN);

    const state = await screen.findByTestId('record-load-failed', undefined, { timeout: 5000 });
    expect(state).toHaveTextContent('Couldn’t load this record');
    expect(state).toHaveTextContent('Something went wrong while loading it. Check your connection and try again.');
    absent(NOT_FOUND_EN);
    absent(/may have been deleted/);
    expect(pageReads(findOne)).toBe(1);

    // The server recovers; Retry re-runs the page's own read, once. The click
    // handler calls the load synchronously, so the count is read right after
    // it — before the recovered page mounts blocks that read on their own.
    answer = 'ok';
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(pageReads(findOne)).toBe(2);
    // The retry is the SAME read: the same object, id and expansion as the first.
    expect(findOne.mock.calls[1]).toEqual(findOne.mock.calls[0]);

    expect((await screen.findAllByText(RECORD.name, undefined, { timeout: 5000 })).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('record-load-failed')).toBeNull();
  });

  it('en: a transport failure → the same retryable load error', async () => {
    answer = 'network';
    await openRecordPage(EN);

    const state = await screen.findByTestId('record-load-failed', undefined, { timeout: 5000 });
    expect(state).toHaveTextContent('Couldn’t load this record');
    expect(screen.getByRole('button', { name: /Retry/ })).toBeInTheDocument();
    absent(NOT_FOUND_EN);
  });

  it('zh: a 5xx → "无法加载此记录" with the pack’s Retry', async () => {
    answer = 'serverError';
    await openRecordPage(ZH);

    expect(await screen.findByText('无法加载此记录', undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('加载时出错。请检查网络连接后重试。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /重试/ })).toBeInTheDocument();
    absent(NOT_FOUND_ZH);
  });
});

describe('controls: not-found and a found record render as before (objectui#11902)', () => {
  it('a 404 (the adapter resolves null) still renders today’s not-found copy', async () => {
    answer = 'notFound';
    await openRecordPage(EN);

    expect(await screen.findByText(NOT_FOUND_EN, undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText(NOT_FOUND_DESCRIPTION_EN)).toBeInTheDocument();
    expect(screen.queryByTestId('record-access-denied')).toBeNull();
    expect(screen.queryByTestId('record-load-failed')).toBeNull();
  });

  it('a found record renders the page, with none of the three states', async () => {
    answer = 'ok';
    await openRecordPage(EN);

    expect((await screen.findAllByText(RECORD.name, undefined, { timeout: 5000 })).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.queryByTestId('record-access-denied')).toBeNull());
    expect(screen.queryByTestId('record-load-failed')).toBeNull();
    absent(NOT_FOUND_EN);
  });
});
