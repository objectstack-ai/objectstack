/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#32756 — the console record page does not offer an Edit whose
 * form would open with nothing to edit.
 *
 * The card's object: every field of an expense claim carries
 * `readonlyWhen: "record.status == 'pending' || record.status == 'approved'"`.
 * On an approved claim the header's Edit was live and opened a form of
 * read-only values with an active Update. The page now judges the edit form's
 * fields with the form's own evaluator (`editFormLockedByState`) and, when the
 * record's state locks all of them, draws Edit disabled with the reason
 * beside it, as the approval lock does.
 *
 * Radix caution (carried from `RecordDetailView.userActionPredicates`): every
 * assertion about the Edit CTA runs before any overflow menu opens.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
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
import { RecordDetailView } from './RecordDetailView';

const OBJECT_NAME = 'ebqu_claim';
const RECORD_ID = 'CLM-1';

/** The card's predicate, verbatim. */
const LOCKED_WHEN = "record.status == 'pending' || record.status == 'approved'";

/**
 * Every business field carries the card's `readonlyWhen`. `id` and `owner`
 * are platform-managed columns the form never draws, so neither may keep Edit
 * live.
 */
const LOCKED_FIELDS = {
  id: { type: 'text', label: 'Id' },
  owner: { type: 'lookup', label: 'Owner', reference: 'sys_user' },
  name: { type: 'text', label: 'Title', readonlyWhen: LOCKED_WHEN },
  amount: { type: 'currency', label: 'Amount', readonlyWhen: LOCKED_WHEN },
  status: { type: 'text', label: 'Status', readonlyWhen: LOCKED_WHEN },
};

const APPROVED = { id: RECORD_ID, name: 'Taxi to client', amount: 42, status: 'approved', owner: 'u1' };
const DRAFT = { ...APPROVED, status: 'draft' };

function objectDef(fields: Record<string, unknown>) {
  return { name: OBJECT_NAME, label: 'Expense claim', managedBy: 'platform', fields };
}

function makeDataSource(record: Record<string, unknown>) {
  return {
    find: vi.fn(async () => ({ data: [] })),
    findOne: vi.fn(async () => record),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
}

function makeMetadata(objects: any[]) {
  return {
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

function stateLockBadge(): HTMLElement | null {
  return document.querySelector('[data-testid="record-state-lock"]');
}

/** Mount the console record page and wait for the record read and the header. */
async function mountRecordPage(record: Record<string, unknown>, fields: Record<string, unknown>) {
  const objects = [objectDef(fields)];
  const dataSource = makeDataSource(record);
  render(
    <MemoryRouter initialEntries={[`/apps/fin/${OBJECT_NAME}/${RECORD_ID}`]}>
      <MetadataCtx.Provider value={makeMetadata(objects)}>
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
  await waitFor(() => expect(headerEditButton()).toBeTruthy());
}

beforeEach(() => {
  cleanup();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('console record header — a record whose state locks every edit-form field (objectstack#32756)', () => {
  it('draws Edit disabled, with the reason beside it, when readonlyWhen locks every field', async () => {
    await mountRecordPage(APPROVED, LOCKED_FIELDS);

    await waitFor(() => expect(headerEditButton()).toBeDisabled());
    const badge = stateLockBadge();
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute('role', 'status');
    expect(badge).toHaveTextContent('Not editable in its current state');
  });

  it('CONTROL: one writable field keeps Edit enabled as today, and draws no reason', async () => {
    await mountRecordPage(APPROVED, {
      ...LOCKED_FIELDS,
      note: { type: 'textarea', label: 'Note' },
    });

    expect(headerEditButton()).not.toBeDisabled();
    expect(stateLockBadge()).toBeNull();
  });

  it('CONTROL: a state the predicate does not lock keeps Edit enabled', async () => {
    await mountRecordPage(DRAFT, LOCKED_FIELDS);

    expect(headerEditButton()).not.toBeDisabled();
    expect(stateLockBadge()).toBeNull();
  });

  it('the approval lock is unchanged: Edit stays disabled and only the lock band explains it', async () => {
    // A locking approval request on the record, answered by the approvals list.
    const request = {
      id: 'req_1',
      object_name: OBJECT_NAME,
      record_id: RECORD_ID,
      status: 'pending',
      submitter_id: 'u1',
      pending_approvers: ['u_manager'],
      lock_record: true,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url);
        const body = u.includes('/approvals/requests?object=')
          ? { data: [request] }
          : u.endsWith('/approvals/requests/req_1')
            ? request
            : { data: [] };
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      }),
    );

    // Writable record under the lock: Edit off, as before this change.
    await mountRecordPage(DRAFT, LOCKED_FIELDS);
    await waitFor(() => expect(headerEditButton()).toBeDisabled());
    expect(stateLockBadge()).toBeNull();

    // Every field also state-locked: still the approval lock alone that speaks.
    cleanup();
    await mountRecordPage(APPROVED, LOCKED_FIELDS);
    // Wait for the lock band itself: Edit is off from the state alone before
    // the approvals read lands, so a disabled Edit proves nothing here.
    await waitFor(() => expect(screen.getByText('Locked for approval')).toBeInTheDocument());
    expect(headerEditButton()).toBeDisabled();
    expect(stateLockBadge()).toBeNull();
  });
});
