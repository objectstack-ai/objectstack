// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34714 — the Studio landing lists every change this deployment
 * made to its installed apps in one panel, "Customizations in this
 * environment".
 *
 * The real `BuilderLanding`, the real panel and the real customization reader
 * (`packageCustomizations-io`) run under a real router; the package list, the
 * wire of the customization route and the panel's label read are stubbed. The
 * stubbed answers are shaped by the route's declaration
 * (`GetPackageCustomizationsResponseSchema`) inside the dispatcher envelope.
 *
 * Acceptance: two installed apps with one change each and one switched-off
 * flow draw 3 rows with the right app and mode, each opening its item; the
 * panel's total equals the cards' "customized" plus "switched off"; with no
 * change the panel is one line; an app whose read answers 403 is named as
 * unreadable and the other app's rows still list.
 */

import '@testing-library/jest-dom/vitest';
// The source under test reaches `import('@objectstack/lint')`: paid here, at collection, never inside a test's clock.
import '@objectstack/lint';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { I18nProvider, createI18n } from '@object-ui/i18n';
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
await loadStudioCatalogue('zh');

const packages = vi.hoisted(() => ({ list: [] as Array<Record<string, unknown>> }));
const labels = vi.hoisted(() => ({ byApp: {} as Record<string, Record<string, string>> }));

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => packages.list) };
});
vi.mock('../metadata-admin/PackageFormDialog', () => ({ PackageFormDialog: () => null }));
// No flow belongs to no package; no request leaves the file for that count.
vi.mock('./packageSurfaces', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./packageSurfaces')>()),
  loadPackageLessSurfaces: vi.fn(async () => []),
}));
// The label read answers from `labels.byApp`; its own behaviour is pinned in the io case below.
vi.mock('./landingCustomizations-io', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./landingCustomizations-io')>()),
  loadCustomizationLabels: vi.fn(async (_client: unknown, appId: string) => labels.byApp[appId] ?? {}),
}));

import { BuilderLanding } from './BuilderLanding';
import { customizationRowsOf } from './landingCustomizations-io';
import { LANDING_CUSTOMIZATION_ROWS_SHOWN } from './LandingCustomizationsPanel';

const HOTCRM = { id: 'app.objectstack.hotcrm', name: 'HotCRM', writable: false, namespace: 'crm' };
const SERVICE = { id: 'app.objectstack.service', name: 'Service Desk', writable: false, namespace: 'svc' };
const OWN = { id: 'com.acme.app', name: 'Acme', writable: true, namespace: 'acme' };

type Lists = {
  overrides?: Array<Record<string, unknown>>;
  extensions?: Array<Record<string, unknown>>;
  switchedOff?: Array<Record<string, unknown>>;
  contributions?: Array<Record<string, unknown>>;
};
type Answer = { status: number; body: unknown };

/** A served answer for `id`, its counts derived from its lists as the route derives them. */
function served(id: string, lists: Lists = {}): Answer {
  const overrides = lists.overrides ?? [];
  const extensions = lists.extensions ?? [];
  const switchedOff = lists.switchedOff ?? [];
  const contributions = lists.contributions ?? [];
  return {
    status: 200,
    body: {
      success: true,
      data: {
        packageId: id,
        overrides,
        extensions,
        switchedOff,
        contributions,
        counts: {
          overrides: overrides.length,
          extensions: extensions.length,
          switchedOff: switchedOff.length,
          contributions: contributions.length,
        },
      },
    },
  };
}

const CUSTOMIZATIONS_RE = /^\/api\/v1\/packages\/([^/]+)\/customizations$/;

/** Answer each customization request from `answers` by base id; any other request is refused. */
function stubWire(answers: Record<string, Answer>) {
  const requested: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requested.push(url);
      const m = CUSTOMIZATIONS_RE.exec(url);
      const answer = m ? answers[decodeURIComponent(m[1])] : undefined;
      if (!answer) throw new Error(`unexpected request ${url}`);
      return {
        ok: answer.status >= 200 && answer.status < 300,
        status: answer.status,
        json: async () => answer.body,
        text: async () => JSON.stringify(answer.body),
      } as Response;
    }),
  );
  return { requested };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  packages.list = [];
  labels.byApp = {};
});

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <div data-testid="location">{`${pathname}${search}`}</div>;
}

