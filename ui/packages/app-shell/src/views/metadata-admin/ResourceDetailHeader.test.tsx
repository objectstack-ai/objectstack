// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36901 — a metadata item's header wired to its address (epic
 * objectstack#36890 decisions 7, 10 and 12): × opens the type's list with the
 * list context and scope the item's address carries; ‹ › open the neighbours
 * in the list's order (the context's filter and sort, else by name) and keep
 * the open tab; what belongs to the item alone (its tab on ×, its member, its
 * review request) does not travel; both ask the leave guard first.
 *
 * The real header, hook and list helpers run; only the metadata client is
 * stubbed.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const SKILLS: Record<string, unknown>[] = [
  { name: 'triage', label: 'Triage desk', _packageId: 'crm' },
  { name: 'translate', label: 'Assist translation', _packageId: 'crm' },
  { name: 'billing', label: 'Billing', _packageId: 'crm' },
  { name: 'tribute', label: 'Zeal tribute', _packageId: 'crm' },
];

const CLIENT = { list: async (type: string) => (type === 'skill' ? SKILLS : []) };
const SKILL_ENTRY = { type: 'skill', label: 'Skill', allowEnvironmentOverlay: false, allowRuntimeCreate: true };

vi.mock('./useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => CLIENT,
  useMetadataTypes: () => ({ loading: false, error: null, entries: [SKILL_ENTRY] }),
}));
vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => 'en-US',
}));

import { ResourceDetailHeader, detailListHref, detailSiblingHref } from './ResourceDetailHeader';
import { registerUnsavedEdits } from '../../chrome/unsavedEdits';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

function mount(at: string, tabAddress: string | null = null) {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route path="/studio/:pkg/metadata/:type" element={<p>list</p>} />
        <Route
          path="/studio/:pkg/metadata/:type/:name"
          element={<HeaderAt tabAddress={tabAddress} />}
        />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

function HeaderAt({ tabAddress }: { tabAddress: string | null }) {
  const name = useLocation().pathname.split('/').pop() ?? '';
  return <ResourceDetailHeader type="skill" name={name} label={name} locale="en-US" tabAddress={tabAddress} />;
}

const location = () => screen.getByTestId('location').textContent;

describe('detail addresses (pure)', () => {
  it('× keeps the list context and the scope, and drops what belongs to the item', () => {
    const search = new URLSearchParams('package=crm&q=tr&sort=-label&tab=history&member=fr&review=1&open=view:a&sel=nav:x');
    expect(detailListHref('/studio/crm/metadata/skill/triage', search)).toBe('/studio/crm/metadata/skill?package=crm&q=tr&sort=-label');
  });

  it('‹ › keep the list context, the scope and the open tab, and drop the member', () => {
    const search = new URLSearchParams('package=crm&q=tr&member=fr&tab=details');
    const at = '/studio/crm/metadata/skill/triage';
    expect(detailSiblingHref(at, search, 'next one', 'history')).toBe('/studio/crm/metadata/skill/next%20one?package=crm&q=tr&tab=history');
    expect(detailSiblingHref(`${at}/`, search, 'n', null)).toBe('/studio/crm/metadata/skill/n?package=crm&q=tr');
  });
});

describe('ResourceDetailHeader — × and ‹ › on the item address (objectstack#36901)', () => {
  it('without list context ‹ › walk every item by name, and › keeps the open tab', async () => {
    mount('/studio/crm/metadata/skill/translate?package=crm', 'history');
    await waitFor(() => expect(screen.getByTestId('studio-detail-position')).toHaveTextContent('2 / 4'));
    fireEvent.click(screen.getByTestId('studio-detail-next'));
    expect(location()).toBe('/studio/crm/metadata/skill/triage?package=crm&tab=history');
    await waitFor(() => expect(screen.getByTestId('studio-detail-position')).toHaveTextContent('3 / 4'));
    fireEvent.click(screen.getByTestId('studio-detail-previous'));
    expect(location()).toBe('/studio/crm/metadata/skill/translate?package=crm&tab=history');
  });

  it('with the list context in the address ‹ › walk the list as it was filtered and sorted', async () => {
    mount('/studio/crm/metadata/skill/triage?package=crm&q=tr&sort=-label');
    // "tr" keeps three; by label, Z to A: tribute, triage, translate.
    await waitFor(() => expect(screen.getByTestId('studio-detail-position')).toHaveTextContent('2 / 3'));
    fireEvent.click(screen.getByTestId('studio-detail-next'));
    expect(location()).toBe('/studio/crm/metadata/skill/translate?package=crm&q=tr&sort=-label');
  });

  it('× returns to the list with its context, and leaves the tab and the member behind', async () => {
    mount('/studio/crm/metadata/skill/triage?package=crm&q=tr&member=x&tab=source');
    fireEvent.click(screen.getByTestId('studio-detail-close'));
    expect(location()).toBe('/studio/crm/metadata/skill?package=crm&q=tr');
  });

  it('with unsaved edits × and › ask first, and a declined question stays on the item', async () => {
    const release = registerUnsavedEdits('Leave with unsaved edits?');
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    try {
      mount('/studio/crm/metadata/skill/translate?package=crm');
      await waitFor(() => expect(screen.getByTestId('studio-detail-next')).not.toBeDisabled());
      fireEvent.click(screen.getByTestId('studio-detail-next'));
      fireEvent.click(screen.getByTestId('studio-detail-close'));
      expect(confirm).toHaveBeenCalledTimes(2);
      expect(location()).toBe('/studio/crm/metadata/skill/translate?package=crm');
      confirm.mockReturnValue(true);
      fireEvent.click(screen.getByTestId('studio-detail-close'));
      expect(location()).toBe('/studio/crm/metadata/skill?package=crm');
    } finally {
      release();
      vi.unstubAllGlobals();
    }
  });

  it('a create page has no place in the list: no ‹ ›', () => {
    render(
      <MemoryRouter initialEntries={['/studio/crm/metadata/skill/new']}>
        <ResourceDetailHeader type="skill" name="" pager={false} label="New" locale="en-US" />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('studio-detail-close')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-detail-pager')).toBeNull();
  });
});
