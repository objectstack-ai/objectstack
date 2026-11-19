// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11794 — the Automations rail can be searched, and a flow's name is
 * no longer cut to a stub.
 *
 * Before: a rail of flows with no search, each label in a `truncate` span in a
 * narrow rail, so a long name read as its first few words and an ellipsis. Now a
 * search box above the list matches the label or the machine name, and a search
 * that matches nothing says so.
 *
 * objectui#12454 — the redesign groups the rail by object and gives each row
 * one 32 px line, so the label truncates again, as the card's rail does; the
 * whole name moved to the row's title. The second describe pins that the name
 * is still whole on the row, where a pointer reads it. The rows are read by
 * their test id, so a group header (also a button) is never counted as a row.
 *
 * The REAL `AutomationsPillar`. The rail lists what `loadPackageSurfaces`
 * merges: published rows by their label, a draft-only row by its name. The
 * runtime status read answers 404 here, which the pillar takes as an older
 * backend (no dots): the dots are `railUnboundReason-11281`'s subject.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { createI18n, I18nProvider, transformSpecTranslations } from '@object-ui/i18n';

const PKG = 'com.acme.app';
const LONG_LABEL = 'Escalate overdue high-priority support cases to the regional on-call manager';

const NODES = [
  { id: 'start', type: 'start', label: 'Start' },
  { id: 'end', type: 'end', label: 'End' },
];
const EDGES = [{ id: 'e1', source: 'start', target: 'end' }];

/** Published rows (label + name) and one draft-only header (name only). */
const PUBLISHED = [
  { name: 'nightly_digest', label: 'Nightly digest' },
  { name: 'approve_order', label: 'Approve order' },
  { name: 'escalate_overdue_cases', label: LONG_LABEL },
];
const DRAFT_HEADERS = [{ name: 'welcome_new_member' }];

const mockClient = vi.hoisted(() => ({
  list: vi.fn(async () => [] as Array<Record<string, unknown>>),
  listDrafts: vi.fn(async () => [] as Array<Record<string, unknown>>),
  listTypes: vi.fn(async () => ({ entries: [] })),
  get: vi.fn(async () => null),
  references: vi.fn(async () => []),
  layered: vi.fn(async () => ({ code: null, overlay: null, overlayScope: null, effective: null, editable: true, deletable: true, resettable: false, lock: 'none' })),
  getDraft: vi.fn(async (type: string, name: string) => {
    throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), { code: 'NO_DRAFT', status: 404 });
  }),
  save: vi.fn(async () => {
    throw new Error('this suite saves nothing');
  }),
  publish: vi.fn(async () => ({ success: true })),
  reset: vi.fn(async () => ({})),
}));

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AutomationsPillar } from './StudioDesignSurface';
import { createEmptyDataSource, failOnAbsorbedFetchError } from './__tests__/emptyDataSource';
import { t, tFormat } from '../metadata-admin/i18n';

const dataSource = createEmptyDataSource();
failOnAbsorbedFetchError();

