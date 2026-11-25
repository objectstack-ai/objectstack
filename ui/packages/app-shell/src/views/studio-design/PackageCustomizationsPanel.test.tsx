// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36908 — an installed app's "Customizations in this environment"
 * in its Setup → Packages detail: the removed Studio home's panel
 * (objectstack#34714) and its card line (ADR-0146 D3), one app at a time.
 * objectstack#36833 — "customized" counts the pair's arrangements too: an app
 * whose only change is a tab arrangement is customized.
 *
 * The real panel and the real customization reader (`packageCustomizations-io`)
 * run under a real router; the wire of the customization route and the
 * metadata client's list reads are stubbed. The stubbed answers are shaped by
 * the route's declaration (`GetPackageCustomizationsResponseSchema`) inside
 * the dispatcher envelope.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
await loadStudioCatalogue('zh');

/** What the metadata client's `list(type, { packageId })` answers, by type. */
const lists = vi.hoisted(() => ({ byType: {} as Record<string, unknown[]>, asked: [] as string[] }));
vi.mock('../metadata-admin/useMetadata.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => ({
    list: async (type: string, options?: { packageId?: string }) => {
      lists.asked.push(`${type}@${options?.packageId}`);
      return lists.byType[type] ?? [];
    },
  }),
}));

import { PACKAGE_CUSTOMIZATION_ROWS_SHOWN, PackageCustomizationsPanel } from './PackageCustomizationsPanel';
import { customizationRowsOf, customizedCountOf, loadCustomizationLabels } from './packageCustomizationRows';
import { t } from '../metadata-admin/i18n';
import type { PackageCustomizations } from './packageCustomizations-io';

const APP = 'app.objectstack.hotcrm';

type Lists = Partial<
  Pick<PackageCustomizations, 'overrides' | 'extensions' | 'arrangements' | 'switchedOff' | 'contributions'>
>;

/** A served answer, its counts derived from its lists as the route derives them. */
function served(l: Lists = {}): PackageCustomizations {
  const data = {
    packageId: APP,
    overrides: l.overrides ?? [],
    extensions: l.extensions ?? [],
    arrangements: l.arrangements ?? [],
    switchedOff: l.switchedOff ?? [],
    contributions: l.contributions ?? [],
  };
  return {
    ...data,
    counts: {
      overrides: data.overrides.length,
      extensions: data.extensions.length,
      arrangements: data.arrangements.length,
      switchedOff: data.switchedOff.length,
      contributions: data.contributions.length,
    },
  };
}

/** Answer the customization route with `status` and `data`; any other request is refused. */
function stubWire(status: number, data: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url !== `/api/v1/packages/${APP}/customizations`) throw new Error(`unexpected request ${url}`);
      const body =
        status === 200
          ? { success: true, data }
          : { success: false, error: { code: 'PERMISSION_DENIED', message: 'You may not read this package.' } };
      return { ok: status === 200, status, json: async () => body } as Response;
    }),
  );
}

function Where() {
  const { pathname, search } = useLocation();
  return <div data-testid="where">{`${pathname}${search}`}</div>;
}

function renderPanel(locale = 'en') {
  const onNavigate = vi.fn();
  render(
    <MemoryRouter initialEntries={['/apps/setup/component/developer/packages?face=admin']}>
      <Routes>
        <Route
          path="/apps/setup/component/developer/packages"
          element={<PackageCustomizationsPanel packageId={APP} locale={locale} onNavigate={onNavigate} />}
        />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  return { onNavigate };
}

const summary = () => screen.getByTestId('pkg-detail-customizations-summary');
const rows = () => screen.queryAllByTestId('pkg-detail-customization');
const tab = (key: string) => screen.getByTestId(`pkg-detail-customizations-tab-${key}`);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  lists.byType = {};
  lists.asked = [];
});