function renderLanding(lang: 'en' | 'zh' = 'en') {
  const landing = (
    <MemoryRouter initialEntries={['/studio']}>
      <LocationProbe />
      <Routes>
        <Route path="/studio" element={<BuilderLanding />} />
        <Route path="/studio/:packageId/metadata/:type/:name" element={<div data-testid="area-item" />} />
        <Route path="/studio/:packageId/:tab" element={<div data-testid="pillar-builder" />} />
      </Routes>
    </MemoryRouter>
  );
  if (lang === 'en') return render(landing);
  const zh = createI18n({ defaultLanguage: 'zh', detectBrowserLanguage: false, resources: { zh: {} } });
  return render(<I18nProvider instance={zh}>{landing}</I18nProvider>);
}

const panel = () => screen.getByTestId('studio-landing-env-customizations');
const rows = () => within(panel()).queryAllByTestId('studio-landing-env-customization');
const rowLine = (row: HTMLElement) =>
  `${row.querySelector('a')?.textContent} | ${within(row).getByTestId('studio-landing-env-customization-meta').textContent}`;

/** The cards' "customized" + "switched off", summed over every read card. */
function cardSum(): number {
  return screen
    .getAllByTestId('studio-landing-customizations')
    .filter((l) => l.getAttribute('data-state') === 'read')
    .reduce((sum, l) => sum + [...(l.textContent ?? '').matchAll(/(\d+)/gu)].reduce((s, m) => s + Number(m[1]), 0), 0);
}

/** Two apps, one change each, and one switched-off flow on HotCRM. */
const ACCEPTANCE = {
  [HOTCRM.id]: served(HOTCRM.id, {
    overrides: [{ type: 'view', name: 'account_list' }],
    switchedOff: [{ type: 'flow', name: 'lead_nurture' }],
    // Another package's field on a HotCRM object: not this deployment's change.
    contributions: [{ kind: 'field', object: 'account', name: 'erp_code', packageId: 'com.acme.erp' }],
  }),
  [SERVICE.id]: served(SERVICE.id, { extensions: [{ object: 'ticket', kind: 'field', name: 'region' }] }),
};

