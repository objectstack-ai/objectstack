// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12456 — the Access pillar's open permission set (epic
 * objectui#12446, decision C):
 *
 *   • the item header carries the set: its label (its api name the title's
 *     tooltip since objectstack#34795), the Package label and "N objects
 *     granted · M field overrides"; the PageShell breadcrumb and badge row it
 *     replaces are gone,
 *   • five tabs, Objects the landing; each other tab shows its section,
 *   • the object matrix's bulk strip draws on every row (objectstack#34795;
 *     it drew only on the row under the pointer or with keyboard focus),
 *   • the tab bodies stay mounted, so a closed facet tab still reports to the
 *     Save gate.
 */

import '@testing-library/jest-dom/vitest';
// The source under test reaches these through dynamic imports: their first load is paid at collection.
import '@objectstack/lint';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

let clientImpl: any;

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useMetadataClient: () => clientImpl,
    useMetadataTypes: () => ({
      loading: false,
      error: null,
      entries: [{ type: 'permission', label: 'Permission', allowEnvironmentOverlay: true }],
    }),
  };
});
vi.mock('../../components/SuggestedBindingsPanel', () => ({
  SuggestedBindingsPanel: () => null,
}));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({
  AccessExplainPanel: () => null,
}));
vi.mock('./StudioAiCopilot', () => ({
  StudioChatDock: () => null,
}));

import { t } from '../metadata-admin/i18n';
import { AccessPillar } from './StudioDesignSurface';

window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as any;

const en = (key: string) => t(key, 'en-US');

function makeClient() {
  const sets: Record<string, Record<string, unknown>> = {
    guest_portal: {
      name: 'guest_portal',
      label: 'Guest (Public Forms)',
      objects: { crm_lead: { allowCreate: true } },
      fields: {},
    },
  };
  return {
    // objectstack#26840 — the Access matrix reads its objects through the draft-overlaid door.
    withPreviewDrafts() { return this; },
    list: async (type: string) => {
      if (type === 'permission') return Object.values(sets).map((s) => ({ name: s.name, label: s.label }));
      if (type === 'object') {
        return [
          { name: 'crm_account', label: 'Account' },
          { name: 'crm_lead', label: 'Lead' },
        ];
      }
      return [];
    },
    listDrafts: async () => [],
    layered: async (_type: string, name: string) => ({
      effective: sets[name],
      code: null,
      overlay: null,
      overlayScope: null,
    }),
    getDraft: async () => null,
    get: async () => ({ fields: [] }),
    save: async (_t: string, _n: string, payload: Record<string, unknown>) => payload,
  } as any;
}

beforeEach(() => {
  clientImpl = makeClient();
  window.confirm = vi.fn() as unknown as typeof window.confirm;
});

afterEach(cleanup);

async function renderGuestPortal() {
  render(
    <MemoryRouter>
      <AccessPillar packageId="app.objectstack.hotcrm" />
    </MemoryRouter>,
  );
  await screen.findByTestId('perm-row-crm_lead');
}

const header = () => within(screen.getByTestId('access-item-header'));
const tab = (key: string) => screen.getByTestId(`perm-tab-${key}`);