describe('Setup → Packages: an installed app’s customizations (objectstack#36908)', () => {
  it('lists one row per change, each saying how it changed the app, and counts them', async () => {
    stubWire(
      200,
      served({
        overrides: [{ type: 'view', name: 'account_list' }],
        extensions: [{ object: 'account', kind: 'field', name: 'region' }],
        arrangements: [{ object: 'account', key: 'relatedLists' }],
        switchedOff: [{ type: 'flow', name: 'lead_nurture' }],
        contributions: [{ kind: 'field', object: 'account', name: 'x', packageId: 'com.other' }],
      }),
    );
    lists.byType = { view: [{ name: 'account_list', label: 'All accounts' }], object: [{ name: 'account', label: 'Account' }] };
    renderPanel();

    await waitFor(() => expect(summary()).toHaveAttribute('data-state', 'read'));
    expect(summary()).toHaveTextContent('3 customized, 1 switched off');
    expect(rows().map((r) => r.getAttribute('data-mode'))).toEqual(['changed', 'added', 'arranged', 'switchedOff']);
    await waitFor(() => expect(rows()[0]).toHaveTextContent('All accounts'));
    expect(within(rows()[2]).getByTestId('pkg-detail-customization-meta')).toHaveTextContent('Rearranged · Tabs');
    // The label read asks the app's own lists, one per type with rows.
    expect(lists.asked.sort()).toEqual([`flow@${APP}`, `object@${APP}`, `view@${APP}`]);
  });

  it('objectstack#36833: an app whose only change is a tab arrangement is customized, on its own tab', async () => {
    stubWire(200, served({ arrangements: [{ object: 'account', key: 'relatedLists' }] }));
    renderPanel();

    await waitFor(() => expect(summary()).toHaveTextContent('1 customized, 0 switched off'));
    expect(tab('arranged')).toHaveTextContent('1');
    expect(rows()).toHaveLength(1);
  });

  it('with no change the section says so in one line and draws no list', async () => {
    stubWire(200, served());
    renderPanel();

    await waitFor(() => expect(summary()).toHaveTextContent(t('engine.packages.customizations.none', 'en')));
    expect(rows()).toHaveLength(0);
    expect(screen.queryByTestId('pkg-detail-customizations-tab-all')).toBeNull();
  });

  it('a read that fails says so, never "0", with the server’s sentence as its title', async () => {
    stubWire(403, null);
    renderPanel();

    await waitFor(() => expect(summary()).toHaveAttribute('data-state', 'failed'));
    expect(summary()).toHaveTextContent(t('engine.packages.customizations.failed', 'en'));
    expect(summary().getAttribute('title')).toContain('You may not read this package.');
    expect(summary()).not.toHaveTextContent('0');
  });

  it('a row opens its item in Studio and closes the sheet; Customize in Studio opens the app', async () => {
    stubWire(200, served({ extensions: [{ object: 'account', kind: 'field', name: 'region' }] }));
    const { onNavigate } = renderPanel();

    expect(screen.getByTestId('pkg-detail-customize')).toHaveAttribute('href', `/studio/${APP}/data`);
    await waitFor(() => expect(rows()).toHaveLength(1));
    fireEvent.click(within(rows()[0]).getByRole('link'));
    expect(await screen.findByTestId('where')).toHaveTextContent(`/studio/${APP}/metadata/object/account`);
    expect(onNavigate).toHaveBeenCalled();
  });

  it('a switched-off action opens where it is switched: its object’s Actions view (objectstack#34724)', async () => {
    stubWire(200, served({ switchedOff: [{ type: 'action', name: 'clone_opportunity' }] }));
    lists.byType = { object: [{ name: 'opportunity', actions: [{ name: 'clone_opportunity' }] }] };
    renderPanel();

    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(within(rows()[0]).getByRole('link')).toHaveAttribute(
      'href',
      `/studio/${APP}/data?surface=object%3Aopportunity&action=clone_opportunity`,
    );
  });

  it('tabs narrow by kind and the search by text', async () => {
    stubWire(
      200,
      served({
        overrides: [{ type: 'view', name: 'account_list' }],
        extensions: [{ object: 'account', kind: 'field', name: 'region' }],
        switchedOff: [{ type: 'flow', name: 'lead_nurture' }],
      }),
    );
    renderPanel();
    await waitFor(() => expect(rows()).toHaveLength(3));

    fireEvent.click(tab('fields'));
    expect(rows().map((r) => r.getAttribute('data-mode'))).toEqual(['added']);
    fireEvent.click(tab('all'));
    fireEvent.change(screen.getByTestId('pkg-detail-customizations-search'), { target: { value: 'nurture' } });
    expect(rows().map((r) => r.getAttribute('data-mode'))).toEqual(['switchedOff']);
  });

  it(`shows the first ${PACKAGE_CUSTOMIZATION_ROWS_SHOWN} rows, the rest behind "Show all"`, async () => {
    const overrides = Array.from({ length: PACKAGE_CUSTOMIZATION_ROWS_SHOWN + 2 }, (_, i) => ({ type: 'view', name: `v${i}` }));
    stubWire(200, served({ overrides }));
    renderPanel();
    await waitFor(() => expect(rows()).toHaveLength(PACKAGE_CUSTOMIZATION_ROWS_SHOWN));
    fireEvent.click(screen.getByTestId('pkg-detail-customizations-show-all'));
    expect(rows()).toHaveLength(PACKAGE_CUSTOMIZATION_ROWS_SHOWN + 2);
  });

  it('zh-CN: the section speaks the card’s words', async () => {
    stubWire(200, served({ arrangements: [{ object: 'account', key: 'relatedLists' }] }));
    renderPanel('zh');
    await waitFor(() => expect(summary()).toHaveTextContent('已定制 1 项，已停用 0 项'));
    expect(screen.getByText('本环境的定制')).toBeInTheDocument();
    expect(within(rows()[0]).getByTestId('pkg-detail-customization-meta')).toHaveTextContent('重新排列 · 页签');
  });
});