describe('Studio landing → Customizations in this environment (objectstack#34714)', () => {
  it('two apps with one change each and one switched-off flow list 3 rows, each with its app and how it changed it', async () => {
    packages.list = [HOTCRM, SERVICE, OWN];
    stubWire(ACCEPTANCE);
    labels.byApp = { [HOTCRM.id]: { 'view:account_list': 'All accounts' } };
    renderLanding();

    // The label arrives after the rows: a row is drawn on its name first.
    await waitFor(() =>
      expect(rows().map(rowLine)).toEqual([
        'All accounts | Changed · View · HotCRM',
        'lead_nurture | Switched off · Flow · HotCRM',
        'ticket.region | Added · Field · Service Desk',
      ]),
    );
    expect(rows().map((r) => `${r.getAttribute('data-app-id')}:${r.getAttribute('data-mode')}`)).toEqual([
      `${HOTCRM.id}:changed`,
      `${HOTCRM.id}:switchedOff`,
      `${SERVICE.id}:added`,
    ]);
    // The contributed field makes no row.
    expect(panel().textContent).not.toContain('erp_code');
  });

  it('each row opens its item in Studio: the item on its app’s metadata area, an added field on its object', async () => {
    packages.list = [HOTCRM, SERVICE];
    stubWire(ACCEPTANCE);
    renderLanding();

    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(rows().map((r) => r.querySelector('a')?.getAttribute('href'))).toEqual([
      '/studio/app.objectstack.hotcrm/metadata/view/account_list',
      '/studio/app.objectstack.hotcrm/metadata/flow/lead_nurture',
      '/studio/app.objectstack.service/metadata/object/ticket',
    ]);
    fireEvent.click(within(rows()[1]).getByRole('link'));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/studio/app.objectstack.hotcrm/metadata/flow/lead_nurture'),
    );
    expect(screen.getByTestId('area-item')).toBeInTheDocument();
  });

  it('the panel’s total equals the cards’ customized + switched off', async () => {
    packages.list = [HOTCRM, SERVICE];
    stubWire(ACCEPTANCE);
    renderLanding();

    await waitFor(() => expect(rows()).toHaveLength(3));
    await waitFor(() => expect(cardSum()).toBe(3));
    expect(screen.getByTestId('studio-landing-env-customizations-total')).toHaveTextContent('3');
    // One read per app serves the card and the panel.
    const requested = vi.mocked(globalThis.fetch).mock.calls.map((c) => String(c[0]));
    expect(requested.filter((u) => CUSTOMIZATIONS_RE.test(u)).sort()).toEqual([
      '/api/v1/packages/app.objectstack.hotcrm/customizations',
      '/api/v1/packages/app.objectstack.service/customizations',
    ]);
  });

  it('with no change anywhere the panel is one line, and draws no list', async () => {
    packages.list = [HOTCRM, SERVICE];
    stubWire({ [HOTCRM.id]: served(HOTCRM.id), [SERVICE.id]: served(SERVICE.id) });
    renderLanding();

    expect(await screen.findByTestId('studio-landing-env-customizations-empty')).toHaveTextContent(
      'No installed app has been changed in this environment yet.',
    );
    expect(rows()).toHaveLength(0);
    expect(screen.queryByTestId('studio-landing-env-customizations-total')).not.toBeInTheDocument();
    expect(screen.queryByTestId('studio-landing-env-customizations-search')).not.toBeInTheDocument();
  });

  it('an app whose read answers 403 is named as unreadable, never counted as 0; the other app still lists', async () => {
    packages.list = [HOTCRM, SERVICE];
    stubWire({
      [HOTCRM.id]: { status: 403, body: { success: false, error: { code: 'PERMISSION_DENIED', message: 'Not allowed to read customizations.' } } },
      [SERVICE.id]: ACCEPTANCE[SERVICE.id],
    });
    renderLanding();

    const unreadable = await screen.findByTestId('studio-landing-env-customizations-unreadable');
    expect(unreadable).toHaveTextContent('HotCRM: this app’s customizations could not be read.');
    expect(unreadable).toHaveAttribute('data-app-id', HOTCRM.id);
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rowLine(rows()[0])).toBe('ticket.region | Added · Field · Service Desk');
    expect(screen.getByTestId('studio-landing-env-customizations-total')).toHaveTextContent('1');
    expect(screen.queryByTestId('studio-landing-env-customizations-empty')).not.toBeInTheDocument();
    // The card says the same: failed, not "No changes yet".
    const hotcrmCard = document.querySelector(`[data-package-id="${HOTCRM.id}"]`) as HTMLElement;
    expect(within(hotcrmCard).getByTestId('studio-landing-customizations')).toHaveAttribute('data-state', 'failed');
  });

  it('tabs narrow by kind, the search by text, and the rows group by app', async () => {
    packages.list = [HOTCRM, SERVICE];
    stubWire(ACCEPTANCE);
    renderLanding();
    await waitFor(() => expect(rows()).toHaveLength(3));

    const tab = (key: string) => screen.getByTestId(`studio-landing-env-customizations-tab-${key}`);
    expect(['all', 'fields', 'views', 'flows', 'switchedOff'].map((k) => tab(k).textContent)).toEqual([
      'All 3',
      'New fields 1',
      'Forms and views 1',
      'Flows 1',
      'Switched off 1',
    ]);
    fireEvent.click(tab('fields'));
    expect(rows().map((r) => r.getAttribute('data-mode'))).toEqual(['added']);
    fireEvent.click(tab('switchedOff'));
    expect(rows().map((r) => r.querySelector('a')?.textContent)).toEqual(['lead_nurture']);
    fireEvent.click(tab('all'));

    fireEvent.change(screen.getByTestId('studio-landing-env-customizations-search'), { target: { value: 'service' } });
    expect(rows().map((r) => r.querySelector('a')?.textContent)).toEqual(['ticket.region']);
    fireEvent.change(screen.getByTestId('studio-landing-env-customizations-search'), { target: { value: '' } });

    fireEvent.click(screen.getByTestId('studio-landing-env-customizations-group'));
    const groups = within(panel()).getAllByTestId('studio-landing-env-customizations-app');
    expect(groups.map((g) => [g.getAttribute('data-app-id'), within(g).getAllByTestId('studio-landing-env-customization').length])).toEqual([
      [HOTCRM.id, 2],
      [SERVICE.id, 1],
    ]);
  });

  it(`shows the first ${LANDING_CUSTOMIZATION_ROWS_SHOWN} rows, the rest behind "Show all"`, async () => {
    const many = Array.from({ length: LANDING_CUSTOMIZATION_ROWS_SHOWN + 3 }, (_, i) => ({ type: 'view', name: `view_${i}` }));
    packages.list = [HOTCRM];
    stubWire({ [HOTCRM.id]: served(HOTCRM.id, { overrides: many }) });
    renderLanding();

    await waitFor(() => expect(rows()).toHaveLength(LANDING_CUSTOMIZATION_ROWS_SHOWN));
    const showAll = screen.getByTestId('studio-landing-env-customizations-show-all');
    expect(showAll).toHaveTextContent(`Show all ${many.length}`);
    fireEvent.click(showAll);
    expect(rows()).toHaveLength(many.length);
  });

  it('zh-CN: the panel speaks the card’s words — 本环境的定制, 改了原有的 / 新增的 / 已停用', async () => {
    packages.list = [HOTCRM, SERVICE];
    stubWire(ACCEPTANCE);
    renderLanding('zh');

    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(within(panel()).getByRole('heading', { level: 2 })).toHaveTextContent('本环境的定制');
    expect(rows().map((r) => within(r).getByTestId('studio-landing-env-customization-meta').textContent)).toEqual([
      '改了原有的 · 视图 · HotCRM',
      '已停用 · 流程 · HotCRM',
      '新增的 · 字段 · Service Desk',
    ]);
    expect(screen.getByTestId('studio-landing-env-customizations-tab-fields')).toHaveTextContent('新增字段');
    expect(screen.getByTestId('studio-landing-env-customizations-tab-views')).toHaveTextContent('表单与视图');
  });
});

