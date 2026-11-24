// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36896 — the generic metadata list keeps its search, filters and
 * sort in its address, its row links carry them to the detail, and the
 * detail's ‹ › order reads them back (epic objectstack#36890, decision 10).
 * The real page and the real hook run; only the metadata client is stubbed.
 * Pinned, each with its control:
 *
 *  - an address with a search and a sort draws the list filtered and sorted,
 *    the search box holding the text — what a refresh replays;
 *  - typing writes the search into the address by REPLACING the entry, so
 *    Back never pages through keystrokes;
 *  - a row link carries the list context, and an untouched list's link
 *    carries none;
 *  - a row opened and Back again lands on the same filtered list;
 *  - the detail's ordered names follow the context in its address, and with
 *    none are every item by API name.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
// Dynamic imports the page's anchors and editors reach, paid at collection
// rather than inside a case's clocked window.
import '@object-ui/plugin-detail';
import '@objectstack/lint';

const SKILLS: Record<string, unknown>[] = [
  { name: 'triage', label: 'Triage desk', _packageId: 'crm' },
  { name: 'translate', label: 'Assist translation', _packageId: 'crm' },
  { name: 'billing', label: 'Billing', _packageId: 'crm' },
  { name: 'tribute', label: 'Zeal tribute', _packageId: 'crm' },
];

/** More tools than one page of the table holds (objectstack#36897). */
const TOOLS: Record<string, unknown>[] = Array.from({ length: 53 }, (_, i) => ({
  name: `tool_${String(i + 1).padStart(2, '0')}`,
  label: `Tool ${i + 1}`,
}));

const CLIENT = { list: async (type: string) => (type === 'skill' ? SKILLS : type === 'tool' ? TOOLS : []) };
const SKILL_ENTRY = { type: 'skill', label: 'Skill', allowEnvironmentOverlay: false, allowRuntimeCreate: true };
const TOOL_ENTRY = { type: 'tool', label: 'Tool', allowEnvironmentOverlay: false, allowRuntimeCreate: true };

vi.mock('./useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => CLIENT,
  useMetadataTypes: () => ({ loading: false, error: null, entries: [SKILL_ENTRY, TOOL_ENTRY] }),
}));
vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => 'en-US',
}));
vi.mock('../../hooks/useCanAuthorMetadata', () => ({ useCanAuthorMetadata: () => true }));
vi.mock('../../hooks/useTenancyPosture', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTenancyPosture: () => 'single',
}));

// Imported AFTER the mocks so the page picks them up.
import { MetadataResourceListPage } from './ResourceListPage';
import { useListOrderedNames } from './useListOrderedNames';
import { registerBuiltinAnchors } from './anchors';
import '../../services/builtinComponents';

registerBuiltinAnchors();

afterEach(() => {
  cleanup();
});

const LIST = '/apps/setup/metadata/skill';

/** The address and how it was last reached, for the assertions. */
function LocationProbe() {
  const location = useLocation();
  const type = useNavigationType();
  return (
    <output data-testid="location" data-nav={type}>
      {location.pathname + location.search}
    </output>
  );
}

/** The detail side: the ordered names its ‹ › would step through, and Back. */
function DetailProbe() {
  const ordered = useListOrderedNames('skill');
  const navigate = useNavigate();
  return (
    <div>
      <output data-testid="ordered" data-status={ordered.status} data-from-list={String(ordered.fromList)}>
        {ordered.names.join(',')}
      </output>
      <button type="button" onClick={() => navigate(-1)}>
        back
      </button>
    </div>
  );
}

