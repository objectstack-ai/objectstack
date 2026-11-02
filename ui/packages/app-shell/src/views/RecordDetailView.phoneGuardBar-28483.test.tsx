/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28483 (ruling letter A) — below 768 px the console mounts no app
 * bar on a record route, so the record page's 「‹」 bar is the only way off
 * it. A page that cannot show its record (a refused read, a 404, a failed
 * read) still draws that bar above its state on a phone: a deep link to such
 * a record is never a page without a way out.
 *
 * Harness: `RecordDetailView.recordReadFailure-11902`'s real
 * `ObjectStackAdapter` over a stubbed transport, mounted on the console's
 * record route at 390 px. Control: at 1440 px the same states draw no bar,
 * as before (the app bar is there).
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

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
import { I18nProvider } from '@object-ui/i18n';
import { ObjectStackAdapter } from '@object-ui/data-objectstack';
import { RecordDetailView } from './RecordDetailView';

const BASE = 'http://test.local';
const APP = 'demo';
const OBJECT = 'probe_invoice';
const REC = 'inv-28483';

const objectDef = {
  name: OBJECT,
  label: 'Invoice',
  pluralLabel: 'Invoices',
  fields: {
    id: { label: 'Id', type: 'text' },
    name: { label: 'Name', type: 'text' },
  },
};

type Answer = 'forbidden' | 'notFound' | 'serverError';
let answer: Answer = 'forbidden';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** One transport for the adapter and the page's side reads, never torn down (objectui#6640). */
const transport = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const path = url.replace(BASE, '');
  if (path.endsWith('/api/v1/discovery')) {
    return json(200, { success: true, data: { capabilities: {}, routes: {} } });
  }
  if (path.startsWith(`/api/v1/data/${OBJECT}`)) {
    switch (answer) {
      case 'forbidden':
        return json(403, { error: `Permission denied: read on ${OBJECT}`, code: 'PERMISSION_DENIED', object: OBJECT });
      case 'notFound':
        return json(404, { error: 'Record not found', code: 'RECORD_NOT_FOUND' });
      case 'serverError':
        return json(500, { error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
  }
  if (path.endsWith('/security/explain')) return json(200, { allowed: true });
  return json(200, { success: true, data: [] });
});
vi.stubGlobal('fetch', transport);

function setWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });
}

async function openRecordPage(width: number) {
  setWidth(width);
  const ds = new ObjectStackAdapter({ baseUrl: BASE, fetch: transport, autoReconnect: false });
  await ds.connect();
  (ds as unknown as { getObjectSchema: () => Promise<unknown> }).getObjectSchema = async () => objectDef;
  const metadata = {
    objects: [objectDef], pages: [], loading: false, error: null,
    refresh: async () => {}, invalidate: () => {},
    ensureType: async () => [], getItem: async () => null, getItemsByType: () => [],
  } as never;
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <MemoryRouter initialEntries={[`/apps/${APP}/${OBJECT}/record/${REC}`]}>
        <MetadataCtx.Provider value={metadata}>
          <Routes>
            <Route
              path="/apps/:appName/:objectName/record/:recordId"
              element={<RecordDetailView dataSource={ds as never} objects={[objectDef] as never} onEdit={() => {}} />}
            />
          </Routes>
        </MetadataCtx.Provider>
      </MemoryRouter>
    </I18nProvider>,
  );
}

/** The state the page settled on, and the bar above it on a phone. */
const STATES: ReadonlyArray<{ answer: Answer; state: () => Promise<HTMLElement> }> = [
  { answer: 'forbidden', state: () => screen.findByTestId('record-access-denied', undefined, { timeout: 5000 }) },
  { answer: 'notFound', state: () => screen.findByText('Record not found', undefined, { timeout: 5000 }) },
  { answer: 'serverError', state: () => screen.findByTestId('record-load-failed', undefined, { timeout: 5000 }) },
];

afterEach(() => {
  cleanup();
  setWidth(1440);
  answer = 'forbidden';
});

describe('a phone record page that cannot show its record keeps its 「‹」 bar (objectstack#28483)', () => {
  for (const { answer: a, state } of STATES) {
    it(`${a}: at 390 px the state sits under one bar, 「‹ Invoices」 back to the object's list`, async () => {
      answer = a;
      await openRecordPage(390);
      const shown = await state();
      const frame = screen.getByTestId('record-page-phone-guard');
      expect(frame).toContainElement(shown);
      const bars = frame.querySelectorAll('[data-record-top-bar]');
      expect(bars).toHaveLength(1);
      const back = bars[0].querySelector('[data-record-crumb-back]') as HTMLAnchorElement;
      expect(back.tagName).toBe('A');
      expect(back.textContent).toBe('Invoices');
      expect(back.getAttribute('href')).toBe(`/apps/${APP}/${OBJECT}`);
      // The bar sits above the state, not inside it.
      expect(bars[0].compareDocumentPosition(shown) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  }

  it('control: at 1440 px a refused read draws its state alone, no bar (the app bar is there)', async () => {
    answer = 'forbidden';
    await openRecordPage(1440);
    await STATES[0].state();
    expect(screen.queryByTestId('record-page-phone-guard')).toBeNull();
    expect(document.querySelector('[data-record-top-bar]')).toBeNull();
  });
});
