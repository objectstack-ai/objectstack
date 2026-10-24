/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13341 — after one action on a record page, each explain question is
 * asked once.
 *
 * Reported on Setup (console objectui `1f23d5b0`): every save, delete or action
 * was followed by 2–6 `POST /api/v1/security/explain` calls. objectui#11699 and
 * #13010 already made the record OPEN ask each question once; this file counts
 * what goes out AFTER an action.
 *
 * Measured here first, on `origin/main`, with the console's wiring: a Setup
 * object (`sys_*`, rendered by `RecordDetailView` over the synthesized page,
 * so `record:details`' `DetailView` asks beside the header) and the console's
 * `useMutationInvalidationBridge` mounted beside it. A save through the
 * `DataSource` sends one request per question. A write the host announces
 * AGAIN — an undoable action's or a `refreshAfter` action's own
 * `notifyRecordChanged()` after the bridge's announcement, or a list host's
 * own-write notice — landing while the re-check was on the wire staled that
 * re-check, and every question went out twice: four requests for one save.
 *
 * The transport HOLDS every request until the test releases it, so "on the
 * wire" is literal and every count is a count of requests sent.
 *
 * Controls, each against the hole a fix could leave:
 *   - the re-check is still sent (one fresh request, not zero), and the
 *     header follows its answer: a save that revokes the edit hides Edit;
 *   - a write announced once is still one request per question.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
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

import { MetadataCtx, useMutationInvalidationBridge, notifyDataChanged } from '@object-ui/react';
import { ObjectStackAdapter } from '@object-ui/data-objectstack';
import { __clearRecordEditableCache } from '@object-ui/plugin-detail';
import { RecordDetailView } from './RecordDetailView';

const BASE = 'http://test.local';
const OBJECT = 'sys_business_unit';
const REC = 'bu-13341';

const objectDef = {
  name: OBJECT,
  label: 'Business Unit',
  managedBy: 'platform',
  fields: {
    id: { label: 'Id', type: 'text' },
    name: { label: 'Name', type: 'text' },
    parent: { label: 'Parent', type: 'lookup', reference: OBJECT },
  },
};
const RECORD = { id: REC, name: 'Sales', parent: null };

/** What the explain engine answers per operation, decided when RELEASED. */
let verdicts: Record<string, boolean> = {};

interface Held {
  method: string;
  path: string;
  body?: string;
  released: boolean;
  release: () => void;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function answerFor(h: Held): unknown {
  if (h.path.endsWith('/security/explain')) {
    const { operation } = JSON.parse(h.body ?? '{}') as { operation: string };
    return { allowed: true, record: { recordId: REC, visible: verdicts[operation] } };
  }
  if (h.method === 'PATCH') {
    return { success: true, data: { object: OBJECT, id: REC, record: { ...RECORD, name: 'Sales EMEA' } } };
  }
  if (h.path.startsWith(`/api/v1/data/${OBJECT}`)) return { success: true, data: { records: [RECORD], total: 1 } };
  if (h.path.startsWith('/api/v1/data/')) return { success: true, data: { records: [], total: 0 } };
  return { success: true, data: [] };
}

function heldTransport() {
  const held: Held[] = [];
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
    const path = url.replace(BASE, '');
    if (path.endsWith('/api/v1/discovery')) {
      return Promise.resolve(json({ success: true, data: { capabilities: {}, routes: {} } }));
    }
    return new Promise<Response>((resolve) => {
      const h: Held = {
        method,
        path,
        body: typeof init?.body === 'string' ? init.body : undefined,
        released: false,
        release: () => {
          if (h.released) return;
          h.released = true;
          resolve(json(answerFor(h)));
        },
      };
      held.push(h);
    });
  });
  return { fetch, held };
}

async function idle() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

async function releaseWhere(held: Held[], pred: (h: Held) => boolean) {
  await act(async () => {
    for (const h of held) if (!h.released && pred(h)) h.release();
    await new Promise((r) => setTimeout(r, 0));
  });
  await idle();
}

/** Answer everything, and anything that sets off, until the page asks for nothing more. */
async function drain(held: Held[]) {
  for (let round = 0; round < 10 && held.some((h) => !h.released); round++) {
    await releaseWhere(held, () => true);
  }
  expect(held.filter((h) => !h.released)).toEqual([]);
}

const isExplain = (h: Held) => h.method === 'POST' && h.path.endsWith('/security/explain');