describe('the section’s rows, count and labels (objectstack#36908)', () => {
  const read = served({
    overrides: [{ type: 'view', name: 'account_list' }],
    arrangements: [
      { object: 'account', key: 'fieldGroups' },
      { object: 'account', key: 'relatedLists' },
    ],
    contributions: [{ kind: 'field', object: 'account', name: 'x', packageId: 'com.other' }],
  });

  it('one row per served override, extension, arrangement and switched-off item; contributions make none', () => {
    expect(customizationRowsOf(APP, read).map((r) => `${r.mode}:${r.type}:${r.name}:${r.arrangement ?? ''}`)).toEqual([
      'changed:view:account_list:',
      'arranged:object:account:fieldGroups',
      'arranged:object:account:relatedLists',
    ]);
  });

  it('objectstack#36833: "customized" is overrides + extensions + arrangements', () => {
    expect(customizedCountOf(read)).toBe(3);
  });

  it('a switched-off action with no object read opens its own page', () => {
    const rowsOf = customizationRowsOf(APP, { ...served(), switchedOff: [{ type: 'action', name: 'export_all' }] });
    expect(rowsOf[0].href).toBe(`/studio/${APP}/metadata/action/export_all`);
  });

  it('labels come from the app’s own list of each type with rows, a field’s from its object; a failed list keeps the names', async () => {
    const rowsOf = customizationRowsOf(APP, {
      ...served(),
      overrides: [{ type: 'view', name: 'ticket_list' }],
      extensions: [{ object: 'ticket', kind: 'field', name: 'region' }],
      switchedOff: [{ type: 'flow', name: 'escalate' }],
    });
    const asked: string[] = [];
    const client = {
      list: vi.fn(async (type: string, options?: { packageId?: string }) => {
        asked.push(`${type}@${options?.packageId}`);
        if (type === 'flow') throw new Error('HTTP 500');
        if (type === 'view') return [{ name: 'ticket_list', label: { en: 'All tickets', zh: '全部工单' } }];
        if (type === 'object') return [{ name: 'ticket', label: 'Ticket', fields: { region: { label: 'Region' } } }];
        return [];
      }),
    };
    expect(await loadCustomizationLabels(client, APP, rowsOf, 'zh')).toEqual({
      'view:ticket_list': '全部工单',
      'object:ticket': 'Ticket',
      'field:ticket.region': 'Region',
    });
    expect(asked.sort()).toEqual([`flow@${APP}`, `object@${APP}`, `view@${APP}`]);
    // No row, no request.
    client.list.mockClear();
    expect(await loadCustomizationLabels(client, APP, [], 'en')).toEqual({});
    expect(client.list).not.toHaveBeenCalled();
  });
});
