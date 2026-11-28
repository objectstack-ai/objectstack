// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28568 — the All metadata area's lists and directory mark a
 * base's customizations (ADR-0146 D3, "On top, one surface"), from the
 * server's customization read alone (`GET /api/v1/packages/:id/customizations`).
 *
 * The fixture is a read-only base, HotCRM (`hotcrm`), and its paired
 * `hotcrm.custom` package carrying one overridden translation, one added email
 * template and one extension field. The real pages and the real reader run;
 * only `fetch` and the metadata client are stubbed. Pinned, each against a
 * control:
 *
 *  - the translation list shows the served override as "Modified", naming
 *    HotCRM's pair, and the source filter's "modified and new" shows it alone
 *    (the App Studio list's Source, objectstack#37918);
 *  - the email-template list holds the pair's item beside the base's, shown
 *    "New", and an override of ANOTHER member of a name marks no row;
 *  - the directory's object tile counts the extension, and the header the base's total;
 *  - a failed read draws no mark, no filter and no number, with the server's sentence;
 *  - a base without a pair is unchanged, and Setup (no area) never reads;
 *  - in the cross-package leg an item of a pair is labelled with its base;
 *  - objectstack#30063 — the page tile counts a page's override;
 *  - objectstack#37236 — "customized" is overrides + extensions alone
 *    (`customizationTotal`): a base whose only change is an arrangement draws
 *    no header total, and neither list offers it the "customized" filter.
 */

// Paid at collection, not inside a case's clock (check:test-source-alias).
import '@objectstack/lint';
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
// The switch column waits on `audienceAnchorsOf`'s dynamic import of this exact
// specifier (see `ResourceListPage.environmentScope-7611.test.tsx`).
import '@objectstack/spec/identity';
import { MetadataAreaHostContext, type MetadataAreaHost } from './metadataAreaHost';

const BASE = 'hotcrm';
const PAIR = 'hotcrm.custom';
const PLAIN = 'com.example.crm';
/** objectstack#37236 — a base whose pair's only change is an arrangement. */
const ARRANGED = 'com.example.arranged';

const LISTS: Record<string, Record<string, unknown>[]> = {
  // A served override is served as the base's item, under the base's id.
  translation: [
    { name: 'crm_en', label: 'CRM English', _packageId: BASE },
    { name: 'crm_de', label: 'CRM German', _packageId: BASE },
    { name: 'plain_en', label: 'Plain English', _packageId: PLAIN },
    { name: 'arranged_en', label: 'Arranged English', _packageId: ARRANGED },
  ],
  email_template: [
    { name: 'welcome', label: 'Welcome', locale: 'en', _packageId: BASE },
    { name: 'renewal_notice', label: 'Renewal notice', locale: 'en', _packageId: PAIR },
  ],
  permission: [
    { name: 'crm_rep', label: 'CRM Rep', _packageId: BASE },
    { name: 'crm_rep_plus', label: 'CRM Rep Plus', _packageId: PAIR },
  ],
};

const CLIENT = {
  list: async (type: string) =>
    type === 'package' ? [{ manifest: { id: BASE, name: 'HotCRM', scope: 'installed' } }] : (LISTS[type] ?? []),
};

const entry = (type: string, domain: string) => ({
  type,
  label: type,
  domain,
  allowEnvironmentOverlay: true,
  allowRuntimeCreate: true,
});
const ENTRIES = [
  entry('object', 'data'),
  entry('translation', 'ui'),
  entry('email_template', 'system'),
  entry('permission', 'security'),
  entry('page', 'ui'),
];

vi.mock('./useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => CLIENT,
  useMetadataTypes: () => ({ loading: false, error: null, entries: ENTRIES }),
  useGlobalDiagnostics: () => ({
    loading: false,
    error: null,
    summary: { entries: [], total: 0, scannedTypes: 0, scannedItems: 0 },
    byType: {},
    warnByType: {},
    countsByType: { object: 3, translation: 2, email_template: 1, page: 1 },
    lockedByType: {},
    packagesByType: Object.fromEntries(ENTRIES.map((e) => [e.type, [BASE, PLAIN]])),
    allPackages: [BASE, PLAIN],
    reload: () => {},
  }),
}));
vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => 'en-US',
}));
vi.mock('../../hooks/useCanAuthorMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCanAuthorMetadata: () => true,
}));

import { MetadataDirectoryPage } from './DirectoryPage';
import { MetadataResourceListPage } from './ResourceListPage';
import { useListOrderedNames } from './useListOrderedNames';
import { registerDefaultMetadataSchemas } from './default-schemas';
import { t, tFormat } from './i18n';