beforeEach(() => {
  mockClient.list.mockImplementation(async () =>
    PUBLISHED.map((f) => ({ ...f, type: 'autolaunched', nodes: NODES, edges: EDGES })),
  );
  mockClient.listDrafts.mockImplementation(async () => DRAFT_HEADERS);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The rail (the `nav` holding the search box) once every row has rendered; `wrap` puts a provider around the pillar. */
async function renderRail(wrap: (pillar: React.ReactElement) => React.ReactElement = (pillar) => pillar): Promise<HTMLElement> {
  render(<MemoryRouter initialEntries={[`/studio/${PKG}/automations`]}>{wrap(<AutomationsPillar packageId={PKG} />)}</MemoryRouter>);
  const search = await screen.findByPlaceholderText(t('engine.studio.designer.search', 'en'), undefined, { timeout: 8000 });
  const rail = search.closest('nav') as HTMLElement;
  await waitFor(() => expect(rail.querySelector('[data-testid="auto-rail-row-welcome_new_member"]')).toBeInTheDocument(), {
    timeout: 8000,
  });
  return rail;
}

/** The rail rows' visible names, in order. */
function rowNames(rail: HTMLElement): string[] {
  return Array.from(rail.querySelectorAll<HTMLElement>('[data-testid^="auto-rail-row-"]')).map(
    (b) => b.querySelector('span.min-w-0')?.textContent?.trim() ?? '',
  );
}

describe('the Automations rail search (objectui#11794)', () => {
  it('control: an empty search lists every flow, published and draft-only alike', async () => {
    const rail = await renderRail();
    expect(rowNames(rail)).toEqual(['Nightly digest', 'Approve order', LONG_LABEL, 'welcome_new_member']);
  });

  it('matches the label, case-insensitively', async () => {
    const rail = await renderRail();
    fireEvent.change(within(rail).getByPlaceholderText(t('engine.studio.designer.search', 'en')), {
      target: { value: 'DIGEST' },
    });
    expect(rowNames(rail)).toEqual(['Nightly digest']);
  });

  it('matches the machine name where the label does not hold it', async () => {
    const rail = await renderRail();
    // `approve_order` is in no label: only the name answers it.
    fireEvent.change(within(rail).getByPlaceholderText(t('engine.studio.designer.search', 'en')), {
      target: { value: 'approve_order' },
    });
    expect(rowNames(rail)).toEqual(['Approve order']);
  });

  it('a search that matches nothing says so, and clearing it brings every flow back', async () => {
    const rail = await renderRail();
    const search = within(rail).getByPlaceholderText(t('engine.studio.designer.search', 'en'));
    fireEvent.change(search, { target: { value: '  invoice  ' } });
    expect(rowNames(rail)).toEqual([]);
    expect(within(rail).getByText(tFormat('engine.list.emptyQuery', 'en', { query: 'invoice' }))).toBeInTheDocument();
    // Not the empty-package line: the package HAS flows.
    expect(within(rail).queryByText(t('engine.studio.auto.none', 'en'))).toBeNull();

    fireEvent.change(search, { target: { value: '' } });
    expect(rowNames(rail)).toHaveLength(4);
  });
});

describe('a flow’s name in the Automations rail is not cut to a stub (objectui#11794, objectui#12454)', () => {
  it('the long label is the row’s whole text on one line, and the row’s title holds it whole', async () => {
    const rail = await renderRail();
    const row = within(rail).getByRole('button', { name: new RegExp(LONG_LABEL) });
    const label = within(row).getByText(LONG_LABEL);
    // jsdom lays nothing out, so the class that decides clipping is what is
    // read: `truncate` is `overflow: hidden; text-overflow: ellipsis;
    // white-space: nowrap` — the 32 px row of objectui#12454.
    expect(label).toHaveClass('truncate');
    expect(label).toHaveTextContent(new RegExp(`^${LONG_LABEL}$`));
    // The whole name is still on the row, where hovering it reads it.
    expect(row.getAttribute('title') ?? '').toMatch(new RegExp(`^${LONG_LABEL} · `));
  });
});

describe('a rail row names its flow by the package’s translated label (objectstack#35319)', () => {
  // The package's zh-CN pack: a label for two of the four flows. The other two keep their authored copy.
  const ZH_CN = {
    flows: {
      nightly_digest: { label: '夜间摘要' },
      welcome_new_member: { label: '欢迎新成员' },
    },
  };
  /** The console's i18n with the pack loaded under zh-CN, speaking `language`. */
  const withPack = (language: string) => (pillar: React.ReactElement) => {
    const instance = createI18n({ defaultLanguage: language, detectBrowserLanguage: false });
    instance.addResourceBundle('zh-CN', 'translation', transformSpecTranslations(ZH_CN), true, true);
    return (
      <I18nProvider instance={instance} persistLanguage={false}>
        {pillar}
      </I18nProvider>
    );
  };
  const search = (rail: HTMLElement, value: string) =>
    fireEvent.change(within(rail).getByPlaceholderText(t('engine.studio.designer.search', 'en')), { target: { value } });

  it('zh-CN: a flow the pack labels reads by that label, on the row and in its title; the rest stay authored', async () => {
    const rail = await renderRail(withPack('zh-CN'));
    expect(rowNames(rail)).toEqual(['夜间摘要', 'Approve order', LONG_LABEL, '欢迎新成员']);
    const row = rail.querySelector('[data-testid="auto-rail-row-nightly_digest"]') as HTMLElement;
    expect(row.getAttribute('title') ?? '').toMatch(/^夜间摘要 · /);
  });

  it('zh-CN: the search matches the label the row shows, and still the authored label and the machine name', async () => {
    const rail = await renderRail(withPack('zh-CN'));
    search(rail, '夜间');
    expect(rowNames(rail)).toEqual(['夜间摘要']);
    search(rail, 'DIGEST');
    expect(rowNames(rail)).toEqual(['夜间摘要']);
    search(rail, 'welcome_new');
    expect(rowNames(rail)).toEqual(['欢迎新成员']);
  });

  it('en: the zh-CN pack does not speak for English, so every row reads as authored', async () => {
    const rail = await renderRail(withPack('en'));
    expect(rowNames(rail)).toEqual(['Nightly digest', 'Approve order', LONG_LABEL, 'welcome_new_member']);
    search(rail, '夜间');
    expect(rowNames(rail)).toEqual([]);
  });
});
