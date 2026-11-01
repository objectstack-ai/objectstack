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
 *  - the translation list marks the served override "Customized (HotCRM)" and
 *    the "only customizations" filter shows it alone;
 *  - the email-template list holds the pair's item beside the base's, marked
 *    "Added", and an override of ANOTHER member of a name marks no row;
 *  - the directory's object tile counts the extension, and the header the base's total;
 *  - a failed read draws no mark, no filter and no number, with the server's sentence;
 *  - a base without a pair is unchanged, and Setup (no area) never reads;
 *  - in the cross-package leg an item of a pair is labelled with its base.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
// The switch column waits on `audienceAnchorsOf`'s dynamic import of this exact
// specifier (see `ResourceListPage.environmentScope-7611.test.tsx`).
import '@objectstack/spec/identity';
import { MetadataAreaHostContext, type MetadataAreaHost } from './metadataAreaHost';

const BASE = 'hotcrm';
const PAIR = 'hotcrm.custom';
const PLAIN = 'com.example.crm';

const LISTS: Record<string, Record<string, unknown>[]> = {
  // A served override is served as the base's item, under the base's id.
  translation: [
    { name: 'crm_en', label: 'CRM English', _packageId: BASE },
    { name: 'crm_de', label: 'CRM German', _packageId: BASE },
    { name: 'plain_en', label: 'Plain English', _packageId: PLAIN },
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
    countsByType: { object: 3, translation: 2, email_template: 1 },
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
  counts: { overrides: 2, extensions: 1, switchedOff: 0 },
};
const EMPTY_READ = { packageId: PLAIN, overrides: [], extensions: [], switchedOff: [], counts: { overrides: 0, extensions: 0, switchedOff: 0 } };

let customizationsFail = false;
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
    return json(200, { success: true, data: decodeURIComponent(m[1]) === BASE ? HOTCRM_READ : EMPTY_READ });
  }
  if (u.startsWith('/api/v1/data/sys_metadata_activation')) {
    return json(200, { object: 'sys_metadata_activation', records: [], hasMore: false });
  }
  return json(404, { success: false });
});

beforeEach(() => {
  customizationsFail = false;
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
const customizationReads = () =>
  fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/customizations')).map(([u]) => String(u));

describe('the All metadata lists mark a base\'s customizations (objectstack#28568)', () => {
  it('the translation list marks the served override "Customized (HotCRM)", and the filter shows it alone', async () => {
    mountList(area(BASE), 'translation', `?package=${BASE}`);
    const only = await screen.findByTestId('metadata-only-customizations');
    expect(marksOf('crm_en')).toEqual([`customized:${tFormat('engine.customizationMark.customized', 'en-US', { base: 'HotCRM' })}`]);
    expect(marksOf('crm_en')).toEqual(['customized:Customized (HotCRM)']);
    // CONTROL: the base's item the read does not list carries no mark.
    expect(marksOf('crm_de')).toEqual([]);
    // Another package's row stays out of the base's list, as before.
    expect(screen.queryByTestId('metadata-row-plain_en')).toBeNull();

    expect(only).toHaveTextContent(tFormat('engine.list.customizations.only', 'en-US', { marked: 1 }));
    fireEvent.click(only);
    expect(screen.getByTestId('metadata-row-crm_en')).toBeInTheDocument();
    expect(screen.queryByTestId('metadata-row-crm_de')).toBeNull();
    fireEvent.click(only);
    expect(screen.getByTestId('metadata-row-crm_de')).toBeInTheDocument();
  });

  it('the email-template list holds the pair\'s item beside the base\'s, marked "Added"', async () => {
    mountList(area(BASE), 'email_template', `?package=${BASE}`);
    await screen.findByTestId('metadata-only-customizations');
    expect(marksOf('renewal_notice')).toEqual([`added:${t('engine.customizationMark.added', 'en-US')}`]);
    // The read overrides `welcome` in zh-CN only: the en member is the base's own.
    expect(marksOf('welcome')).toEqual([]);
  });

  it('a failed read draws no mark and no filter, and says the server\'s sentence', async () => {
    customizationsFail = true;
    mountList(area(BASE), 'email_template', `?package=${BASE}`);
    const failed = await screen.findByTestId('metadata-customizations-failed');
    expect(failed).toHaveTextContent('The customization ledger is unavailable.');
    // The pair's item is still listed (the list read is its own), unmarked.
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
      `customizationOf:${tFormat('engine.customizationMark.customizationOf', 'en-US', { base: BASE })}`,
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
      tFormat('engine.directory.customizations.total', 'en-US', { customized: 3, base: 'HotCRM' }),
    );
    expect(screen.getByTestId('directory-tile-customized-object')).toHaveTextContent(
      tFormat('engine.directory.customizations.tile', 'en-US', { customized: 1 }),
    );
    expect(screen.getByTestId('directory-tile-customized-translation')).toHaveTextContent('1 customized');
    expect(screen.getByTestId('directory-tile-customized-email_template')).toHaveTextContent('1 customized');
    // CONTROL: a type with no served customization draws no number, not "0".
    expect(screen.queryByTestId('directory-tile-customized-permission')).toBeNull();
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