describe('the panel’s rows and labels (objectstack#34714)', () => {
  it('one row per served override, extension and switched-off item; contributions make none', () => {
    const read = (ACCEPTANCE[HOTCRM.id].body as { data: Parameters<typeof customizationRowsOf>[1] }).data;
    expect(customizationRowsOf(HOTCRM, read).map((r) => `${r.mode}:${r.type}:${r.name}`)).toEqual([
      'changed:view:account_list',
      'switchedOff:flow:lead_nurture',
    ]);
  });

  it('labels come from the app’s own list of each type with rows, a field’s from its object; a failed list keeps the names', async () => {
    const { loadCustomizationLabels: real } = await vi.importActual<typeof import('./landingCustomizations-io')>(
      './landingCustomizations-io',
    );
    const rowsOf = customizationRowsOf(SERVICE, {
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
    expect(await real(client, SERVICE.id, rowsOf, 'zh')).toEqual({
      'view:ticket_list': '全部工单',
      'object:ticket': 'Ticket',
      'field:ticket.region': 'Region',
    });
    expect(asked.sort()).toEqual(['flow@app.objectstack.service', 'object@app.objectstack.service', 'view@app.objectstack.service']);
    // No row, no request.
    client.list.mockClear();
    expect(await real(client, HOTCRM.id, rowsOf, 'en')).toEqual({});
    expect(client.list).not.toHaveBeenCalled();
  });
});