/** How many requests asked each `object/recordId/operation`, from `from` on. */
function perQuestion(held: Held[], from: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const h of held.slice(from).filter(isExplain)) {
    const q = JSON.parse(h.body ?? '{}') as { object: string; recordId: string; operation: string };
    const k = `${q.object}/${q.recordId}/${q.operation}`;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

const ONCE_EACH = { [`${OBJECT}/${REC}/update`]: 1, [`${OBJECT}/${REC}/delete`]: 1 };

function headerEditButton(): HTMLButtonElement | null {
  const bar = document.querySelector('[role="toolbar"]');
  if (!bar) return null;
  return (
    (Array.from(bar.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim().toLowerCase() === 'edit',
    ) as HTMLButtonElement | undefined) ?? null
  );
}

/** The console's one bridge from `DataSource` writes onto the bus (`AppContent`). */
function Bridge({ dataSource }: { dataSource: unknown }) {
  useMutationInvalidationBridge(dataSource);
  return null;
}

/** Open a Setup record page the way the console mounts it, and settle the open. */
async function openSetupRecord() {
  const { fetch, held } = heldTransport();
  // The explain probe rides the global fetch when no host apiFetch is
  // provided; the adapter rides the same transport.
  vi.stubGlobal('fetch', fetch);
  const ds = new ObjectStackAdapter({ baseUrl: BASE, fetch, autoReconnect: false });
  await ds.connect();
  // Object metadata is the metadata service's, not this count's.
  (ds as unknown as { getObjectSchema: () => Promise<unknown> }).getObjectSchema = async () => objectDef;
  const metadata = {
    objects: [objectDef], pages: [], loading: false, error: null,
    refresh: async () => {}, invalidate: () => {},
    ensureType: async () => [], getItem: async () => null, getItemsByType: () => [],
  } as never;
  render(
    <React.StrictMode>
      <MemoryRouter initialEntries={[`/apps/setup/${OBJECT}/record/${REC}`]}>
        <MetadataCtx.Provider value={metadata}>
          <Bridge dataSource={ds} />
          <RecordDetailView
            dataSource={ds as never}
            objects={[objectDef] as never}
            onEdit={() => {}}
            objectNameOverride={OBJECT}
            recordIdOverride={REC}
          />
        </MetadataCtx.Provider>
      </MemoryRouter>
    </React.StrictMode>,
  );
  await waitFor(() => expect(held.length).toBeGreaterThan(0));
  await drain(held);
  // The open itself asks each question once (objectui#11699).
  expect(perQuestion(held, 0)).toEqual(ONCE_EACH);
  await waitFor(() => expect(headerEditButton()).toBeInTheDocument());
  return { ds, held };
}

beforeEach(() => {
  cleanup();
  __clearRecordEditableCache();
  verdicts = { update: true, delete: true };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('record page: one action, one explain request per question (objectui#13341)', () => {
  it('a save announced twice — by the bridge, then by the host while the re-check is on the wire — asks each question once', async () => {
    const { ds, held } = await openSetupRecord();
    const before = held.length;

    // The save, through the DataSource: its response is the bridge's
    // announcement, and the page re-reads and re-checks on it.
    await act(async () => {
      void ds.update(OBJECT, REC, { name: 'Sales EMEA' });
    });
    await releaseWhere(held, (h) => h.method === 'PATCH');
    expect(held.slice(before).filter(isExplain), 'the re-check is on the wire').toHaveLength(2);

    // The host announces the same write again, as `notifyRecordChanged()` does
    // after an undoable or `refreshAfter` action's awaited update.
    act(() => notifyDataChanged({ objectName: OBJECT, recordId: REC }));
    await idle();
    await drain(held);

    expect(perQuestion(held, before)).toEqual(ONCE_EACH);
  });

  it('the re-check is sent and followed: a save that revokes the edit hides Edit', async () => {
    const { ds, held } = await openSetupRecord();
    const before = held.length;

    // After this save, the server no longer lets this principal edit it.
    verdicts = { update: false, delete: true };
    await act(async () => {
      void ds.update(OBJECT, REC, { name: 'Sales EMEA' });
    });
    await releaseWhere(held, (h) => h.method === 'PATCH');
    act(() => notifyDataChanged({ objectName: OBJECT, recordId: REC }));
    await idle();
    await drain(held);

    expect(perQuestion(held, before)).toEqual(ONCE_EACH);
    await waitFor(() => expect(headerEditButton()).toBeNull());
  });

  it('control — a save announced once is one request per question', async () => {
    const { ds, held } = await openSetupRecord();
    const before = held.length;

    await act(async () => {
      void ds.update(OBJECT, REC, { name: 'Sales EMEA' });
    });
    await drain(held);

    expect(perQuestion(held, before)).toEqual(ONCE_EACH);
  });
});