describe('Access pillar — the open set is a header and five tabs (objectui#12456)', () => {
  it('the header reads the label, the api name, Package and the grant counts', async () => {
    await renderGuestPortal();
    expect(header().getByRole('heading', { level: 1 })).toHaveTextContent('Guest (Public Forms)');
    // objectstack#34795 — the api name is the title's tooltip, not a chip.
    expect(header().getByRole('heading', { level: 1 })).toHaveAttribute('title', 'guest_portal');
    expect(header().queryByText('guest_portal')).toBeNull();
    expect(header().getByTestId('perm-provenance-badge')).toHaveTextContent(en('perm.badge.package'));
    expect(header().getByText('1 object granted · 0 field overrides')).toBeInTheDocument();
    expect(header().getByRole('button', { name: en('engine.studio.access.explain.open') })).toBeInTheDocument();
    expect(header().getByRole('button', { name: en('engine.edit.history') })).toBeInTheDocument();
    expect(header().getByRole('button', { name: en('engine.studio.access.more') })).toBeInTheDocument();
  });

  it('the breadcrumb, the badge row and the band are gone', async () => {
    await renderGuestPortal();
    expect(screen.queryByText('Permission Set')).toBeNull();
    expect(screen.queryByText(en('perm.stat.objectsGranted'))).toBeNull();
    expect(screen.queryByText(en('engine.studio.access.subtitle'))).toBeNull();
    // Exactly one item header: the pillar's own stands down while a set is open.
    expect(screen.getAllByTestId('access-item-header')).toHaveLength(1);
  });

  it('five tabs in order, Objects the landing', async () => {
    await renderGuestPortal();
    const tabs = within(header().getByRole('navigation')).getAllByRole('button');
    expect(tabs.map((b) => b.textContent)).toEqual([
      en('engine.studio.access.tab.objects'),
      en('engine.studio.access.tab.capabilities'),
      en('engine.studio.access.tab.rls'),
      en('engine.studio.access.tab.tabs'),
      en('engine.studio.access.tab.admin'),
    ]);
    expect(tab('objects')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('perm-tabpanel-objects')).toBeVisible();
    expect(screen.getByTestId('perm-tabpanel-capabilities')).not.toBeVisible();
    expect(screen.getByTestId('perm-tabpanel-facets')).not.toBeVisible();
  });

  it('each other tab shows its existing section', async () => {
    await renderGuestPortal();

    fireEvent.click(tab('capabilities'));
    expect(tab('capabilities')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('perm-tabpanel-objects')).not.toBeVisible();
    expect(within(screen.getByTestId('perm-tabpanel-capabilities')).getByText(en('perm.field.systemCapabilities'))).toBeVisible();

    for (const [key, help] of [
      ['rls', 'perm.rls.help'],
      ['tabs', 'perm.tabs.title'],
      ['admin', 'perm.admin.title'],
    ] as const) {
      fireEvent.click(tab(key));
      const panel = screen.getByTestId(`perm-facet-${key}`);
      expect(panel).toBeVisible();
      expect(panel).toHaveAccessibleName(en(help === 'perm.rls.help' ? 'perm.rls.title' : help));
      for (const other of ['rls', 'tabs', 'admin'].filter((k) => k !== key)) {
        expect(screen.getByTestId(`perm-facet-${other}`)).not.toBeVisible();
      }
    }
    expect(within(screen.getByTestId('perm-facet-rls')).getByText(en('perm.rls.help'))).toBeInTheDocument();
  });

  it('the facet tabs stay mounted while Objects is open', async () => {
    await renderGuestPortal();
    for (const key of ['rls', 'tabs', 'admin']) {
      expect(screen.getByTestId(`perm-facet-${key}`)).toBeInTheDocument();
    }
  });
});

describe('Objects tab — the bulk strip is on every row (objectui#12456, objectstack#34795)', () => {
  it('draws on every row at rest, All · Read only · None, then the CRUD arm', async () => {
    await renderGuestPortal();
    for (const obj of ['crm_lead', 'crm_account']) {
      const strip = screen.getByTestId(`perm-bulk-${obj}`);
      expect(within(strip).getAllByRole('button').map((b) => b.textContent)).toEqual([
        en('perm.bulk.all'),
        en('perm.bulk.read'),
        en('perm.bulk.none'),
        en('perm.bulk.crud'),
      ]);
    }
  });

  it("keyboard focus on a row's first checkbox still marks the row; focus leaving the row clears it", async () => {
    await renderGuestPortal();
    const row = screen.getByTestId('perm-row-crm_account');
    const first = within(row).getAllByRole('checkbox')[0];
    act(() => first.focus());
    expect(first).toHaveFocus();
    expect(row).toHaveAttribute('data-active', 'true');
    // The strip's buttons are in the row's tab order.
    act(() => within(screen.getByTestId('perm-bulk-crm_account')).getAllByRole('button')[0].focus());
    expect(row).toHaveAttribute('data-active', 'true');
    act(() => within(screen.getByTestId('perm-row-crm_lead')).getAllByRole('checkbox')[0].focus());
    await waitFor(() => expect(row).not.toHaveAttribute('data-active'));
  });

  it('a bulk action writes what it wrote before: CRUD grants the four CRUD cells', async () => {
    await renderGuestPortal();
    const row = screen.getByTestId('perm-row-crm_account');
    fireEvent.mouseEnter(row);
    fireEvent.click(within(row).getByRole('button', { name: en('perm.bulk.crud') }));
    for (const action of ['perm.action.create', 'perm.action.read', 'perm.action.edit', 'perm.action.delete']) {
      expect(within(row).getByRole('checkbox', { name: `crm_account ${en(action)}` })).toBeChecked();
    }
    expect(within(row).getByRole('checkbox', { name: `crm_account ${en('perm.action.viewAll')}` })).not.toBeChecked();
    await waitFor(() =>
      expect(header().getByText('2 objects granted · 0 field overrides')).toBeInTheDocument(),
    );
  });

  it('the OWD column is a chip; the toolbar counts the objects', async () => {
    await renderGuestPortal();
    const row = screen.getByTestId('perm-row-crm_lead');
    expect(within(row).getByTestId('owd-badge-crm_lead')).toHaveTextContent(en('perm.owd.defaultPrivate'));
    expect(screen.getByTestId('perm-object-count')).toHaveTextContent('2 objects');
  });
});