function mount(at: string) {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route path="/apps/:appName/metadata/:type" element={<MetadataResourceListPage />} />
        <Route path="/apps/:appName/metadata/:type/:name" element={<DetailProbe />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

async function rowNames(): Promise<string[]> {
  await screen.findByRole('table');
  return screen
    .getAllByTestId(/^metadata-row-(?!api-name$|source$|lock$)/)
    .map((el) => el.getAttribute('data-testid')!.replace('metadata-row-', ''));
}

describe('the metadata list keeps its state in its address (objectstack#36896)', () => {
  it('an address with a search and a sort draws the list filtered and sorted', async () => {
    mount(`${LIST}?scope=environment&q=tri&sort=-label`);
    // Label Z to A, among the rows matching "tri".
    expect(await rowNames()).toEqual(['tribute', 'triage']);
    expect(screen.getByTestId('metadata-list-search')).toHaveValue('tri');
  });

  it('an untouched list is by API name (control)', async () => {
    mount(`${LIST}?scope=environment`);
    expect(await rowNames()).toEqual(['billing', 'translate', 'triage', 'tribute']);
  });

  it('typing writes the search into the address, replacing the entry', async () => {
    mount(`${LIST}?scope=environment`);
    await rowNames();
    fireEvent.change(screen.getByTestId('metadata-list-search'), { target: { value: 'bill' } });
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`${LIST}?scope=environment&q=bill`));
    expect(screen.getByTestId('location')).toHaveAttribute('data-nav', 'REPLACE');
    expect(await rowNames()).toEqual(['billing']);
  });

  it('a row link carries the list context; an untouched list carries none', async () => {
    const view = mount(`${LIST}?scope=environment&q=tri&sort=-label`);
    await rowNames();
    expect(screen.getByRole('link', { name: 'Triage desk' })).toHaveAttribute(
      'href',
      `${LIST}/triage?scope=environment&q=tri&sort=-label`,
    );
    view.unmount();

    mount(`${LIST}?scope=environment`);
    await rowNames();
    expect(screen.getByRole('link', { name: 'Triage desk' })).toHaveAttribute('href', `${LIST}/triage?scope=environment`);
  });

  it('a row opened and Back again lands on the same filtered list', async () => {
    mount(`${LIST}?scope=environment&q=tri&sort=-label`);
    await rowNames();
    fireEvent.click(screen.getByRole('link', { name: 'Zeal tribute' }));
    expect(await screen.findByTestId('ordered')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'back' }));
    });
    expect(await rowNames()).toEqual(['tribute', 'triage']);
    expect(screen.getByTestId('metadata-list-search')).toHaveValue('tri');
  });
});

describe('the detail ‹ › order reads the list context (objectstack#36896)', () => {
  it('with a filter and a sort in the address: the list order', async () => {
    mount(`${LIST}/triage?scope=environment&q=tri&sort=-label`);
    const ordered = await screen.findByTestId('ordered');
    await waitFor(() => expect(ordered).toHaveAttribute('data-status', 'ready'));
    expect(ordered).toHaveTextContent('tribute,triage');
    expect(ordered).toHaveAttribute('data-from-list', 'true');
  });

  it('with no list context (refresh, a shared link, ⌘K): every item by API name', async () => {
    mount(`${LIST}/triage?scope=environment`);
    const ordered = await screen.findByTestId('ordered');
    await waitFor(() => expect(ordered).toHaveAttribute('data-status', 'ready'));
    expect(ordered).toHaveTextContent('billing,translate,triage,tribute');
    expect(ordered).toHaveAttribute('data-from-list', 'false');
  });

  it('a package in the address scopes the names to it', async () => {
    mount(`${LIST}/triage?package=other`);
    const ordered = await screen.findByTestId('ordered');
    await waitFor(() => expect(ordered).toHaveAttribute('data-status', 'ready'));
    expect(ordered).toHaveTextContent('');
  });
});

/**
 * objectstack#36897 — the list is drawn by `ObjectGrid`, fed the rows in the
 * list's own order: what the table shows, in order, is what the detail's ‹ ›
 * step through, a header click is the list's sort, and the table pages.
 */
describe("the table's order is the ‹ › order (objectstack#36897)", () => {
  async function orderedOnDetail(linkName: string): Promise<string> {
    fireEvent.click(screen.getByRole('link', { name: linkName }));
    const ordered = await screen.findByTestId('ordered');
    await waitFor(() => expect(ordered).toHaveAttribute('data-status', 'ready'));
    return ordered.textContent ?? '';
  }

  it('the rows the table draws, in order, are the names the detail steps through', async () => {
    mount(`${LIST}?scope=environment&q=tri&sort=-label`);
    const shown = await rowNames();
    expect(shown).toEqual(['tribute', 'triage']);
    expect(await orderedOnDetail('Triage desk')).toBe(shown.join(','));
  });

  it('a click on the Label header sorts the list by label, in the address, and the detail follows', async () => {
    mount(`${LIST}?scope=environment`);
    await rowNames();
    fireEvent.click(screen.getByRole('columnheader', { name: /Label/ }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`${LIST}?scope=environment&sort=label`));
    const shown = await rowNames();
    expect(shown).toEqual(['translate', 'billing', 'triage', 'tribute']);
    expect(await orderedOnDetail('Billing')).toBe(shown.join(','));
  });

  it('pages by the address, and a new search starts again at the first page', async () => {
    mount(`/apps/setup/metadata/tool?scope=environment&page=2`);
    expect(await rowNames()).toEqual(['tool_51', 'tool_52', 'tool_53']);
    fireEvent.change(screen.getByTestId('metadata-list-search'), { target: { value: 'Tool' } });
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/apps/setup/metadata/tool?scope=environment&q=Tool'));
    expect(await rowNames()).toHaveLength(50);
  });
});
