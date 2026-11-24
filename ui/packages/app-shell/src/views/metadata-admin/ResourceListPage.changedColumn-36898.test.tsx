// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36898 — the generic metadata list's 「修改时间」 column and its
 * 「有未发布的改动」 mark, on the real page. The metadata client and the
 * pending-drafts ledger are stubbed. Pinned, each with its control:
 *
 *  - an item served from a stored row shows its time; a code-shipped item an
 *    empty cell, with no error;
 *  - `?sort=-changed` draws newest first, code-shipped items last;
 *  - an item on the ledger is marked, the AI's draft apart from a person's;
 *    an item off the ledger (published) carries no mark.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
// Dynamic imports the page's anchors and editors reach, paid at collection
// rather than inside a case's clocked window.
import '@object-ui/plugin-detail';
import '@objectstack/lint';

const ITEMS: Record<string, unknown>[] = [
  { name: 'shipped', label: 'Shipped', _packageId: 'crm' },
  { name: 'by_person', label: 'By person', _packageId: 'crm' },
  { name: 'by_ai', label: 'By AI', _packageId: 'crm' },
];
const CHANGED_AT = { by_person: '2026-11-20T08:00:00Z', by_ai: '2026-11-24T10:15:00Z' };
const DRAFT_CHANGES: Record<string, unknown[]> = {
  by_person: [{ path: ['label'], by: 'studio', actor: 'u1', at: '2026-11-24T09:00:00Z' }],
  by_ai: [{ path: ['label'], by: 'copilot', actor: 'u1', at: '2026-11-24T09:30:00Z' }],
};

const CLIENT = {
  list: async (type: string) => (type === 'skill' ? ITEMS : []),
  listResponse: async (type: string) =>
    type === 'skill' ? { items: ITEMS, changedAt: CHANGED_AT } : { items: [] },
  getDraft: async (_type: string, name: string) => ({ type: 'skill', name, item: {}, draftChanges: DRAFT_CHANGES[name] }),
};
const SKILL_ENTRY = { type: 'skill', label: 'Skill', allowEnvironmentOverlay: false, allowRuntimeCreate: true };

const ledger = vi.hoisted(() => ({ entries: [] as Array<{ type: string; name: string; packageId: string | null }> }));

vi.mock('./useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => CLIENT,
  useMetadataTypes: () => ({ loading: false, error: null, entries: [SKILL_ENTRY] }),
}));
vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => 'en-US',
}));
vi.mock('../../preview/usePendingDrafts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePendingDrafts: () => ({
    count: ledger.entries.length,
    entries: ledger.entries,
    refresh: async () => {},
    behindSave: false,
  }),
}));
vi.mock('../../hooks/useCanAuthorMetadata', () => ({ useCanAuthorMetadata: () => true }));
vi.mock('../../hooks/useTenancyPosture', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTenancyPosture: () => 'single',
}));

// Imported AFTER the mocks so the page picks them up.
import { MetadataResourceListPage } from './ResourceListPage';
import { registerBuiltinAnchors } from './anchors';
import '../../services/builtinComponents';

registerBuiltinAnchors();

afterEach(() => {
  cleanup();
  ledger.entries = [];
});

function mount(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/apps/setup/metadata/skill?scope=environment${search}`]}>
      <Routes>
        <Route path="/apps/:appName/metadata/:type" element={<MetadataResourceListPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const cellOf = (name: string) => within(screen.getByTestId(`metadata-row-${name}`)).getByTestId('metadata-changed-cell');

describe('the 「修改时间」 column (objectstack#36898)', () => {
  it('an item with a stored row shows its time; a code-shipped item an empty cell', async () => {
    mount();
    await screen.findByRole('table');
    expect(await screen.findByRole('columnheader', { name: 'Modified' })).toBeInTheDocument();
    const time = await within(screen.getByTestId('metadata-row-by_ai')).findByText(
      new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(Date.parse(CHANGED_AT.by_ai)),
    );
    expect(time.closest('time')).toHaveAttribute('dateTime', CHANGED_AT.by_ai);
    expect(cellOf('shipped').querySelector('time')).toBeNull();
  });

  it('`?sort=-changed` draws newest first, the code-shipped item last', async () => {
    mount('&sort=-changed');
    await within(await screen.findByTestId('metadata-row-by_ai')).findByText(/2026/);
    const order = screen
      .getAllByTestId(/^metadata-row-/)
      .filter((el) => el.tagName === 'TR')
      .map((tr) => tr.getAttribute('data-testid'));
    expect(order).toEqual(['metadata-row-by_ai', 'metadata-row-by_person', 'metadata-row-shipped']);
  });
});

describe('the 「有未发布的改动」 mark (objectstack#36898)', () => {
  it('marks each item on the ledger, the AI\'s draft apart from a person\'s', async () => {
    ledger.entries = [
      { type: 'skill', name: 'by_person', packageId: 'crm' },
      { type: 'skill', name: 'by_ai', packageId: 'crm' },
    ];
    mount();
    await screen.findByRole('table');
    const ai = await within(cellOf('by_ai')).findByTestId('metadata-draft-mark');
    await vi.waitFor(() => expect(ai).toHaveAttribute('data-draft-by', 'ai'));
    expect(ai).toHaveTextContent('Unpublished AI changes');
    const person = within(cellOf('by_person')).getByTestId('metadata-draft-mark');
    expect(person).toHaveAttribute('data-draft-by', 'human');
    expect(person).toHaveTextContent('Unpublished changes');
    expect(within(cellOf('shipped')).queryByTestId('metadata-draft-mark')).toBeNull();
  });

  it('an item off the ledger — published — carries no mark (control)', async () => {
    mount();
    await screen.findByRole('table');
    await within(screen.getByTestId('metadata-row-by_ai')).findByText(/2026/);
    expect(screen.queryByTestId('metadata-draft-mark')).toBeNull();
  });
});