registerDefaultMetadataSchemas();

/** HotCRM's read: the overridden translation, an override of another member, the extension. */
const HOTCRM_READ = {
  packageId: BASE,
  overrides: [
    { type: 'email_template', name: 'welcome', member: 'zh-CN' },
    { type: 'translation', name: 'crm_en', basedOn: '2.1.0' },
  ],
  extensions: [{ object: 'crm_account', kind: 'field', name: 'tier__c' }],
  switchedOff: [],
  arrangements: [],
  contributions: [],
  counts: { overrides: 2, extensions: 1, switchedOff: 0, arrangements: 0, contributions: 0 },
};
/** objectstack#37236 — two arrangements, no override, no extension. */
const ARRANGED_READ = {
  packageId: ARRANGED,
  overrides: [],
  extensions: [],
  switchedOff: [],
  arrangements: [
    { object: 'crm_account', key: 'relatedLists' },
    { object: 'crm_account', key: 'fieldGroups' },
  ],
  contributions: [],
  counts: { overrides: 0, extensions: 0, switchedOff: 0, arrangements: 2, contributions: 0 },
};
const EMPTY_READ = { packageId: PLAIN, overrides: [], extensions: [], switchedOff: [], arrangements: [], contributions: [], counts: { overrides: 0, extensions: 0, switchedOff: 0, arrangements: 0, contributions: 0 } };

let customizationsFail = false;
/** objectstack#30063 — the read also lists a page's override. */
let readListsPage = false;
const withPage = (read: typeof HOTCRM_READ) => ({
  ...read,
  overrides: [...read.overrides, { type: 'page', name: 'crm_welcome', basedOn: '2.1.0' }],
  counts: { ...read.counts, overrides: read.counts.overrides + 1 },
});
const fetchMock = vi.fn(async (url: string) => {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const u = String(url);
  if (u === '/api/v1/packages') {
    return json(200, { success: true, data: { packages: [{ manifest: { id: BASE, name: 'HotCRM', scope: 'installed' }, writable: false }] } });
  }
  const m = u.match(/^\/api\/v1\/packages\/([^/]+)\/customizations$/);
  if (m) {
    if (customizationsFail) {
      return json(503, { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'The customization ledger is unavailable.' } });
    }
    const hotcrm = readListsPage ? withPage(HOTCRM_READ) : HOTCRM_READ;
    const id = decodeURIComponent(m[1]);
    return json(200, { success: true, data: id === BASE ? hotcrm : id === ARRANGED ? ARRANGED_READ : EMPTY_READ });
  }
  if (u.startsWith('/api/v1/data/sys_metadata_activation')) {
    return json(200, { object: 'sys_metadata_activation', records: [], hasMore: false });
  }
  return json(404, { success: false });
});

