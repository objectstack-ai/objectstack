// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#33346 (row 99) — the share-link landing page lists the record's
 * fields by the record page's own body rule: the framework's system columns
 * and the audit-provenance columns are not listed, and only a field the object
 * declares is. Before, every key the record carried was listed, the system
 * ones grouped last, so a shared client brief opened on `Id`, `Created At`,
 * `Organization` and `Updated By` rows beside its business fields.
 *
 * The answer below is the one the v18.4.0 sweep read from the stock showcase's
 * `showcase_client_brief` link: those record keys, its redacted fields
 * stripped, and the server's projection of the keys the object declares.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SharedRecordPage from './SharedRecordPage';

const TOKEN = 'tok_33346';

const BRIEF = {
  id: 'brf_1',
  created_at: '2026-11-13T05:20:00.000Z',
  updated_at: '2026-11-13T05:21:00.000Z',
  organization_id: 'org_1',
  created_by: 'usr_1',
  updated_by: 'usr_1',
  title: 'Northwind renewal',
  summary: 'Two-year renewal with the EMEA team.',
  status: 'published',
  owner_id: 'usr_1',
};

/** The projection: every key the brief's schema declares (system columns included), never `id`. */
const FIELDS = {
  created_at: { label: 'Created At', type: 'datetime' },
  updated_at: { label: 'Updated At', type: 'datetime' },
  organization_id: { label: 'Organization', type: 'lookup', reference: 'sys_organization' },
  created_by: { label: 'Created By', type: 'lookup', reference: 'sys_user' },
  updated_by: { label: 'Updated By', type: 'lookup', reference: 'sys_user' },
  title: { label: 'Title', type: 'text' },
  summary: { label: 'Client Summary', type: 'text' },
  status: {
    label: 'Status',
    type: 'select',
    options: [
      { value: 'draft', label: 'Draft' },
      { value: 'published', label: 'Published' },
    ],
  },
  owner_id: { label: 'Owner', type: 'lookup', reference: 'sys_user' },
};

function shareServer(fields?: Record<string, unknown>, linkExtra: Record<string, unknown> = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const { pathname } = new URL(raw, 'http://localhost');
      if (pathname === `/api/v1/share-links/${TOKEN}/resolve`) {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              record: BRIEF,
              link: {
                id: 'sl_1',
                token: TOKEN,
                object_name: 'showcase_client_brief',
                record_id: BRIEF.id,
                permission: 'view',
                audience: 'anyone',
                ...linkExtra,
              },
              redactFields: ['internal_notes', 'deal_value'],
              ...(fields ? { fields } : {}),
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(null, { status: 404 });
    }),
  );
}

function renderLink() {
  return render(
    <MemoryRouter initialEntries={[`/s/${TOKEN}`]}>
      <Routes>
        <Route path="/s/:token" element={<SharedRecordPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const labels = () => screen.getAllByRole('term').map((dt) => dt.textContent);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('#33346 row 99 — the share page lists fields by the record page rule', () => {
  it('lists the declared business fields by label, and no system or audit column', async () => {
    shareServer(FIELDS);
    renderLink();
    await screen.findByText('Northwind renewal');

    expect(labels()).toEqual(['Title', 'Client Summary', 'Status', 'Owner']);
    expect(document.body.textContent).not.toMatch(/Created At|Updated By|Organization|brf_1/);
  });

  it('an answer without a projection (an older server) still drops the system and audit columns', async () => {
    shareServer();
    renderLink();
    await screen.findByText('Northwind renewal');

    // No projection, so no way to tell a declared key: every non-system key stays, labelled from the key.
    expect(labels()).toEqual(['Id', 'Title', 'Summary', 'Status', 'Owner Id']);
  });
});

describe('objectstack#33552 — the header names the object by its label, and a hidden field is not listed', () => {
  it('a field the projection marks hidden is not listed, though the object declares it', async () => {
    shareServer({ ...FIELDS, summary: { ...FIELDS.summary, hidden: true } });
    renderLink();
    await screen.findByText('Northwind renewal');

    expect(labels()).toEqual(['Title', 'Status', 'Owner']);
    expect(document.body.textContent).not.toMatch(/Client Summary|Two-year renewal/);
  });

  it('the header shows the object label the answer carries', async () => {
    shareServer(FIELDS, { object_label: 'Client Brief' });
    renderLink();

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Shared Client Brief');
    expect(document.body.textContent).not.toMatch(/showcase_client_brief/);
  });

  it('an answer with no object label (an older server) names the object by its name', async () => {
    shareServer(FIELDS);
    renderLink();

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Shared showcase_client_brief');
  });
});
