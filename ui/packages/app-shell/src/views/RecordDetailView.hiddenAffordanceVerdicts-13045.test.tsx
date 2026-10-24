/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13045 — the record page does not ask `security/explain` about an
 * operation the object already turns off with a STATIC `userActions` boolean.
 *
 * Measured on cloud's `sys_environment` record page: every open sent
 * `POST /api/v1/security/explain` twice, once with `operation: update` and
 * once with `operation: delete`, although the object declares
 * `userActions: { edit: false, delete: false }` and the header therefore hides
 * both Edit and Delete. Both verdicts gated nothing the user could see.
 *
 * The rule: `edit: false` means no `update` question, `delete: false` means no
 * `delete` question. A per-record predicate form, `true`, or an absent entry
 * still asks, and the affordance still follows the answer. The cases below
 * mount the REAL page over the REAL verdict hook and count the questions on
 * the wire, answering each with a configurable verdict so the controls can show
 * the affordance following it.
 *
 * Radix caution (carried from `RecordDetailView.userActionPredicates.test`):
 * every assertion about the primary Edit CTA runs BEFORE the overflow menu is
 * opened, since an open menu `aria-hidden`s the rest of the page.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada', image: null }, activeOrganization: null }),
  createAuthenticatedFetch: () => vi.fn(),
}));

vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRecordPresence: () => [],
  PresenceAvatars: () => null,
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock('./ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('./ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

import { MetadataCtx } from '@object-ui/react';
import { __clearRecordEditableCache } from '@object-ui/plugin-detail';
import { RecordDetailView } from './RecordDetailView';

const OBJECT_NAME = 'os_13045_env';
const RECORD_ID = 'ENV-1';
const RECORD = { id: RECORD_ID, name: 'Production', status: 'pending' };

const FIELDS = {
  id: { type: 'text', label: 'Id' },
  name: { type: 'text', label: 'Name' },
  status: { type: 'text', label: 'Status' },
};

function objectDef(userActions?: unknown) {
  return {
    name: OBJECT_NAME,
    label: 'Environment',
    // The permissive bucket: edit and delete both default open, so the only
    // things moving are `userActions` and the verdict.
    managedBy: 'platform',
    fields: FIELDS,
    ...(userActions === undefined ? {} : { userActions }),
  };
}

/** The verdict the explain engine answers per operation. */
let verdicts: Record<string, boolean> = {};
/** Every `security/explain` question the page sent, by operation. */
let explainOps: string[] = [];

function respond(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

async function mountRecordPage(userActions?: unknown) {
  const objects = [objectDef(userActions)];
  const dataSource = {
    find: vi.fn(async () => ({ data: [] })),
    findOne: vi.fn(async () => RECORD),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
  const metadata = {
    objects,
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: () => [],
  } as any;
  render(
    <MemoryRouter initialEntries={[`/apps/cloud/${OBJECT_NAME}/${RECORD_ID}`]}>
      <MetadataCtx.Provider value={metadata}>
        <RecordDetailView
          dataSource={dataSource}
          objects={objects}
          onEdit={() => {}}
          objectNameOverride={OBJECT_NAME}
          recordIdOverride={RECORD_ID}
        />
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(dataSource.findOne).toHaveBeenCalled());
  await waitFor(() => expect(headerToolbar()).toBeTruthy());
  // Let every effect the open sets off settle, so a question that was going
  // to be asked has been asked before anything is counted.
  await act(async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

function headerToolbar(): HTMLElement | null {
  return document.querySelector('[role="toolbar"]');
}

function headerEditButton(): HTMLButtonElement | null {
  const bar = headerToolbar();
  if (!bar) return null;
  return (
    (Array.from(bar.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim().toLowerCase() === 'edit',
    ) as HTMLButtonElement | undefined) ?? null
  );
}

async function openHeaderOverflow(): Promise<string[]> {
  const trigger = screen.getByRole('button', { name: /more actions/i });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  await waitFor(() => expect(screen.getByRole('menu')).toBeInTheDocument());
  return screen.getAllByRole('menuitem').map((el) => (el.textContent ?? '').trim());
}

beforeEach(() => {
  cleanup();
  __clearRecordEditableCache();
  verdicts = { update: true, delete: true };
  explainOps = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/security/explain')) {
        const { operation } = JSON.parse(String(init?.body ?? '{}')) as { operation: string };
        explainOps.push(operation);
        return respond({ allowed: true, record: { recordId: RECORD_ID, visible: verdicts[operation] } });
      }
      return respond({ data: [] });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('record page: no verdict for an operation `userActions` turns off (objectui#13045)', () => {
  it('`edit: false, delete: false` sends no security/explain at all', async () => {
    await mountRecordPage({ edit: false, delete: false });

    expect(explainOps).toEqual([]);
    // The affordances stay hidden, as the static boolean already made them.
    expect(headerEditButton()).toBeNull();
    expect(await openHeaderOverflow()).not.toContain('Delete');
  });

  it('only `delete: false`: the update verdict is still asked and still gates Edit; no delete question', async () => {
    verdicts = { update: false, delete: true };
    await mountRecordPage({ delete: false });

    expect(explainOps).toEqual(['update']);
    await waitFor(() => expect(headerEditButton()).toBeNull());
    expect(await openHeaderOverflow()).not.toContain('Delete');
  });

  it('only `delete: false`, update allowed: Edit stays offered', async () => {
    await mountRecordPage({ delete: false });

    expect(explainOps).toEqual(['update']);
    expect(headerEditButton()).toBeInTheDocument();
  });
});

describe('CONTROL: an object that does not turn the operation off still asks both (objectui#13045)', () => {
  const shapes: Array<[string, unknown]> = [
    ['absent', undefined],
    ['on (`true`)', { edit: true, delete: true }],
    [
      'predicate form',
      { edit: { visibleWhen: 'record.status == "pending"' }, delete: { visibleWhen: 'record.status == "pending"' } },
    ],
  ];

  for (const [label, userActions] of shapes) {
    it(`${label}: both verdicts asked, and a denying verdict hides both affordances`, async () => {
      verdicts = { update: false, delete: false };
      await mountRecordPage(userActions);

      expect([...explainOps].sort()).toEqual(['delete', 'update']);
      await waitFor(() => expect(headerEditButton()).toBeNull());
      expect(await openHeaderOverflow()).not.toContain('Delete');
    });

    it(`${label}: both verdicts asked, and an allowing verdict offers both affordances`, async () => {
      await mountRecordPage(userActions);

      expect([...explainOps].sort()).toEqual(['delete', 'update']);
      expect(headerEditButton()).toBeInTheDocument();
      expect(await openHeaderOverflow()).toContain('Delete');
    });
  }
});