beforeEach(() => {
  customizationsFail = false;
  readListsPage = false;
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const area = (packageId: string | null): MetadataAreaHost => ({
  packageId,
  readOnly: packageId !== null,
  basePath: `/studio/${packageId ?? '~all'}/metadata`,
});

function mountList(host: MetadataAreaHost | null, type: string, search: string) {
  const base = host?.basePath ?? '/apps/setup/metadata';
  const tree = (
    <MemoryRouter initialEntries={[`${base}/${type}${search}`]}>
      <MetadataResourceListPage type={type} />
    </MemoryRouter>
  );
  return render(host ? <MetadataAreaHostContext.Provider value={host}>{tree}</MetadataAreaHostContext.Provider> : tree);
}

function mountDirectory(host: MetadataAreaHost) {
  return render(
    <MetadataAreaHostContext.Provider value={host}>
      <MemoryRouter initialEntries={[`${host.basePath}?package=${host.packageId}`]}>
        <MetadataDirectoryPage />
      </MemoryRouter>
    </MetadataAreaHostContext.Provider>,
  );
}

const marksOf = (rowName: string) =>
  within(screen.getByTestId(`metadata-row-${rowName}`))
    .queryAllByTestId('customization-mark')
    .map((m) => `${m.getAttribute('data-kind')}:${m.textContent}`);
/** objectstack#37918 — the App Studio list's Source badge of a row: its kind and its words. */
const sourceOf = (rowName: string) => {
  const badge = within(screen.getByTestId(`metadata-row-${rowName}`).closest('tr') as HTMLElement).queryByTestId(
    'metadata-row-source',
  );
  return badge ? `${badge.getAttribute('data-source-kind')}:${badge.textContent}` : null;
};
const customizationReads = () =>
  fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/customizations')).map(([u]) => String(u));

describe('the All metadata lists mark a base\'s customizations (objectstack#28568)', () => {
  it('the translation list shows the served override as "Modified" of HotCRM\'s pair, and "modified and new" shows it alone', async () => {
    mountList(area(BASE), 'translation', `?package=${BASE}`);
    // The grid draws its rows once its table is ready (objectstack#36897).
    await screen.findByTestId('metadata-row-crm_en');
    await vi.waitFor(() => expect(sourceOf('crm_en')).toBe(`modified:${t('engine.list.source.modified', 'en-US')}`));
    const badge = within(screen.getByTestId('metadata-row-crm_en').closest('tr') as HTMLElement).getByTestId('metadata-row-source');
    expect(badge).toHaveAttribute(
      'title',
      tFormat('engine.customizationMark.customizedTitle', 'en-US', { baseName: 'HotCRM', pair: PAIR }),
    );
    // CONTROL: the base's item the read does not list is system-shipped.
    expect(sourceOf('crm_de')).toBe(`system:${t('engine.list.source.system', 'en-US')}`);
    // Another package's row stays out of the base's list, as before.
    expect(screen.queryByTestId('metadata-row-plain_en')).toBeNull();
    // "Only customizations" is the source filter's "modified and new" here.
    expect(screen.queryByTestId('metadata-only-customizations')).toBeNull();
    cleanup();

    mountList(area(BASE), 'translation', `?package=${BASE}&source=runtime`);
    await screen.findByTestId('metadata-row-crm_en');
    await vi.waitFor(() => expect(screen.queryByTestId('metadata-row-crm_de')).toBeNull());
    expect(screen.getByTestId('metadata-source-filter')).toHaveTextContent(
      tFormat('engine.list.sourceFilter.changed', 'en-US', { count: 1 }),
    );
  });

  it('the email-template list holds the pair\'s item beside the base\'s, shown "New"', async () => {
    mountList(area(BASE), 'email_template', `?package=${BASE}`);
    await screen.findByTestId('metadata-row-renewal_notice');
    await vi.waitFor(() => expect(sourceOf('renewal_notice')).toBe(`new:${t('engine.list.source.new', 'en-US')}`));
    // The read overrides `welcome` in zh-CN only: the en member is the base's own.
    expect(sourceOf('welcome')).toBe(`system:${t('engine.list.source.system', 'en-US')}`);
  });

  it('a failed read draws no mark and no filter, and says the server\'s sentence', async () => {
    customizationsFail = true;
    mountList(area(BASE), 'email_template', `?package=${BASE}`);
    const failed = await screen.findByTestId('metadata-customizations-failed');
    expect(failed).toHaveTextContent('The customization ledger is unavailable.');
    // The pair's item is still listed (the list read is its own), unmarked.
    await screen.findByTestId('metadata-row-renewal_notice');
    expect(marksOf('renewal_notice')).toEqual([]);
    expect(screen.queryByTestId('metadata-only-customizations')).toBeNull();
  });

  it('a base without a pair is unchanged: no mark, no filter', async () => {
    mountList(area(PLAIN), 'translation', `?package=${PLAIN}`);
    await screen.findByTestId('metadata-row-plain_en');
    await vi.waitFor(() => expect(customizationReads()).toEqual([`/api/v1/packages/${PLAIN}/customizations`]));
    // Let the read's answer render, then look.
    await new Promise((r) => setTimeout(r, 0));
    expect(marksOf('plain_en')).toEqual([]);
    expect(screen.queryByTestId('metadata-only-customizations')).toBeNull();
    expect(screen.queryByTestId('metadata-customizations-failed')).toBeNull();
  });

  it('CONTROL: Setup (no area) reads no customizations and marks nothing', async () => {
    mountList(null, 'translation', `?package=${BASE}`);
    await screen.findByTestId('metadata-row-crm_en');
    expect(marksOf('crm_en')).toEqual([]);
    expect(customizationReads()).toEqual([]);
  });

  it('the cross-package leg labels an item of a pair with its base', async () => {
    mountList(area(null), 'permission', '?scope=environment');
    await screen.findByTestId('metadata-row-crm_rep_plus');
    expect(marksOf('crm_rep_plus')).toEqual([
      `customizationOf:${tFormat('engine.customizationMark.customizationOf', 'en-US', { baseName: BASE })}`,
    ]);
    // CONTROL: the base's own item names no base.
    expect(marksOf('crm_rep')).toEqual([]);
    expect(customizationReads()).toEqual([]);
  });
});

describe('the All metadata directory counts a base\'s customizations (objectstack#28568)', () => {
  it('the object tile counts the extension, the translation tile its override, and the header the total', async () => {
    mountDirectory(area(BASE));
    const total = await screen.findByTestId('directory-customizations-total');
    expect(total).toHaveTextContent(
      tFormat('engine.directory.customizations.total', 'en-US', { customized: 3, baseName: 'HotCRM' }),
    );
    expect(screen.getByTestId('directory-tile-customized-object')).toHaveTextContent(
      tFormat('engine.directory.customizations.tile', 'en-US', { customized: 1 }),
    );
    expect(screen.getByTestId('directory-tile-customized-translation')).toHaveTextContent('1 customized');
    expect(screen.getByTestId('directory-tile-customized-email_template')).toHaveTextContent('1 customized');
    // CONTROL: a type with no served customization draws no number, not "0".
    expect(screen.queryByTestId('directory-tile-customized-permission')).toBeNull();
  });

  it('objectstack#30063 — the page tile counts a page\'s override, and the header the total with it', async () => {
    readListsPage = true;
    mountDirectory(area(BASE));
    const total = await screen.findByTestId('directory-customizations-total');
    expect(total).toHaveTextContent(
      tFormat('engine.directory.customizations.total', 'en-US', { customized: 4, baseName: 'HotCRM' }),
    );
    expect(screen.getByTestId('directory-tile-customized-page')).toHaveTextContent(
      tFormat('engine.directory.customizations.tile', 'en-US', { customized: 1 }),
    );
  });

  it('a failed read draws no number, never "0", and says the server\'s sentence', async () => {
    customizationsFail = true;
    mountDirectory(area(BASE));
    expect(await screen.findByTestId('directory-customizations-failed')).toHaveTextContent(
      'The customization ledger is unavailable.',
    );
    expect(screen.queryByTestId('directory-customizations-total')).toBeNull();
    expect(screen.queryAllByTestId(/^directory-tile-customized-/)).toEqual([]);
  });
});

/** The detail's ‹ › names (`useListOrderedNames`), drawn for a pin to read. */
function OrderedProbe({ type }: { type: string }) {
  const ordered = useListOrderedNames(type);
  return (
    <output data-testid="ordered" data-status={ordered.status}>
      {ordered.names.join(',')}
    </output>
  );
}

function mountOrdered(host: MetadataAreaHost, type: string, search: string) {
  return render(
    <MetadataAreaHostContext.Provider value={host}>
      <MemoryRouter initialEntries={[`${host.basePath}/${type}/x${search}`]}>
        <OrderedProbe type={type} />
      </MemoryRouter>
    </MetadataAreaHostContext.Provider>,
  );
}

describe('objectstack#37236 — "customized" is overrides + extensions, never an arrangement', () => {
  it('the directory header draws no total for a base whose only change is an arrangement', async () => {
    mountDirectory(area(ARRANGED));
    await vi.waitFor(() => expect(customizationReads()).toEqual([`/api/v1/packages/${ARRANGED}/customizations`]));
    // Let the read's answer render, then look.
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('directory-customizations-failed')).toBeNull();
    expect(screen.queryByTestId('directory-customizations-total')).toBeNull();
    expect(screen.queryAllByTestId(/^directory-tile-customized-/)).toEqual([]);
  });

  it('the list offers no "customized" filter to a base whose only change is an arrangement', async () => {
    mountList(area(ARRANGED), 'translation', `?package=${ARRANGED}`);
    await screen.findByTestId('metadata-row-arranged_en');
    await vi.waitFor(() => expect(customizationReads()).toEqual([`/api/v1/packages/${ARRANGED}/customizations`]));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('metadata-customizations-failed')).toBeNull();
    expect(screen.queryByTestId('metadata-only-customizations')).toBeNull();
    expect(marksOf('arranged_en')).toEqual([]);
  });

  it('the detail ‹ › names: "only customizations" is not offered to it, so it filters nothing out', async () => {
    mountOrdered(area(ARRANGED), 'translation', '?customized=1');
    await vi.waitFor(() => expect(screen.getByTestId('ordered')).toHaveAttribute('data-status', 'ready'));
    expect(screen.getByTestId('ordered')).toHaveTextContent(/^arranged_en$/);
  });

  it('CONTROL: for HotCRM, whose pair overrides, the ‹ › names under "modified and new" keep only the customized row', async () => {
    // objectstack#37918 — the App Studio list folds "only customizations" into its source filter.
    mountOrdered(area(BASE), 'translation', '?source=runtime');
    await vi.waitFor(() => expect(screen.getByTestId('ordered')).toHaveAttribute('data-status', 'ready'));
    expect(screen.getByTestId('ordered')).toHaveTextContent(/^crm_en$/);
  });
});
