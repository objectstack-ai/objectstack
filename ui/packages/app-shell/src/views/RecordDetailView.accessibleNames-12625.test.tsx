/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12625 — the console record page's controls have accessible names,
 * read on the REAL `RecordDetailView` mount (the synthesized default page:
 * `page:header`, `page:tabs`, `record:details`), by role and name.
 *
 * - The tabs are named by their labels (Details, Related).
 * - A declared `record_header` action is named by its label (Log a Call).
 * - A collapsible field group's header is a button named by its label
 *   (Lead Information) that toggles `aria-expanded` — the half the card found
 *   really broken (`DetailSection`'s header was a div with no role).
 *
 * The tabs and the header actions were already named on main when this was
 * written; they are regression pins, so a restyle that moves a label into an
 * `aria-hidden` span turns this file red.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

// Orthogonal chrome — same posture as RecordDetailView.headerActionLookupPredicate.test.
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
import { ExpressionProvider } from '../providers/ExpressionProvider';

const headerAction = (name: string, label: string) => ({
  name,
  label,
  type: 'api',
  target: '/api/v1/noop',
  locations: ['record_header'],
});

const LEAD = {
  name: 'lead',
  label: 'Lead',
  managedBy: 'platform',
  // One declared, ungrouped highlight keeps the heuristic strip from claiming
  // the grouped fields (see defaultFieldGroupsPage.sectionHeadings.test).
  highlightFields: ['name'],
  fieldGroups: [
    { key: 'info', label: 'Lead Information', collapsible: true },
    { key: 'addr', label: 'Address' },
  ],
  fields: {
    id: { type: 'text', label: 'Id' },
    name: { type: 'text', label: 'Name' },
    company: { type: 'text', label: 'Company', group: 'info' },
    city: { type: 'text', label: 'City', group: 'addr' },
  },
  actions: [
    headerAction('log_call', 'Log a Call'),
    headerAction('log_meeting', 'Log a Meeting'),
    headerAction('schedule_meeting', 'Schedule a Meeting'),
  ],
};

/** A child with a lookup to the lead, so the page carries a Related tab. */
const TASK = {
  name: 'task',
  label: 'Task',
  fields: {
    id: { type: 'text' },
    subject: { type: 'text', label: 'Subject' },
    lead: { type: 'lookup', reference: 'lead', label: 'Lead' },
  },
};

async function mountLeadPage() {
  const objects = [LEAD, TASK];
  const findOne = vi.fn(async () => ({ id: 'L1', name: 'Ada', company: 'Acme', city: 'Paris' }));
  const dataSource = {
    find: vi.fn(async () => ({ data: [] })),
    findOne,
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as never;
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
  } as never;
  render(
    <MemoryRouter initialEntries={['/apps/crm/lead/L1']}>
      <MetadataCtx.Provider value={metadata}>
        <ExpressionProvider user={{ id: 'u1', name: 'Ada' }} app={{ name: 'crm' }} data={{}} features={{}}>
          <RecordDetailView
            dataSource={dataSource}
            objects={objects}
            onEdit={() => {}}
            objectNameOverride="lead"
            recordIdOverride="L1"
          />
        </ExpressionProvider>
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(findOne).toHaveBeenCalled());
  await screen.findByRole('button', { name: 'Lead Information' });
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

describe('objectui#12625 — the record page names its tabs, header actions and section headers', () => {
  it('the tabs are named by their labels', async () => {
    await mountLeadPage();
    expect(screen.getByRole('tab', { name: 'Details' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Related' })).toBeInTheDocument();
  });

  it('the header actions are named by their labels', async () => {
    await mountLeadPage();
    expect(screen.getByRole('button', { name: 'Log a Call' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log a Meeting' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Schedule a Meeting' })).toBeInTheDocument();
  });

  it('the collapsible field group header is a button named by its label that toggles', async () => {
    const user = userEvent.setup();
    await mountLeadPage();
    const header = screen.getByRole('button', { name: 'Lead Information' });
    expect(header).toHaveAttribute('aria-expanded', 'true');
    await user.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
    // CONTROL: the non-collapsible group shows its heading but is no button.
    expect(screen.getByText('Address')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Address' })).toBeNull();
  });
});
